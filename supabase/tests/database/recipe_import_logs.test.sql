-- Gate 3: URL取り込みの予約・上限（begin_recipe_import / finish_recipe_import）と利用記録の権限
-- 予約・完了はservice_role専用（アプリのサーバーがsessionで確かめた利用者とspaceを渡す）
begin;

select plan(17);

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
select ok(not has_table_privilege('authenticated', 'public.recipe_import_logs', 'insert'), '利用記録を直接追加できない');
select ok(not has_table_privilege('authenticated', 'public.recipe_import_logs', 'update'), '利用記録を直接更新できない');
select ok(
  not has_function_privilege('authenticated', 'public.begin_recipe_import(uuid, uuid, text, boolean)', 'execute'),
  '利用者は予約関数を直接呼べない'
);
select ok(
  not has_function_privilege('authenticated', 'public.finish_recipe_import(uuid, text, text)', 'execute'),
  '利用者は完了関数を直接呼べない（枠の返却・消費を偽れない）'
);

set local role service_role;

create temporary table reservation on commit drop as
select * from public.begin_recipe_import(
  '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'recipes.example.com', true);

select is((select row(allowed, ai_allowed)::text from reservation), row(true, true)::text, '上限内ならAIの枠を予約できる');
reset role;
select is(
  (select row(outcome, ai_reserved, created_by)::text from public.recipe_import_logs),
  row('PENDING', true, '00000000-0000-4000-8000-00000000000a'::uuid)::text,
  '予約中の記録が作られる'
);
set local role service_role;
select public.finish_recipe_import((select import_id from reservation), 'JSON_LD', 'SUCCESS');
reset role;
select is(
  (select row(method, outcome, ai_reserved)::text from public.recipe_import_logs),
  row('JSON_LD', 'SUCCESS', false)::text,
  'AIを使わなかった取り込みは枠を返す'
);
set local role service_role;
select public.finish_recipe_import((select import_id from reservation), 'AI', 'SUCCESS');
reset role;
select is((select method from public.recipe_import_logs), 'JSON_LD', '完了済みの記録は書き換えられない');

set local role service_role;
select throws_ok(
  $$select * from public.begin_recipe_import('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'x.example.com', true)$$,
  '42501',
  null,
  '利用者が所属していないspaceでは予約できない'
);
select throws_ok(
  $$select * from public.begin_recipe_import('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', 'x.example.com', true)$$,
  '42501',
  null,
  '未所属の利用者は予約できない'
);
reset role;

-- AIの上限：同じspaceの今日のAI利用が20件あれば、AIの枠は予約できない（取り込み自体はできる）
insert into public.recipe_import_logs (couple_space_id, created_by, source_host, method, outcome, created_at)
select '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'x.example.com', 'AI', 'SUCCESS',
       ((now() at time zone 'Asia/Tokyo')::date::timestamp + interval '12 hours') at time zone 'Asia/Tokyo'
from generate_series(1, 20);

set local role service_role;
select is(
  (select row(allowed, ai_allowed)::text
   from public.begin_recipe_import('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'y.example.com', true)),
  row(true, false)::text,
  '同じspaceの今日のAI利用が20回に達していれば、AIの枠は予約できない（相手の利用も数える）'
);
reset role;

-- 取り込み頻度の上限：直近1時間に30件あれば取り込み自体を止め、記録も作らない
insert into public.recipe_import_logs (couple_space_id, created_by, source_host, method, outcome)
select '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'z.example.com', 'JSON_LD', 'SUCCESS'
from generate_series(1, 30);

set local role service_role;
select is(
  (select row(import_id is null, allowed)::text
   from public.begin_recipe_import('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'w.example.com', false)),
  row(true, false)::text,
  '直近1時間に30回取り込んでいれば、取り込みを止める'
);
select is(
  (select row(allowed, ai_allowed)::text
   from public.begin_recipe_import('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000d', 'a.example.com', true)),
  row(true, true)::text,
  '上限はspaceごと（別spaceは影響を受けない）'
);
reset role;

select is((select count(*)::int from public.recipe_import_logs where source_host = 'w.example.com'), 0, '上限で止めた予約は記録を作らない');

-- 完了しないまま10分を過ぎたAIの予約は枠に数えない
insert into public.recipe_import_logs (couple_space_id, created_by, source_host, ai_reserved, created_at)
select '10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000d', 'stale.example.com', true, now() - interval '11 minutes'
from generate_series(1, 20);
set local role service_role;
select is(
  (select ai_allowed
   from public.begin_recipe_import('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000d', 'b.example.com', true)),
  true,
  '完了しないまま10分を過ぎた予約はAIの枠に数えない'
);
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::int from public.recipe_import_logs where couple_space_id <> '10000000-0000-4000-8000-000000000002'),
  0,
  '利用者は自分のspaceの記録だけ読める'
);
reset role;

select * from finish();
rollback;
