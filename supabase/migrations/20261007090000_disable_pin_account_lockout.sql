-- PINを連続で間違えてもアカウントをロックしない（2026-09-27 利用者の指示）
--
-- 変更:
--   * public.pin_login_begin からアカウント単位のロック（連続5回→15/30/60分）を外す
--   * 送信元単位の制限（同じ送信元から1時間20回）は残す。オンラインの総当たりを止める唯一の仕組みのため
--     （6桁PINは100万通り。送信元の制限も外すと、ネット越しに総当たりできてしまう）
--   * 既存のアカウント単位のロックと試行回数を解除する
-- 既存migrationは書き換えず、関数を差し替える（戻り値・引数・権限は変えない）。

create or replace function public.pin_login_begin(p_user_id uuid, p_source text)
returns table (allowed boolean, retry_after_seconds integer, pin_hash text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamp with time zone := pg_catalog.now();
  v_eligible boolean;
  v_source private.login_throttles;
  v_wait integer;
begin
  if p_user_id is null or p_source is null or pg_catalog.char_length(p_source) not between 1 and 128 then
    raise exception 'invalid pin_login_begin arguments' using errcode = '22023';
  end if;

  -- 照合の対象は「profileがありPINを登録済み」の利用者だけ
  v_eligible := exists (
    select 1
    from public.profiles as p
    join private.pin_credentials as c on c.user_id = p.id
    where p.id = p_user_id
  );

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

  v_wait := coalesce(pg_catalog.ceil(extract(epoch from (v_source.locked_until - v_now)))::integer, 0);
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

  perform private.delete_stale_login_sources(p_source);

  if not v_eligible then
    -- allowed = false かつ retry_after_seconds = 0 は「ログインの準備ができていない（PIN未設定など）」
    return query select false, 0, null::text;
    return;
  end if;

  return query
  select true, 0, (select c.pin_hash from private.pin_credentials as c where c.user_id = p_user_id);
end;
$$;

comment on function public.pin_login_begin(uuid, text) is 'PINログイン試行を1回予約し、送信元の制限中でなければPINハッシュを返す（アカウントのロックはしない）。service_role専用';

-- 以前のロックを解除し、アカウント単位の記録は使わないので消す
delete from private.login_throttles where scope = 'account';
