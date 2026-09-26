-- Gate 5: 週間計画・推薦の保存・判断・確定
begin;

select plan(22);

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
insert into public.recipes (id, couple_space_id, name, instructions)
select ('20000000-0000-4000-8000-00000000000' || g)::uuid, '10000000-0000-4000-8000-000000000001', 'fixture-main-' || g, '["x"]'
from generate_series(1, 7) as g;
insert into public.recipes (id, couple_space_id, name) values
  ('20000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000002', 'other-space-recipe');

select ok(not has_table_privilege('authenticated', 'public.weekly_plans', 'insert'), '計画は直接作れない（関数経由）');
select ok(not has_table_privilege('authenticated', 'public.meal_sets', 'insert'), '献立セットは直接作れない（確定関数経由）');
select ok(not has_column_privilege('authenticated', 'public.recommendation_candidates', 'score', 'update'), '候補の点数は書き換えられない');
select ok(has_column_privilege('authenticated', 'public.recommendation_candidates', 'decision', 'update'), '候補の判断は更新できる');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

create temporary table ids (label text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values ('plan', public.ensure_weekly_plan('2026-09-28'));

select is(public.ensure_weekly_plan('2026-09-28'), (select id from ids where label = 'plan'), '同じ週の計画は1つだけ（2回目は同じ計画を返す）');
select throws_ok($$select public.ensure_weekly_plan('2026-09-29')$$, '22023', null, '週の始まりは月曜だけ');

insert into ids values ('run', public.save_recommendation_run(
  (select id from ids where label = 'plan'), 'weekly-v0.1', '{"recipeCount":7}', '[]',
  (select jsonb_agg(jsonb_build_object('recipe_id', id, 'score', 10, 'breakdown', '[]'::jsonb) order by name) from public.recipes)
));
select is((select count(*)::int from public.recommendation_candidates), 7, '候補を保存できる');
select throws_ok(
  $$select public.save_recommendation_run((select id from ids where label = 'plan'), 'weekly-v0.1', '{}', '[]',
      '[{"recipe_id":"20000000-0000-4000-8000-000000000099"}]')$$,
  '23503',
  null,
  '別spaceのレシピは候補にできない'
);

update public.recommendation_candidates set decision = 'ACCEPTED', decided_at = now(), decided_by = auth.uid() where position <= 4;
update public.recommendation_candidates set decision = 'SKIPPED' where position = 5;
select is((select count(*)::int from public.recommendation_candidates where decision = 'ACCEPTED'), 4, '判断を保存できる');
select throws_ok(
  $$update public.recommendation_candidates set score = 999$$,
  '42501',
  null,
  '点数は更新できない'
);

select lives_ok(
  $$select public.add_manual_candidate((select id from ids where label = 'run'), '20000000-0000-4000-8000-000000000005')$$,
  '候補を手動で採用できる（スキップ済みでも）'
);
select throws_ok(
  $$select public.add_manual_candidate((select id from ids where label = 'run'), '20000000-0000-4000-8000-000000000099')$$,
  '23503',
  null,
  '別spaceのレシピは手動でも追加できない'
);

select throws_ok(
  $$select public.confirm_weekly_plan((select id from ids where label = 'plan'), 99,
      (select jsonb_agg(jsonb_build_object('main_recipe_id', recipe_id) order by position) from public.recommendation_candidates where decision = 'ACCEPTED'))$$,
  '40001',
  null,
  '古い版からの確定は拒否する（楽観ロック）'
);
select throws_ok(
  $$select public.confirm_weekly_plan((select id from ids where label = 'plan'), 1,
      '[{"main_recipe_id":"20000000-0000-4000-8000-000000000001"},{"main_recipe_id":"20000000-0000-4000-8000-000000000001"}]')$$,
  '22023',
  null,
  '同じ主菜を2回選べない'
);
select is(
  public.confirm_weekly_plan((select id from ids where label = 'plan'), 1,
    (select jsonb_agg(jsonb_build_object('main_recipe_id', recipe_id) order by position) from public.recommendation_candidates where decision = 'ACCEPTED')),
  2,
  '5品で確定できる（版が1つ進む）'
);
select is((select count(*)::int from public.meal_sets), 5, '献立セットが5つ作られる');
select is(
  public.confirm_weekly_plan((select id from ids where label = 'plan'), 1,
    (select jsonb_agg(jsonb_build_object('main_recipe_id', recipe_id) order by position) from public.recommendation_candidates where decision = 'ACCEPTED')),
  2,
  '同じ内容の二重送信は成功扱い（冪等）'
);
select is((select count(*)::int from public.meal_sets), 5, '二重送信でも献立セットは増えない');
select throws_ok(
  $$select public.save_recommendation_run((select id from ids where label = 'plan'), 'weekly-v0.1', '{}', '[]', '[]')$$,
  '55000',
  null,
  '確定後は候補を出し直せない'
);
reset role;

-- 別space
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.weekly_plans), 0, '別spaceの計画は見えない');
select throws_ok(
  $$select public.confirm_weekly_plan((select id from ids where label = 'plan'), 2, '[{"main_recipe_id":"20000000-0000-4000-8000-000000000099"}]')$$,
  'P0002',
  null,
  '別spaceの計画は確定できない'
);
select isnt(public.ensure_weekly_plan('2026-09-28'), (select id from ids where label = 'plan'), '同じ週でも別spaceは別の計画');
reset role;

select * from finish();
rollback;
