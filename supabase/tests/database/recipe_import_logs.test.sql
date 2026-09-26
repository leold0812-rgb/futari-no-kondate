-- Gate 3: URL取り込みの予約・上限（begin_recipe_import / finish_recipe_import）と利用記録の権限
begin;

select plan(15);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-00000000000c'),
  ('00000000-0000-4000-8000-00000000000d');
insert into public.couple_spaces (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
insert into public.profiles (id, couple_space_id, display_name) values
  ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'fixture-a'),
  ('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'fixture-b'),
  ('00000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-000000000002', 'fixture-d');

select ok(not has_table_privilege('anon', 'public.recipe_import_logs', 'select'), 'anonは利用記録を読めない');
select ok(not has_table_privilege('authenticated', 'public.recipe_import_logs', 'insert'), '利用記録を直接追加できない（予約関数だけ）');
select ok(not has_table_privilege('authenticated', 'public.recipe_import_logs', 'update'), '利用記録を直接更新できない');
select ok(not has_function_privilege('anon', 'public.begin_recipe_import(text, boolean)', 'execute'), 'anonは予約できない');

-- user A: 予約と完了
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

create temporary table reservation on commit drop as
select * from public.begin_recipe_import('recipes.example.com', true);
grant all on reservation to authenticated;

select is((select row(allowed, ai_allowed)::text from reservation), row(true, true)::text, '上限内ならAIの枠を予約できる');
select is(
  (select row(outcome, ai_reserved)::text from public.recipe_import_logs),
  row('PENDING', true)::text,
  '予約中の記録が作られる'
);
select public.finish_recipe_import((select import_id from reservation), 'JSON_LD', 'SUCCESS');
select is(
  (select row(method, outcome, ai_reserved)::text from public.recipe_import_logs),
  row('JSON_LD', 'SUCCESS', false)::text,
  'AIを使わなかった取り込みは枠を返す'
);
select public.finish_recipe_import((select import_id from reservation), 'AI', 'SUCCESS');
select is((select method from public.recipe_import_logs), 'JSON_LD', '完了済みの記録は書き換えられない');
select throws_ok(
  $$select public.finish_recipe_import((select import_id from reservation), 'GPT', 'SUCCESS')$$,
  '22023',
  null,
  '方法は決められた値だけ'
);
reset role;

-- AIの上限：今日のAI利用が20件あれば、AIの枠は予約できない（取り込み自体はできる）
insert into public.recipe_import_logs (couple_space_id, created_by, source_host, method, outcome, created_at)
select '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'x.example.com', 'AI', 'SUCCESS', now() - interval '2 hours'
from generate_series(1, 20);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select row(allowed, ai_allowed)::text from public.begin_recipe_import('y.example.com', true)),
  row(true, false)::text,
  '同じspaceの今日のAI利用が20回に達していれば、AIの枠は予約できない（相手の利用も数える）'
);
reset role;

-- 取り込み頻度の上限：直近1時間に30件あれば取り込み自体を止める
insert into public.recipe_import_logs (couple_space_id, created_by, source_host, method, outcome)
select '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'z.example.com', 'JSON_LD', 'SUCCESS'
from generate_series(1, 30);

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select row(import_id is null, allowed)::text from public.begin_recipe_import('z.example.com', false)),
  row(true, false)::text,
  '直近1時間に30回取り込んでいれば、取り込みを止める'
);
reset role;

-- 別spaceには影響せず、別spaceの記録は見えない
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.recipe_import_logs), 0, '別spaceの利用記録は見えない');
select is(
  (select row(allowed, ai_allowed)::text from public.begin_recipe_import('a.example.com', true)),
  row(true, true)::text,
  '上限はspaceごと（別spaceは影響を受けない）'
);
reset role;

-- 未所属は予約できない
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.begin_recipe_import('a.example.com', true)$$,
  '42501',
  null,
  '未所属の利用者は予約できない'
);
reset role;

select is(
  (select count(*)::int from public.recipe_import_logs where couple_space_id = '10000000-0000-4000-8000-000000000001' and created_by = '00000000-0000-4000-8000-00000000000b' and source_host = 'z.example.com'),
  0,
  '上限で止めた予約は記録を作らない'
);

select * from finish();
rollback;
