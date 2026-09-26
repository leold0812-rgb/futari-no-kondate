-- Gate 3: URL取り込みの利用記録（ホスト名・方法・結果のみ）の権限
begin;

select plan(8);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-00000000000d');
insert into public.couple_spaces (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
insert into public.profiles (id, couple_space_id, display_name) values
  ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'fixture-a'),
  ('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'fixture-b'),
  ('00000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-000000000002', 'fixture-d');

select ok(not has_table_privilege('anon', 'public.recipe_import_logs', 'select'), 'anonは利用記録を読めない');
select ok(not has_table_privilege('authenticated', 'public.recipe_import_logs', 'update'), '利用記録は更新できない（上限の回避を防ぐ）');
select ok(not has_table_privilege('authenticated', 'public.recipe_import_logs', 'delete'), '利用記録は削除できない');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.recipe_import_logs (source_host, method, outcome) values ('recipes.example.com', 'AI', 'SUCCESS')$$,
  '自分の利用記録を追加できる'
);
select throws_ok(
  $$insert into public.recipe_import_logs (created_by, source_host, method, outcome)
    values ('00000000-0000-4000-8000-00000000000b', 'x.example.com', 'AI', 'SUCCESS')$$,
  '42501',
  null,
  '相手の名前で利用記録を追加できない'
);
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.recipe_import_logs where method = 'AI'), 1, '同じspaceの相手の利用も上限の計算に含まれる');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.recipe_import_logs), 0, '別spaceの利用記録は見えない');
select throws_ok(
  $$insert into public.recipe_import_logs (source_host, method, outcome) values ('x.example.com', 'GPT', 'SUCCESS')$$,
  '23514',
  null,
  '方法は決められた値だけ'
);
reset role;

select * from finish();
rollback;
