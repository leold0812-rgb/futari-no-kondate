-- Gate 8: 体重の記録（本人だけ）
--
-- 方針（docs/product-spec.md「体重は完全な個人データ」、docs/database.md RLS方針、docs/architecture.md「体重漏えい」）:
--   * 本人（user_id = auth.uid()）だけが読み書きできる。CoupleSpaceが同じでもパートナーには見せない。
--   * couple_space_idを持たない（共有データの取得・共有APIの対象にしない）。
--   * Realtimeのpublicationへ追加しない。
--   * 1日1件。同じ日に入れ直すと上書きする（仕事後に考える量を減らすため、日付の重複を気にさせない）。

create table public.weight_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_on date not null,
  weight_kg numeric(4, 1) not null constraint weight_records_weight_range check (weight_kg between 20 and 300),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint weight_records_user_day_key unique (user_id, measured_on)
);

comment on table public.weight_records is '体重（本人だけが読み書きできる個人データ。パートナー・共有API・Realtimeへ出さない）';

create index weight_records_user_measured_on_idx on public.weight_records (user_id, measured_on desc);

revoke all on table public.weight_records from anon, authenticated;
grant select, insert, update, delete on table public.weight_records to authenticated;
alter table public.weight_records enable row level security;

create policy weight_records_select_own on public.weight_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy weight_records_insert_own on public.weight_records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy weight_records_update_own on public.weight_records
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy weight_records_delete_own on public.weight_records
  for delete to authenticated using (user_id = (select auth.uid()));

create trigger weight_records_set_updated_at
  before update on public.weight_records
  for each row execute function private.set_updated_at();
