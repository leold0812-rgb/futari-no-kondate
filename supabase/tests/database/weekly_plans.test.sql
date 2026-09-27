-- Gate 5: 週間計画・推薦の保存・判断・確定
begin;

select plan(28);

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
from generate_series(1, 8) as g;
insert into public.recipes (id, couple_space_id, name) values
  ('20000000-0000-4000-8000-000000000099', '10000000-0000-4000-8000-000000000002', 'other-space-recipe');
-- 8番目は2人とも「もう作らない」
insert into public.recipe_ratings (recipe_id, user_id, couple_space_id, rating) values
  ('20000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'NEVER_AGAIN');

select ok(not has_table_privilege('authenticated', 'public.weekly_plans', 'insert'), '計画は直接作れない（関数経由）');
select ok(not has_table_privilege('authenticated', 'public.meal_sets', 'insert'), '献立セットは直接作れない（確定関数経由）');
select ok(not has_table_privilege('authenticated', 'public.recommendation_candidates', 'update'), '候補（判断・点数）は直接更新できない（判断は関数経由）');

select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

create temporary table ids (label text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values ('plan', public.ensure_weekly_plan('2026-09-28'));

select is(public.ensure_weekly_plan('2026-09-28'), (select id from ids where label = 'plan'), '同じ週の計画は1つだけ（2回目は同じ計画を返す）');
select throws_ok($$select public.ensure_weekly_plan('2026-09-29')$$, '22023', null, '週の始まりは月曜だけ');

insert into ids values ('run', public.save_recommendation_run(
  (select id from ids where label = 'plan'), 'weekly-v0.1', '{"recipeCount":7}', '[]',
  (select jsonb_agg(jsonb_build_object('recipe_id', id, 'score', 10, 'breakdown', '[]'::jsonb) order by name)
   from public.recipes where name <> 'fixture-main-8')
));
select is((select count(*)::int from public.recommendation_candidates), 7, '候補を保存できる');
select throws_ok(
  $$select public.save_recommendation_run((select id from ids where label = 'plan'), 'weekly-v0.1', '{}', '[]',
      '[{"recipe_id":"20000000-0000-4000-8000-000000000099"}]')$$,
  '23503',
  null,
  '別spaceのレシピは候補にできない'
);

select public.decide_candidate((select id from public.recommendation_candidates where position = 1), 'ACCEPTED', (select version from public.weekly_plans where id = (select id from ids where label = 'plan')));
select public.decide_candidate((select id from public.recommendation_candidates where position = 2), 'ACCEPTED', (select version from public.weekly_plans where id = (select id from ids where label = 'plan')));
select public.decide_candidate((select id from public.recommendation_candidates where position = 3), 'ACCEPTED', (select version from public.weekly_plans where id = (select id from ids where label = 'plan')));
select public.decide_candidate((select id from public.recommendation_candidates where position = 4), 'SKIPPED', (select version from public.weekly_plans where id = (select id from ids where label = 'plan')));
select is((select count(*)::int from public.recommendation_candidates where decision = 'ACCEPTED'), 3, '判断を保存できる');
select is(
  (select row(decided_by = auth.uid(), decided_at is not null)::text from public.recommendation_candidates where position = 1),
  row(true, true)::text,
  '判断した人と時刻が残る'
);
select throws_ok(
  $$select public.decide_candidate((select id from public.recommendation_candidates limit 1), 'MAYBE', 1)$$,
  '22023',
  null,
  '判断は決められた値だけ'
);

-- もう作らない料理も手動なら追加できる（docs/recommendation.md 必須テスト）
select lives_ok(
  $$select public.add_manual_candidate((select id from ids where label = 'run'), '20000000-0000-4000-8000-000000000008')$$,
  '「もう作らない」の料理も手動なら候補に追加できる'
);
select is(
  (select row(decision, manual)::text from public.recommendation_candidates where recipe_id = '20000000-0000-4000-8000-000000000008'),
  row('ACCEPTED', true)::text,
  '手動追加は採用済み・手動として記録される'
);
reset role;
insert into public.recipes (id, couple_space_id, name, dish_type) values
  ('20000000-0000-4000-8000-000000000051', '10000000-0000-4000-8000-000000000001', 'fixture-side', 'SIDE');
insert into public.recipes (id, couple_space_id, name, status) values
  ('20000000-0000-4000-8000-000000000052', '10000000-0000-4000-8000-000000000001', 'fixture-url-only', 'URL_ONLY');
set local role authenticated;
select throws_ok(
  $$select public.add_manual_candidate((select id from ids where label = 'run'), '20000000-0000-4000-8000-000000000051')$$,
  '23503',
  null,
  '副菜は主菜の候補に手動追加できない'
);
select throws_ok(
  $$select public.add_manual_candidate((select id from ids where label = 'run'), '20000000-0000-4000-8000-000000000052')$$,
  '23503',
  null,
  'URLだけのレシピは主菜の候補に手動追加できない'
);
select throws_ok(
  $$select public.add_manual_candidate((select id from ids where label = 'run'), '20000000-0000-4000-8000-000000000099')$$,
  '23503',
  null,
  '別spaceのレシピは手動でも追加できない'
);

select throws_ok(
  $$select public.confirm_weekly_plan((select id from ids where label = 'plan'), (select version from public.weekly_plans))$$,
  '22023',
  null,
  '採用が5品でなければ確定できない（いま4品）'
);
select throws_ok(
  $$select public.decide_candidate((select id from public.recommendation_candidates where position = 5), 'ACCEPTED', 1)$$,
  '40001',
  null,
  '古い版（相手の判断より前の画面）からの判断は拒否する'
);
select public.decide_candidate((select id from public.recommendation_candidates where position = 5), 'ACCEPTED', (select version from public.weekly_plans where id = (select id from ids where label = 'plan')));
select throws_ok(
  $$select public.confirm_weekly_plan((select id from ids where label = 'plan'), 1)$$,
  '40001',
  null,
  '古い版（判断の前の画面）からの確定は拒否する'
);
select is(
  public.confirm_weekly_plan((select id from ids where label = 'plan'), (select version from public.weekly_plans)),
  (select version + 1 from public.weekly_plans),
  '採用した5品で確定できる'
);
select is(
  (select array_agg(main_recipe_id order by position) from public.meal_sets),
  (select array_agg(recipe_id order by decided_at, position) from public.recommendation_candidates where decision = 'ACCEPTED'),
  '献立セットは採用した候補だけで、判断の順に並ぶ'
);
select is(
  public.confirm_weekly_plan((select id from ids where label = 'plan'), 1),
  (select version from public.weekly_plans),
  '確定済みへの再送は成功扱い（冪等）'
);
select is((select count(*)::int from public.meal_sets), 5, '再送でも献立セットは増えない');
select throws_ok(
  $$select public.decide_candidate((select id from public.recommendation_candidates where position = 6), 'ACCEPTED', (select version from public.weekly_plans where id = (select id from ids where label = 'plan')))$$,
  '55000',
  null,
  '確定後は判断を変えられない'
);
select throws_ok(
  $$select public.save_recommendation_run((select id from ids where label = 'plan'), 'weekly-v0.1', '{}', '[]', '[]')$$,
  '55000',
  null,
  '確定後は候補を出し直せない'
);
reset role;

-- 出し直した後は古い候補を判断できない
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;
insert into ids values ('next-plan', public.ensure_weekly_plan('2026-10-05'));
insert into ids values ('old-run', public.save_recommendation_run((select id from ids where label = 'next-plan'), 'weekly-v0.1', '{}', '[]',
  '[{"recipe_id":"20000000-0000-4000-8000-000000000001"}]'));
select public.save_recommendation_run((select id from ids where label = 'next-plan'), 'weekly-v0.1', '{}', '[]',
  '[{"recipe_id":"20000000-0000-4000-8000-000000000002"}]');
select throws_ok(
  $$select public.decide_candidate((select id from public.recommendation_candidates where run_id = (select id from ids where label = 'old-run')), 'ACCEPTED', (select version from public.weekly_plans where id = (select id from ids where label = 'next-plan')))$$,
  '40001',
  null,
  '出し直す前の古い候補は判断できない'
);
reset role;

-- 別space
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-00000000000d", "role": "authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.weekly_plans), 0, '別spaceの計画は見えない');
select throws_ok(
  $$select public.confirm_weekly_plan((select id from ids where label = 'next-plan'), 1)$$,
  'P0002',
  null,
  '別spaceの計画は確定できない'
);
select isnt(public.ensure_weekly_plan('2026-09-28'), (select id from ids where label = 'plan'), '同じ週でも別spaceは別の計画');
reset role;

select * from finish();
rollback;
