-- Gate 4: 在庫（lot）と監査、互換単位だけの減算
begin;

select plan(20);

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
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '醤油', 'SEASONING'),
  ('30000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000002', '別spaceの材料', 'OTHER');

select ok(not has_table_privilege('anon', 'public.inventory_items', 'select'), 'anonは在庫を読めない');
select ok(not has_table_privilege('authenticated', 'public.inventory_adjustments', 'update'), '監査は更新できない');
select ok(not has_table_privilege('authenticated', 'public.inventory_adjustments', 'delete'), '監査は削除できない');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$select public.inventory_add('30000000-0000-4000-8000-000000000001', 300, 'g', '2026-09-20')$$,
  '在庫を追加できる'
);
select public.inventory_add('30000000-0000-4000-8000-000000000001', 0.5, 'kg', '2026-09-25');
select public.inventory_add('30000000-0000-4000-8000-000000000001', 2, 'パック', '2026-09-26');
select public.inventory_add('30000000-0000-4000-8000-000000000002', 3, '大さじ', '2026-09-01');

select throws_ok(
  $$select public.inventory_add('30000000-0000-4000-8000-000000000001', 0, 'g')$$,
  '22023',
  null,
  '0以下の量は追加できない'
);
select throws_ok(
  $$select public.inventory_add('30000000-0000-4000-8000-000000000009', 100, 'g')$$,
  '23503',
  null,
  '別spaceの材料には在庫を追加できない'
);
select throws_ok(
  $$insert into public.inventory_items (ingredient_id, quantity, unit) values ('30000000-0000-4000-8000-000000000001', -1, 'g')$$,
  '23514',
  null,
  '数量は0未満にできない'
);

-- 互換単位（質量）のlotだけを古い順に減らす
select is(public.inventory_consume('30000000-0000-4000-8000-000000000001', 400, 'g'), 0.00, '400gは古いlot（300g）と次のlotから減らせる');
select is(
  (select array_agg(quantity::text || coalesce(unit, '') order by purchased_on) from public.inventory_items where ingredient_id = '30000000-0000-4000-8000-000000000001'),
  array['0.40kg', '2.00パック'],
  '300gのlotは使い切って消え、0.5kgは0.4kgになり、パックは変わらない'
);
select is(public.inventory_consume('30000000-0000-4000-8000-000000000001', 1, 'kg'), 0.60, '足りない分（0.6kg）を返す');
select is(public.inventory_consume('30000000-0000-4000-8000-000000000001', 1, '個'), 1.00, '互換のない単位（個）は減らさずに全量を返す');
select is(
  (select quantity from public.inventory_items where ingredient_id = '30000000-0000-4000-8000-000000000001'),
  2.00,
  'パックのlotはそのまま'
);
select is(public.inventory_consume('30000000-0000-4000-8000-000000000002', 2, '小さじ'), 0.00, '大さじのlotから小さじ分を減らせる（体積どうし）');
select is(
  (select quantity from public.inventory_items where ingredient_id = '30000000-0000-4000-8000-000000000002'),
  2.33,
  '大さじ3 − 小さじ2 = 大さじ2.33'
);

-- 手動補正と監査
select public.inventory_set_quantity((select id from public.inventory_items where unit = 'パック'), 1);
select is(
  (select row(reason, quantity_before, quantity_after)::text from public.inventory_adjustments where unit = 'パック' and reason = 'MANUAL_EDIT'),
  row('MANUAL_EDIT', 2.00, 1.00)::text,
  '手動補正は変更前後を監査に残す'
);
select is(
  (select count(*)::int from public.inventory_adjustments where reason = 'COOKED' and actor_id = '00000000-0000-4000-8000-00000000000a'),
  4,
  '減算はlotごとに実行者つきで監査に残る（300g・0.5kg×2回・大さじ）'
);
select throws_ok(
  $$select public.inventory_set_quantity((select id from public.inventory_items where unit = 'パック'), 1, 'COOKED')$$,
  '22023',
  null,
  '補正の理由は決められた値だけ'
);
reset role;

-- 同じspaceの相手は読めて補正でき、別spaceからは見えない
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.inventory_items), 2, '同じspaceの相手も在庫を読める');
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.inventory_items), 0, '別spaceの在庫は見えない');
select throws_ok(
  $$select public.inventory_set_quantity((select id from public.inventory_items limit 1), 5)$$,
  'P0002',
  null,
  '別spaceの在庫は補正できない（見つからない）'
);
reset role;

select * from finish();
rollback;
