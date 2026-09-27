-- Gate 3: URL取り込みの利用記録と上限（AI呼び出しの1日上限・取り込みの頻度上限）
--
-- 記録するのは取り込み元のホスト名・方法・結果だけ。URL全体・本文・AIの入出力は保存しない（AGENTS.md）。
-- 上限の判定と記録は予約関数（begin_recipe_import）で一体に行う。space単位の排他ロックで同時リクエストを直列化する。
-- 予約・完了の関数は service_role 専用で、アプリのサーバー（Server Action）が、sessionで確かめた利用者とspaceを渡して呼ぶ。
-- 利用者はテーブルにも関数にも書き込めない（枠の返却・消費の偽装や上限の回避を防ぐ）。
--   * 取り込み頻度：1 spaceあたり直近1時間に30回（JSON-LDのページも数える。外部取得の乱用を防ぐ）
--   * AI：1 spaceあたり日本時間の1日20回（予約した時点で数え、AIを使わなかった取り込みは完了時に枠を返す）

create table public.recipe_import_logs (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null references public.couple_spaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  source_host text not null constraint recipe_import_logs_host_length check (char_length(source_host) between 1 and 255),
  -- JSON_LD: ページの構造化データから / AI: OpenAIで構造化 / NONE: 取得・読み取りできず（または処理中）
  method text not null default 'NONE' constraint recipe_import_logs_method_check check (method in ('JSON_LD', 'AI', 'NONE')),
  outcome text not null default 'PENDING' constraint recipe_import_logs_outcome_check check (outcome in ('PENDING', 'SUCCESS', 'FAILED')),
  -- AIの枠を予約中か（完了時にAIを使っていなければfalseへ戻して枠を返す）
  ai_reserved boolean not null default false,
  created_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone
);

comment on table public.recipe_import_logs is 'URL取り込みの利用記録（ホスト名・方法・結果のみ）。上限判定用。書き込みは予約・完了関数だけ';

create index recipe_import_logs_space_created_idx on public.recipe_import_logs (couple_space_id, created_at);

revoke all on table public.recipe_import_logs from anon, authenticated;
grant select on table public.recipe_import_logs to authenticated;

alter table public.recipe_import_logs enable row level security;

create policy recipe_import_logs_select_same_space on public.recipe_import_logs
  for select to authenticated
  using (couple_space_id = (select private.current_couple_space_id()));

-- ---------------------------------------------------------------------------
-- 予約：上限を確かめて記録を1件作る（1 transaction・space単位の排他）。service_role専用
-- ---------------------------------------------------------------------------
-- 戻り値: allowed = false なら取り込み自体を行わない（頻度上限）。ai_allowed = true ならAIの枠を1つ予約済み
create function public.begin_recipe_import(p_couple_space_id uuid, p_user_id uuid, p_source_host text, p_want_ai boolean)
returns table (import_id uuid, allowed boolean, ai_allowed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
  v_ai_today integer;
  v_ai boolean;
  v_id uuid;
  v_day_start timestamp with time zone := ((now() at time zone 'Asia/Tokyo')::date)::timestamp at time zone 'Asia/Tokyo';
begin
  -- 呼び出し元（サーバー）が渡した利用者が、そのspaceのメンバーであることを確かめる
  if not exists (
    select 1 from public.profiles as p where p.id = p_user_id and p.couple_space_id = p_couple_space_id
  ) then
    raise exception 'not a member of the couple space' using errcode = '42501';
  end if;
  if p_source_host is null or pg_catalog.char_length(p_source_host) not between 1 and 255 then
    raise exception 'invalid source host' using errcode = '22023';
  end if;

  -- 同じspaceの予約を直列化する（2人が同時に取り込んでも上限を超えない）
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recipe_import:' || p_couple_space_id::text, 0));

  select count(*) into v_recent
  from public.recipe_import_logs as l
  where l.couple_space_id = p_couple_space_id and l.created_at > now() - interval '1 hour';
  if v_recent >= 30 then
    return query select null::uuid, false, false;
    return;
  end if;

  select count(*) into v_ai_today
  from public.recipe_import_logs as l
  where l.couple_space_id = p_couple_space_id
    and l.created_at >= v_day_start
    -- 完了しないまま10分を過ぎた予約（処理の中断・完了記録の失敗）は枠を返したものとみなす。AI呼び出しは30秒で打ち切るため、
    -- 10分を過ぎて使われることはない
    and (l.method = 'AI' or (l.ai_reserved and l.created_at > now() - interval '10 minutes'));
  v_ai := coalesce(p_want_ai, false) and v_ai_today < 20;

  insert into public.recipe_import_logs (couple_space_id, created_by, source_host, ai_reserved)
  values (p_couple_space_id, p_user_id, p_source_host, v_ai)
  returning id into v_id;

  return query select v_id, true, v_ai;
end;
$$;

-- ---------------------------------------------------------------------------
-- 完了：方法と結果を記録し、AIを使わなかった場合は予約した枠を返す。service_role専用
-- ---------------------------------------------------------------------------
create function public.finish_recipe_import(p_import_id uuid, p_method text, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_method not in ('JSON_LD', 'AI', 'NONE') or p_outcome not in ('SUCCESS', 'FAILED') then
    raise exception 'invalid import result' using errcode = '22023';
  end if;
  update public.recipe_import_logs as l
  set method = p_method,
      outcome = p_outcome,
      -- AIを呼んだ記録は method = 'AI' で数え続ける。呼ばなかった予約は枠を返す
      ai_reserved = false,
      finished_at = now()
  where l.id = p_import_id
    and l.outcome = 'PENDING';
end;
$$;

revoke all on function public.begin_recipe_import(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.finish_recipe_import(uuid, text, text) from public, anon, authenticated;
grant execute on function public.begin_recipe_import(uuid, uuid, text, boolean) to service_role;
grant execute on function public.finish_recipe_import(uuid, text, text) to service_role;
