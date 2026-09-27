-- Gate 2b: 食品成分表（参照データ）と材料の対応付け。数値は架空のテスト用
begin;

select plan(15);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000d');
insert into public.couple_spaces (id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
insert into public.profiles (id, couple_space_id, display_name) values
  ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'fixture-a'),
  ('00000000-0000-4000-8000-00000000000d', '10000000-0000-4000-8000-000000000002', 'fixture-d');
insert into public.food_composition_items (id, source_version, food_number, name, energy_kcal, protein_g, fat_g, carbs_g) values
  ('60000000-0000-4000-8000-000000000001', 'test-v1', '01088', 'テスト用めし', 100, 1, 0.5, 20),
  ('60000000-0000-4000-8000-000000000002', 'test-v1', '99999', 'テスト用食品', 200, 10, 5, 1);
insert into public.ingredients (id, couple_space_id, name) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'テスト材料');

select ok(not has_table_privilege('anon', 'public.food_composition_items', 'select'), 'anonは食品成分表を読めない');
select ok(not has_table_privilege('authenticated', 'public.food_composition_items', 'insert'), '利用者は食品成分表を書き換えられない');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.food_composition_items), 2, 'ログインした利用者は食品成分表を読める（全space共通）');
select is(
  (select row(energy_kcal, source_version)::text from public.rice_nutrition_per_100g()),
  row(100.0::numeric, 'test-v1')::text,
  'ご飯（食品番号01088）の100g当たりを返す'
);
select lives_ok(
  $$update public.ingredients set food_item_id = '60000000-0000-4000-8000-000000000002', grams_per_unit = 50 where id = '30000000-0000-4000-8000-000000000001'$$,
  '材料に食品と重さを対応付けられる'
);
select throws_ok(
  $$update public.ingredients set grams_per_unit = 0 where id = '30000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  '重さは0より大きい値だけ'
);
select throws_ok(
  $$update public.food_composition_items set energy_kcal = 0$$,
  '42501',
  null,
  '食品成分表の値は変えられない'
);
reset role;

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
update public.ingredients set food_item_id = null;
reset role;
select is(
  (select food_item_id from public.ingredients where id = '30000000-0000-4000-8000-000000000001'),
  '60000000-0000-4000-8000-000000000002'::uuid,
  '別spaceの利用者は材料の対応付けを変えられない'
);
delete from public.food_composition_items where id = '60000000-0000-4000-8000-000000000002';
select is(
  (select food_item_id from public.ingredients where id = '30000000-0000-4000-8000-000000000001'),
  null,
  '食品を消すと材料の対応付けは外れる'
);

insert into public.rice_portions (user_id, couple_space_id, grams) values ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 150);
insert into public.recipes (id, couple_space_id, name, energy_kcal, protein_g, fat_g, carbs_g) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'テスト料理', 300, 10, 10, 30);
select is(
  (select private.meal_nutrition('10000000-0000-4000-8000-000000000001', array['20000000-0000-4000-8000-000000000001'::uuid])
     -> '00000000-0000-4000-8000-00000000000a' ->> 'energyKcal'),
  '450',
  '作ったときの栄養の写しに、ご飯（150g × 100kcal/100g）を加える'
);
select is(
  (select (private.meal_nutrition('10000000-0000-4000-8000-000000000001', array['20000000-0000-4000-8000-000000000001'::uuid])
     -> '00000000-0000-4000-8000-00000000000a') - 'energyKcal' - 'riceGrams'),
  '{"fatG": 10.8, "carbsG": 60.0, "missing": [], "complete": true, "proteinG": 11.5}'::jsonb,
  'ご飯のPFCも加え、すべてそろえば完全扱い'
);

-- 新しい版を取り込んだら、その版のご飯を使う（版名の文字列順ではなく取り込んだ順）
insert into public.food_composition_items (source_version, food_number, name, energy_kcal, protein_g, fat_g, carbs_g, created_at) values
  ('a-newer', '01088', 'テスト用めし（新しい版）', 200, 2, 1, 40, now() + interval '1 minute');
select is((select source_version from public.rice_nutrition_per_100g()), 'a-newer', '最後に取り込んだ版のご飯を使う');
select is(
  (select private.meal_nutrition('10000000-0000-4000-8000-000000000001', array['20000000-0000-4000-8000-000000000001'::uuid])
     -> '00000000-0000-4000-8000-00000000000a' ->> 'energyKcal'),
  '600',
  '作ったの写しも最後に取り込んだ版のご飯で計算する'
);

-- 成分表にご飯が無ければ「ご飯」を未登録として残す
delete from public.food_composition_items where food_number = '01088';
select is(
  (select private.meal_nutrition('10000000-0000-4000-8000-000000000001', array['20000000-0000-4000-8000-000000000001'::uuid])
     -> '00000000-0000-4000-8000-00000000000a' -> 'missing'),
  '["ご飯"]'::jsonb,
  '成分表にご飯が無ければ、ご飯を未登録として残す'
);

-- ご飯0gならご飯の値は不要で、料理だけで完全扱い
update public.rice_portions set grams = 0 where user_id = '00000000-0000-4000-8000-00000000000a';
select is(
  (select private.meal_nutrition('10000000-0000-4000-8000-000000000001', array['20000000-0000-4000-8000-000000000001'::uuid])
     -> '00000000-0000-4000-8000-00000000000a' ->> 'complete'),
  'true',
  'ご飯0gなら成分表にご飯が無くても完全扱い'
);

select * from finish();
rollback;
