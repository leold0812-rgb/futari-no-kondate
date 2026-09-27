-- Gate 7: 作った（冪等・在庫減算・履歴）、差し替え（楽観ロック）、ご飯量、余裕日
begin;

select plan(23);

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
insert into public.ingredients (id, couple_space_id, name, category) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '鶏もも肉', 'MEAT'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '卵', 'EGG_DAIRY');
insert into public.recipes (id, couple_space_id, name, dish_type, servings) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'main', 'MAIN', 2),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'side-1', 'SIDE', 2),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'side-2', 'SIDE', 2),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'soup', 'SOUP', 2),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'free', 'MAIN', 1);
insert into public.recipe_ingredients (recipe_id, couple_space_id, ingredient_id, raw_name, quantity, unit) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '鶏もも肉', 300, 'g'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '卵', 2, '個'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '卵', 1, '個');
insert into public.weekly_plans (id, couple_space_id, week_start, status) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-09-28', 'CONFIRMED');
insert into public.meal_sets (id, couple_space_id, weekly_plan_id, position, main_recipe_id, side_recipe_id, soup_recipe_id) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 1,
   '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000004');

select ok(not has_table_privilege('authenticated', 'public.meal_histories', 'insert'), '食事履歴は直接作れない（作った処理だけ）');
select ok(not has_table_privilege('authenticated', 'public.recipe_histories', 'insert'), '調理履歴は直接作れない');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select public.inventory_add('30000000-0000-4000-8000-000000000001', 500, 'g', '2026-09-27');
select public.inventory_add('30000000-0000-4000-8000-000000000002', 1, '個', '2026-09-27');

-- 差し替え（楽観ロック）
select is(
  public.swap_meal_set_dish('50000000-0000-4000-8000-000000000001', 'SIDE', '20000000-0000-4000-8000-000000000003', 1),
  2,
  '副菜を差し替えると版が進む'
);
select throws_ok(
  $$select public.swap_meal_set_dish('50000000-0000-4000-8000-000000000001', 'SIDE', '20000000-0000-4000-8000-000000000002', 1)$$,
  '40001',
  null,
  '古い画面からの差し替えは拒否する'
);
select throws_ok(
  $$select public.swap_meal_set_dish('50000000-0000-4000-8000-000000000001', 'SIDE', '20000000-0000-4000-8000-000000000004', 2)$$,
  '23503',
  null,
  '汁物のレシピを副菜にはできない'
);
select public.swap_meal_set_dish('50000000-0000-4000-8000-000000000001', 'SIDE', '20000000-0000-4000-8000-000000000002', 2);

-- 作った
create temporary table result (label text primary key, value jsonb) on commit drop;
grant all on result to authenticated;
insert into result values ('first', public.complete_meal_set('50000000-0000-4000-8000-000000000001', 'key-first-0001'));
select is((select (value ->> 'already')::boolean from result where label = 'first'), false, '作ったを記録できる');
select is(
  (select jsonb_array_length(value -> 'first_time_recipe_ids') from result where label = 'first'),
  3,
  '初めて作った料理（主菜・副菜・汁物）を返す（初回評価のため）'
);
select is(
  (select quantity from public.inventory_items where ingredient_id = '30000000-0000-4000-8000-000000000001'),
  200.00,
  '主菜の材料（鶏もも肉300g）を在庫から減らす'
);
select is(
  (select value -> 'unconsumed' -> 0 ->> 'name' from result where label = 'first'),
  '卵',
  '在庫で足りなかった材料（卵1個分）を返す'
);
select is((select count(*)::int from public.inventory_items where ingredient_id = '30000000-0000-4000-8000-000000000002'), 0, 'あった分の卵は使い切る');
select is((select count(*)::int from public.recipe_histories), 3, '調理履歴を3品分残す');
select is(
  (select row(status, cooked_at is not null)::text from public.meal_sets),
  row('COOKED', true)::text,
  '献立セットが「作った」になる'
);
select is((select status from public.weekly_plans), 'COMPLETED', 'すべて作ると週の計画は完了になる');
select is(
  (select (value ->> 'already')::boolean from (select public.complete_meal_set('50000000-0000-4000-8000-000000000001', 'key-first-0001') as value) as r),
  true,
  '同じ操作の再送は処理済みとして何もしない（冪等）'
);
select is(
  (select (value ->> 'already')::boolean from (select public.complete_meal_set('50000000-0000-4000-8000-000000000001', 'key-other-0002') as value) as r),
  true,
  '相手が別の画面から押しても二重には記録しない'
);
select is((select count(*)::int from public.meal_histories), 1, '食事履歴は1件だけ');
select is(
  (select jsonb_typeof(nutrition_per_person -> '00000000-0000-4000-8000-00000000000a') from public.meal_histories),
  'object',
  '栄養の写しはDBで2人分を算出する（クライアントの値は使わない）'
);
select throws_ok(
  $$select public.swap_meal_set_dish('50000000-0000-4000-8000-000000000001', 'SIDE', null, (select version from public.meal_sets))$$,
  '55000',
  null,
  '作った後は差し替えできない'
);

-- 余裕日
select is(
  (select value ->> 'already' from (select public.complete_free_meal('20000000-0000-4000-8000-000000000005', 'key-free-0001') as value) as r),
  'false',
  '献立に無い料理も作ったを記録できる'
);
select is(
  (select (value ->> 'already')::boolean from (select public.complete_free_meal('20000000-0000-4000-8000-000000000005', 'key-free-0001') as value) as r),
  true,
  '余裕日の作ったも冪等'
);

-- ご飯量
insert into public.rice_portions (user_id, grams) values ('00000000-0000-4000-8000-00000000000a', 150);
select throws_ok(
  $$insert into public.rice_portions (user_id, grams) values ('00000000-0000-4000-8000-00000000000b', 300)$$,
  '42501',
  null,
  '相手のご飯量は設定できない'
);
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is((select grams from public.rice_portions where user_id = '00000000-0000-4000-8000-00000000000a'), 150::smallint, '相手のご飯量は見える（献立画面で表示）');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.complete_meal_set('50000000-0000-4000-8000-000000000001', 'key-hack-0001')$$,
  'P0002',
  null,
  '別spaceの献立は記録できない'
);
reset role;

select * from finish();
rollback;
