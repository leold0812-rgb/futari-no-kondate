-- Gate 6: 副菜・汁物の設定と買い物リスト（家にあるチェック・保険食材・購入済み・カテゴリ順）
begin;

select plan(25);

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
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '玉ねぎ', 'VEGETABLE'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '冷凍うどん', 'FROZEN');
insert into public.recipes (id, couple_space_id, name, dish_type) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'main', 'MAIN'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'side', 'SIDE'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'soup', 'SOUP');
insert into public.weekly_plans (id, couple_space_id, week_start, status) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-09-28', 'CONFIRMED');
insert into public.meal_sets (id, couple_space_id, weekly_plan_id, position, main_recipe_id) values
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 1, '20000000-0000-4000-8000-000000000001');

select ok(not has_table_privilege('authenticated', 'public.shopping_items', 'update'), '買い物項目は直接更新できない（関数経由）');
select ok(not has_table_privilege('authenticated', 'public.shopping_lists', 'insert'), '買い物リストは直接作れない');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_meal_set_sides('40000000-0000-4000-8000-000000000001',
      '[{"meal_set_id":"50000000-0000-4000-8000-000000000001","side_recipe_id":"20000000-0000-4000-8000-000000000002","soup_recipe_id":"20000000-0000-4000-8000-000000000003"}]')$$,
  '副菜・汁物を設定できる'
);
select is(
  (select row(side_recipe_id, soup_recipe_id)::text from public.meal_sets),
  row('20000000-0000-4000-8000-000000000002'::uuid, '20000000-0000-4000-8000-000000000003'::uuid)::text,
  '献立セットに副菜・汁物が入る'
);

create temporary table ids (label text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values ('list', public.prepare_shopping_list('40000000-0000-4000-8000-000000000001', '[
  {"ingredient_id":"30000000-0000-4000-8000-000000000001","name":"鶏もも肉","category":"MEAT","required_quantity":500,"inventory_quantity":100,"buy_quantity":400,"unit":"g","recipe_names":["main"]},
  {"ingredient_id":"30000000-0000-4000-8000-000000000002","name":"玉ねぎ","category":"VEGETABLE","required_quantity":2,"inventory_quantity":0,"buy_quantity":2,"unit":"個"},
  {"ingredient_id":null,"name":"塩","category":"SEASONING","required_quantity":null,"inventory_quantity":null,"buy_quantity":null,"unit":null}
]'));
select is((select count(*)::int from public.shopping_items), 3, '買い物リストの下書きができる');
select is(
  public.prepare_shopping_list('40000000-0000-4000-8000-000000000001', '[{"name":"x","buy_quantity":1,"unit":"個"}]'),
  (select id from ids where label = 'list'),
  '同じ週のリストは1つ（作り直すと同じリスト）'
);
select is((select count(*)::int from public.shopping_items), 1, '下書きの作り直しで献立由来の項目が入れ替わる');
select public.prepare_shopping_list('40000000-0000-4000-8000-000000000001', '[
  {"ingredient_id":"30000000-0000-4000-8000-000000000001","name":"鶏もも肉","category":"MEAT","required_quantity":500,"inventory_quantity":100,"buy_quantity":400,"unit":"g"},
  {"ingredient_id":"30000000-0000-4000-8000-000000000002","name":"玉ねぎ","category":"VEGETABLE","required_quantity":2,"inventory_quantity":0,"buy_quantity":2,"unit":"個"}
]');

-- 家にあるチェック
select public.set_home_check((select id from public.shopping_items where name = '玉ねぎ'), true);
select is(
  (select row(quantity, unit)::text from public.inventory_items where ingredient_id = '30000000-0000-4000-8000-000000000002'),
  row(2.00, '個')::text,
  '「家にある」にすると不足分が在庫に入る'
);
select public.set_home_check((select id from public.shopping_items where name = '玉ねぎ'), true);
select is((select count(*)::int from public.inventory_items), 1, '家にあるチェックの二重送信でも在庫は1回だけ');
select public.set_home_check((select id from public.shopping_items where name = '玉ねぎ'), false);
select is((select count(*)::int from public.inventory_items), 0, '「買う物に戻す」と登録した在庫を戻す');
select is(
  (select array_agg(reason order by quantity_after) from public.inventory_adjustments),
  array['HOME_CHECK', 'HOME_CHECK'],
  '家にあるチェックは理由 HOME_CHECK で監査に残る'
);

-- 保険食材（同じ材料の二重追加は1件）
select public.add_shopping_item((select id from ids where label = 'list'), '30000000-0000-4000-8000-000000000003', '冷凍うどん', 'FROZEN', 1, '袋', 'INSURANCE');
select public.add_shopping_item((select id from ids where label = 'list'), '30000000-0000-4000-8000-000000000003', '冷凍うどん', 'FROZEN', 1, '袋', 'INSURANCE');
select is((select count(*)::int from public.shopping_items where source = 'INSURANCE'), 1, '保険食材の二重追加は1件にまとまる');
select throws_ok(
  $$select public.add_shopping_item((select id from ids where label = 'list'), null, 'x', 'OTHER', 1, '個', 'PLAN')$$,
  '22023',
  null,
  '献立由来（PLAN）の項目は手動で追加できない'
);

select public.confirm_shopping_list((select id from ids where label = 'list'));
select throws_ok(
  $$select public.set_home_check((select id from public.shopping_items where name = '玉ねぎ'), true)$$,
  '55000',
  null,
  '確定後は家にあるチェックを変えられない'
);
select is(
  public.prepare_shopping_list('40000000-0000-4000-8000-000000000001', '[]'),
  (select id from ids where label = 'list'),
  '確定済みのリストは作り直さない'
);
select is((select count(*)::int from public.shopping_items where source = 'PLAN'), 2, '確定済みのリストの項目は変わらない');

-- 購入済み（冪等・在庫へ加算・取り消し）
select public.set_purchased((select id from public.shopping_items where name = '鶏もも肉'), true);
select public.set_purchased((select id from public.shopping_items where name = '鶏もも肉'), true);
select is(
  (select row(count(*), sum(quantity))::text from public.inventory_items where ingredient_id = '30000000-0000-4000-8000-000000000001'),
  row(1::bigint, 400.00)::text,
  '購入済みは二重送信でも在庫へ1回だけ加算される'
);
select is(
  (select row(purchased_by = auth.uid(), inventory_lot_id is not null)::text from public.shopping_items where name = '鶏もも肉'),
  row(true, true)::text,
  '購入した人と在庫のlotが記録される'
);
select public.set_purchased((select id from public.shopping_items where name = '鶏もも肉'), false);
select is((select count(*)::int from public.inventory_items where ingredient_id = '30000000-0000-4000-8000-000000000001'), 0, '購入済みを取り消すと加算した在庫を戻す');
select is(
  (select array_agg(reason order by created_at, reason) from public.inventory_adjustments where ingredient_id = '30000000-0000-4000-8000-000000000001'),
  array['PURCHASE', 'PURCHASE_UNDO'],
  '購入と取り消しが監査に残る'
);
select public.set_purchased((select id from public.shopping_items where name = '鶏もも肉'), true);
select is((select count(*)::int from public.inventory_items where ingredient_id = '30000000-0000-4000-8000-000000000001'), 1, '取り消し後にもう一度購入済みにできる');

-- カテゴリ順
select public.set_shopping_category_order(array['VEGETABLE','MEAT','FISH','EGG_DAIRY','SOY','GRAIN','SEASONING','DRY_CANNED','FROZEN','OTHER']);
select is((select category from public.shopping_category_orders order by position limit 1), 'VEGETABLE', 'カテゴリ順を保存できる');
select throws_ok(
  $$select public.set_shopping_category_order(array['VEGETABLE','VEGETABLE'])$$,
  '22023',
  null,
  '同じカテゴリを2回並べられない'
);
reset role;

-- 別space
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.shopping_items), 0, '別spaceの買い物は見えない');
select throws_ok(
  $$select public.set_purchased((select id from ids where label = 'list'), true)$$,
  'P0002',
  null,
  '別spaceの項目は購入済みにできない'
);
reset role;

select * from finish();
rollback;
