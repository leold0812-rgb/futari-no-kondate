-- Gate 2: レシピ・材料・評価・お気に入り・画像のRLS / grants
-- 実行: `npm run db:test`。fixtureは架空データで、最後にrollbackする。
--   sp1: user A, user B / sp2: user D / user C: 未所属

begin;

select plan(31);

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

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('anon', 'public.recipes', 'select'), 'anonはrecipesを読めない');
select ok(not has_table_privilege('anon', 'public.ingredients', 'select'), 'anonはingredientsを読めない');
select ok(not has_table_privilege('anon', 'public.recipe_ratings', 'select'), 'anonは評価を読めない');
select ok(not has_function_privilege('anon', 'public.save_recipe(uuid, jsonb, jsonb)', 'execute'), 'anonはsave_recipeを実行できない');
select ok(not has_table_privilege('authenticated', 'public.recipes', 'delete'), 'レシピの物理削除権限はない（論理削除のみ）');

-- ---------------------------------------------------------------------------
-- user A（sp1）がレシピを保存
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

create temporary table fixture_ids (label text primary key, id uuid) on commit drop;
grant all on fixture_ids to authenticated;

insert into fixture_ids
select 'recipe-a', public.save_recipe(
  null,
  '{"name":"fixture-recipe","instructions":["焼く"],"tags":["高タンパク"],"main_category":"MEAT"}',
  '[{"raw_name":"鶏もも肉","quantity":300,"unit":"g","ingredient_name":"鶏もも肉","category":"MEAT","storage_days":2,"is_main":true},
    {"raw_name":"塩","unit":"少々","ingredient_name":"塩","category":"SEASONING"}]'
);

select is((select count(*)::int from public.recipes), 1, 'Aは自分のspaceのレシピを保存して読める');
select is((select count(*)::int from public.recipe_ingredients), 2, '材料行が2件保存される');
select is((select count(*)::int from public.ingredients), 2, '材料マスタに2件作られる');
select is(
  (select couple_space_id from public.recipes limit 1),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'couple_space_idは自分のspaceになる'
);

-- 同じ材料名（大文字小文字・前後空白違い）は既存の材料へ対応付ける
insert into fixture_ids
select 'recipe-a2', public.save_recipe(
  null,
  '{"name":"fixture-recipe-2"}',
  '[{"raw_name":"鶏もも肉 ","ingredient_name":" 鶏もも肉","category":"MEAT"}]'
);
select is((select count(*)::int from public.ingredients), 2, '同じ材料名は材料マスタを増やさない');

select lives_ok(
  $$insert into public.recipe_ratings (recipe_id, rating) select id, 'MAKE_AGAIN' from fixture_ids where label = 'recipe-a'$$,
  'Aは自分の評価を付けられる'
);
select lives_ok(
  $$insert into public.recipe_favorites (recipe_id) select id from fixture_ids where label = 'recipe-a'$$,
  'Aはお気に入りに追加できる'
);
select throws_ok(
  $$insert into public.recipe_ratings (recipe_id, user_id, rating)
    select id, '00000000-0000-4000-8000-00000000000b', 'NEVER_AGAIN' from fixture_ids where label = 'recipe-a2'$$,
  '42501',
  null,
  'Aは相手（B）の名前で評価を付けられない'
);
select throws_ok(
  $$delete from public.recipes$$,
  '42501',
  null,
  'レシピは物理削除できない'
);

-- 画像: 自分のspaceのフォルダだけ
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('recipe-images', '10000000-0000-4000-8000-000000000001/r/photo.jpg')$$,
  '自分のspaceのフォルダへ画像を保存できる'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('recipe-images', '10000000-0000-4000-8000-000000000002/r/photo.jpg')$$,
  '42501',
  null,
  '別spaceのフォルダへは画像を保存できない'
);
reset role;

-- ---------------------------------------------------------------------------
-- user B（同じsp1）
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.recipes), 2, 'Bは同じspaceのレシピを読める');
select is((select count(*)::int from public.recipe_ratings), 1, 'Bは相手（A）の評価を読める');
-- RLSで対象外の行は0件更新になる（エラーにはならない）。更新後の値で確かめる
update public.recipe_ratings set rating = 'NEVER_AGAIN';
select is((select rating from public.recipe_ratings limit 1), 'MAKE_AGAIN', 'Bは相手（A）の評価を変更できない');
delete from public.recipe_favorites;
select is((select count(*)::int from public.recipe_favorites), 1, 'Bは相手（A）のお気に入りを外せない');
select lives_ok(
  $$update public.recipes set name = 'fixture-recipe-renamed' where name = 'fixture-recipe'$$,
  'Bは共有レシピを編集できる'
);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'recipe-images'),
  1,
  'Bは同じspaceの画像を読める'
);
reset role;

-- ---------------------------------------------------------------------------
-- user D（別のsp2）
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;

select is((select count(*)::int from public.recipes), 0, 'Dは別spaceのレシピを読めない');
select is((select count(*)::int from public.ingredients), 0, 'Dは別spaceの材料マスタを読めない');
select is((select count(*)::int from public.recipe_ratings), 0, 'Dは別spaceの評価を読めない');
select is((select count(*)::int from storage.objects where bucket_id = 'recipe-images'), 0, 'Dは別spaceの画像を読めない');
update public.recipes set name = 'hacked';
reset role;
select is((select count(*)::int from public.recipes where name = 'hacked'), 0, 'Dは別spaceのレシピを変更できない');
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.recipe_ingredients (recipe_id, raw_name)
    select id, 'x' from fixture_ids where label = 'recipe-a'$$,
  '23503',
  null,
  'Dは別spaceのレシピへ材料行を追加できない（複合外部キー）'
);
select throws_ok(
  $$select public.save_recipe((select id from fixture_ids where label = 'recipe-a'), '{"name":"hacked"}', '[]')$$,
  'P0002',
  null,
  'Dはsave_recipeで別spaceのレシピを上書きできない'
);
reset role;

-- ---------------------------------------------------------------------------
-- user C（未所属）
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000c", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.save_recipe(null, '{"name":"x"}', '[]')$$,
  '42501',
  null,
  '未所属の利用者はレシピを保存できない'
);
select is((select count(*)::int from public.recipes), 0, '未所属の利用者はレシピを読めない');
reset role;

select * from finish();
rollback;
