-- Gate 8: 体重の記録（本人だけ）
--
-- 方針（docs/product-spec.md「体重は完全な個人データ」、docs/database.md RLS方針、docs/architecture.md「体重漏えい」）:
--   * 本人（user_id = auth.uid()）だけが読み書きできる。CoupleSpaceが同じでもパートナーには見せない。
--   * couple_space_idを持たない（共有データの取得・共有APIの対象にしない）。
--   * Realtimeのpublicationへ追加しない。
--   * 1日1件。同じ日に入れ直すと上書きする（仕事後に考える量を減らすため、日付の重複を気にさせない）。
--   * 利用者の書き込みは、未来日と1年（366日）より前の日付を拒否する（画面の検証と同じ。直接の書き込みも同じ制限）。
--     service role（バックアップからの復元）は利用者ではないため対象外（古い記録も戻せるように）。

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

create function private.check_weight_record_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'Asia/Tokyo')::date;
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.measured_on = old.measured_on then
    return new;
  end if;
  if new.measured_on > v_today or new.measured_on < v_today - 366 then
    raise exception 'measured_on must be within the past year'
      using errcode = 'check_violation', constraint = 'weight_records_measured_on_range';
  end if;
  return new;
end;
$$;

create trigger weight_records_check_date
  before insert or update on public.weight_records
  for each row execute function private.check_weight_record_date();
