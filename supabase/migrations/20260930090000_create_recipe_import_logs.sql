-- Gate 3: URL取り込みの利用記録（AI呼び出しの1日あたり上限の判定に使う）
--
-- 記録するのは取り込み元のホスト名・方法・結果だけ。URL全体・本文・AIの入出力は保存しない（AGENTS.md）。
-- 更新・削除の権限は与えない（上限の回避を防ぐ）。

create table public.recipe_import_logs (
  id uuid primary key default gen_random_uuid(),
  couple_space_id uuid not null default private.current_couple_space_id()
    references public.couple_spaces (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source_host text not null constraint recipe_import_logs_host_length check (char_length(source_host) between 1 and 255),
  -- JSON_LD: ページの構造化データから / AI: OpenAIで構造化 / NONE: 取得・読み取りできず
  method text not null constraint recipe_import_logs_method_check check (method in ('JSON_LD', 'AI', 'NONE')),
  outcome text not null constraint recipe_import_logs_outcome_check check (outcome in ('SUCCESS', 'FAILED')),
  created_at timestamp with time zone not null default now()
);

comment on table public.recipe_import_logs is 'URL取り込みの利用記録（ホスト名・方法・結果のみ）。AI呼び出し回数の上限判定用';

create index recipe_import_logs_space_created_idx on public.recipe_import_logs (couple_space_id, created_at);

revoke all on table public.recipe_import_logs from anon, authenticated;
grant select, insert on table public.recipe_import_logs to authenticated;

alter table public.recipe_import_logs enable row level security;

create policy recipe_import_logs_select_same_space on public.recipe_import_logs
  for select to authenticated
  using (couple_space_id = (select private.current_couple_space_id()));

create policy recipe_import_logs_insert_own on public.recipe_import_logs
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and couple_space_id = (select private.current_couple_space_id())
  );
