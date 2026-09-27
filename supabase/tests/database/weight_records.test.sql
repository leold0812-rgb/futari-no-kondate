-- Gate 8: 体重は本人だけ（パートナーにも見せない・Realtimeに出さない）
begin;

select plan(18);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000b');
insert into public.couple_spaces (id) values
  ('10000000-0000-4000-8000-000000000001');
insert into public.profiles (id, couple_space_id, display_name) values
  ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'fixture-a'),
  ('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'fixture-b');

select ok(not has_table_privilege('anon', 'public.weight_records', 'select'), '未ログインでは体重を読めない');
select is(
  (select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'weight_records'),
  0,
  '体重はRealtimeの対象にしない'
);
select ok(
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'weight_records' and column_name = 'couple_space_id'),
  '体重は共有spaceに属さない（本人だけの個人データ）'
);

-- 本人（a）
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.weight_records (measured_on, weight_kg) values ((now() at time zone 'Asia/Tokyo')::date - 1, 60.5)$$,
  '本人は体重を記録できる（user_idは自分になる）'
);
select is((select user_id from public.weight_records), '00000000-0000-4000-8000-00000000000a'::uuid, '記録は自分のものになる');
select throws_ok(
  $$insert into public.weight_records (user_id, measured_on, weight_kg) values ('00000000-0000-4000-8000-00000000000b', (now() at time zone 'Asia/Tokyo')::date - 1, 70)$$,
  '42501',
  null,
  '相手の体重は記録できない'
);
select throws_ok(
  $$insert into public.weight_records (measured_on, weight_kg) values ((now() at time zone 'Asia/Tokyo')::date - 1, 61)$$,
  '23505',
  null,
  '同じ日の記録は1件だけ（入れ直しは上書き）'
);
select throws_ok(
  $$insert into public.weight_records (measured_on, weight_kg) values ((now() at time zone 'Asia/Tokyo')::date - 2, 5)$$,
  '23514',
  null,
  '体重は20〜300kgの範囲だけ'
);
update public.weight_records set weight_kg = 60.2 where measured_on = (now() at time zone 'Asia/Tokyo')::date - 1;
select is((select weight_kg from public.weight_records), 60.2, '本人は自分の記録を直せる');
select throws_ok(
  $$insert into public.weight_records (measured_on, weight_kg) values ((now() at time zone 'Asia/Tokyo')::date + 1, 60)$$,
  '23514',
  null,
  '未来の日付は直接書き込んでも拒否する'
);
select throws_ok(
  $$insert into public.weight_records (measured_on, weight_kg) values ((now() at time zone 'Asia/Tokyo')::date - 367, 60)$$,
  '23514',
  null,
  '1年より前の日付は直接書き込んでも拒否する'
);
select lives_ok(
  $$insert into public.weight_records (measured_on, weight_kg) values ((now() at time zone 'Asia/Tokyo')::date, 60)$$,
  '今日の日付は記録できる'
);
delete from public.weight_records where measured_on = (now() at time zone 'Asia/Tokyo')::date;
reset role;

-- パートナー（b）：同じspaceでも見えない・変えられない
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.weight_records), 0, 'パートナーには体重が見えない');
update public.weight_records set weight_kg = 99 where user_id = '00000000-0000-4000-8000-00000000000a';
delete from public.weight_records where user_id = '00000000-0000-4000-8000-00000000000a';
reset role;
select is(
  (select row(count(*), max(weight_kg))::text from public.weight_records),
  row(1::bigint, 60.2)::text,
  'パートナーは体重を変更・削除できない'
);

-- 本人は削除できる
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$update public.weight_records set user_id = '00000000-0000-4000-8000-00000000000b'$$,
  '42501',
  null,
  '記録を相手へ付け替えられない'
);
delete from public.weight_records;
select is((select count(*)::int from public.weight_records), 0, '本人は自分の記録を削除できる');
reset role;

-- 復元（service role）は古い日付も戻せる
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select lives_ok(
  $$insert into public.weight_records (user_id, measured_on, weight_kg) values ('00000000-0000-4000-8000-00000000000a', '2020-01-01', 60)$$,
  '復元（service role）は1年より前の記録も入れられる'
);
reset role;

-- 未ログイン
set local role anon;
select throws_ok($$select count(*) from public.weight_records$$, '42501', null, '未ログインでは読み取り自体を拒否する');
reset role;

select * from finish();
rollback;
