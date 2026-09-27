-- Gate 1.4: PINのサーバー側検証と永続的な試行制限（ADR 0001）
--
-- 方針:
--   * PINはSupabase Authのpasswordにしない。サーバーがPINを検証し、成功時だけAuth sessionを発行する。
--   * PINのハッシュ（scrypt + サーバー側pepper）と試行回数は private schema に置き、テーブルへは誰にも権限を与えない。
--     アクセスは service_role だけがEXECUTEできる SECURITY DEFINER 関数（public schema、PostgREST RPC）に限る。
--   * 試行は「検証前に予約」する。並行した試行もすべて1回として数えるため、同時送信で制限を回避できない。
--   * 制限:
--       アカウント単位: 最後の成功以降の連続試行5回でロック。ロック時間は15分→30分→60分（上限60分）。成功でリセット。
--       送信元単位: 1時間の固定windowで20回を超えたら1時間ロック（成功・対象外IDも数える）。送信元はIPのHMAC（生IPは保存しない）。
--   * 照合の対象はprofileとPIN登録のある利用者だけ。任意のIDで行を作らせない。1日以上前の送信元記録は、
--     試行の最後に「他の処理がロック中の行は飛ばす」形で削除する（ロック順を崩さない）。
--   * PINそのもの・IPアドレスは保存しない。

-- ---------------------------------------------------------------------------
-- テーブル（private schema。PostgRESTに公開しない）
-- ---------------------------------------------------------------------------
create table private.pin_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- 形式: scrypt$<version>$<N>$<r>$<p>$<salt base64>$<hash base64>（lib/auth/pin.ts）
  pin_hash text not null constraint pin_credentials_hash_format check (pin_hash like 'scrypt$%'),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on table private.pin_credentials is 'PINのハッシュ（scrypt + pepper）。PIN平文は保存しない。service_role用の関数からのみ参照する';

create trigger pin_credentials_set_updated_at
  before update on private.pin_credentials
  for each row execute function private.set_updated_at();

create table private.login_throttles (
  scope text not null constraint login_throttles_scope_check check (scope in ('account', 'source')),
  -- account: auth.users.id、source: 送信元IPのHMAC（16進）
  subject text not null constraint login_throttles_subject_length check (char_length(subject) between 1 and 128),
  attempt_count integer not null default 0 constraint login_throttles_attempt_count_check check (attempt_count >= 0),
  window_started_at timestamp with time zone not null default now(),
  locked_until timestamp with time zone,
  lockout_count integer not null default 0 constraint login_throttles_lockout_count_check check (lockout_count >= 0),
  updated_at timestamp with time zone not null default now(),
  primary key (scope, subject)
);

comment on table private.login_throttles is 'PINログインの試行回数とロック状態（アカウント単位・送信元単位）';

revoke all on table private.pin_credentials from public, anon, authenticated, service_role;
revoke all on table private.login_throttles from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 古い送信元記録の片付け（pin_login_beginの最後に呼ぶ）
-- ---------------------------------------------------------------------------
-- 1日以上前のwindowでロックも切れている送信元記録を削除し、行が溜まり続けないようにする。
-- 他の処理がロック中の行は待たずに飛ばす（skip locked）ため、ロック順の逆転によるdeadlockは起きない。
create function private.delete_stale_login_sources(p_current_source text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.login_throttles as t
  where (t.scope, t.subject) in (
    select o.scope, o.subject
    from private.login_throttles as o
    where o.scope = 'source'
      and o.subject <> p_current_source
      and o.window_started_at < pg_catalog.now() - interval '1 day'
      and (o.locked_until is null or o.locked_until < pg_catalog.now())
    limit 200
    for update skip locked
  );
$$;

revoke all on function private.delete_stale_login_sources(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 試行の予約（検証前に呼ぶ）
-- ---------------------------------------------------------------------------
-- 戻り値:
--   allowed = false, retry_after_seconds > 0: ロック中。その秒数後に再試行できる
--   allowed = false, retry_after_seconds = 0: 照合の対象外（profileが無い・PIN未登録）。照合しない
--   allowed = true : 1回分を予約済み。pin_hashでサーバーが照合する
create function public.pin_login_begin(p_user_id uuid, p_source text)
returns table (allowed boolean, retry_after_seconds integer, pin_hash text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamp with time zone := pg_catalog.now();
  v_eligible boolean;
  v_account private.login_throttles;
  v_source private.login_throttles;
  v_wait integer;
begin
  if p_user_id is null or p_source is null or pg_catalog.char_length(p_source) not between 1 and 128 then
    raise exception 'invalid pin_login_begin arguments' using errcode = '22023';
  end if;

  -- 照合の対象は「profileがありPINを登録済み」の利用者だけ。それ以外のIDではアカウント行を作らず、照合もさせない
  v_eligible := exists (
    select 1
    from public.profiles as p
    join private.pin_credentials as c on c.user_id = p.id
    where p.id = p_user_id
  );

  if v_eligible then
    insert into private.login_throttles (scope, subject)
    values ('account', p_user_id::text)
    on conflict do nothing;
    -- 行ロックは常に account → source の順で取る（deadlockしない）
    select * into strict v_account
    from private.login_throttles as t
    where t.scope = 'account' and t.subject = p_user_id::text
    for update;
  end if;

  -- 送信元行は古い記録の片付け（他の処理）で消えることがあるため、取れるまで作り直す
  loop
    insert into private.login_throttles (scope, subject)
    values ('source', p_source)
    on conflict do nothing;
    select * into v_source
    from private.login_throttles as t
    where t.scope = 'source' and t.subject = p_source
    for update;
    exit when found;
  end loop;

  v_wait := greatest(
    coalesce(pg_catalog.ceil(extract(epoch from (v_account.locked_until - v_now)))::integer, 0),
    coalesce(pg_catalog.ceil(extract(epoch from (v_source.locked_until - v_now)))::integer, 0)
  );
  if v_wait > 0 then
    perform private.delete_stale_login_sources(p_source);
    return query select false, v_wait, null::text;
    return;
  end if;

  -- 送信元: 1時間の固定window（対象外IDへの要求も数える）
  if v_source.window_started_at <= v_now - interval '1 hour' then
    v_source.attempt_count := 0;
    v_source.window_started_at := v_now;
  end if;
  v_source.attempt_count := v_source.attempt_count + 1;
  if v_source.attempt_count >= 20 then
    v_source.locked_until := v_now + interval '1 hour';
    v_source.attempt_count := 0;
    v_source.window_started_at := v_now;
  end if;

  update private.login_throttles as t
  set attempt_count = v_source.attempt_count,
      window_started_at = v_source.window_started_at,
      locked_until = v_source.locked_until,
      updated_at = v_now
  where t.scope = 'source' and t.subject = p_source;

  if not v_eligible then
    perform private.delete_stale_login_sources(p_source);
    -- allowed = false かつ retry_after_seconds = 0 は「ログインの準備ができていない（PIN未設定など）」
    return query select false, 0, null::text;
    return;
  end if;

  -- アカウント: 最後の成功以降の連続試行（5回目でロックを設定。5回目が成功すればsucceededで解除される）
  v_account.attempt_count := v_account.attempt_count + 1;
  if v_account.attempt_count >= 5 then
    v_account.locked_until := v_now + least(
      interval '15 minutes' * pg_catalog.power(2, v_account.lockout_count),
      interval '60 minutes'
    );
    v_account.lockout_count := v_account.lockout_count + 1;
    v_account.attempt_count := 0;
  end if;

  update private.login_throttles as t
  set attempt_count = v_account.attempt_count,
      locked_until = v_account.locked_until,
      lockout_count = v_account.lockout_count,
      updated_at = v_now
  where t.scope = 'account' and t.subject = p_user_id::text;

  perform private.delete_stale_login_sources(p_source);
  return query
  select true, 0, (select c.pin_hash from private.pin_credentials as c where c.user_id = p_user_id);
end;
$$;

comment on function public.pin_login_begin(uuid, text) is 'PINログイン試行を1回予約し、ロック中でなければPINハッシュを返す。service_role専用';

-- ---------------------------------------------------------------------------
-- 成功の記録（アカウント単位の連続試行とロックをリセットする）
-- ---------------------------------------------------------------------------
create function public.pin_login_succeeded(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.login_throttles as t
  set attempt_count = 0,
      locked_until = null,
      lockout_count = 0,
      updated_at = pg_catalog.now()
  where t.scope = 'account' and t.subject = p_user_id::text;
$$;

comment on function public.pin_login_succeeded(uuid) is 'PIN検証成功時に呼ぶ。アカウント単位の試行回数とロックをリセットする。service_role専用';

-- ---------------------------------------------------------------------------
-- PINハッシュの設定（管理スクリプト scripts/auth/set-pin.mts から）
-- ---------------------------------------------------------------------------
create function public.pin_set(p_user_id uuid, p_pin_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles as p where p.id = p_user_id) then
    raise exception 'profile not found for user' using errcode = '23503';
  end if;

  insert into private.pin_credentials (user_id, pin_hash)
  values (p_user_id, p_pin_hash)
  on conflict (user_id) do update set pin_hash = excluded.pin_hash;

  -- 再設定したらアカウント単位のロックも解除する（ロックされた本人の復旧手段）
  delete from private.login_throttles as t
  where t.scope = 'account' and t.subject = p_user_id::text;
end;
$$;

comment on function public.pin_set(uuid, text) is 'PINハッシュを登録・更新し、アカウントのロックを解除する。service_role専用';

-- ---------------------------------------------------------------------------
-- 実行権限: service_role のみ
-- ---------------------------------------------------------------------------
revoke all on function public.pin_login_begin(uuid, text) from public, anon, authenticated;
revoke all on function public.pin_login_succeeded(uuid) from public, anon, authenticated;
revoke all on function public.pin_set(uuid, text) from public, anon, authenticated;
grant execute on function public.pin_login_begin(uuid, text) to service_role;
grant execute on function public.pin_login_succeeded(uuid) to service_role;
grant execute on function public.pin_set(uuid, text) to service_role;
