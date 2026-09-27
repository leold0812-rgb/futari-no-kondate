-- Gate 8: バックアップ用の一括読み出し（service role専用・全対象テーブル）
begin;

select plan(5);

insert into auth.users (id) values ('00000000-0000-4000-8000-00000000000a');
insert into public.couple_spaces (id) values ('10000000-0000-4000-8000-000000000001');
insert into public.profiles (id, couple_space_id, display_name) values
  ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'fixture-a');
insert into public.weight_records (user_id, measured_on, weight_kg) values
  ('00000000-0000-4000-8000-00000000000a', (now() at time zone 'Asia/Tokyo')::date, 60);

select ok(not has_function_privilege('authenticated', 'public.backup_snapshot()', 'execute'), '利用者はバックアップ用の読み出しを実行できない');
select ok(not has_function_privilege('anon', 'public.backup_snapshot()', 'execute'), '未ログインでは実行できない');
select ok(has_function_privilege('service_role', 'public.backup_snapshot()', 'execute'), 'service roleは実行できる');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.backup_snapshot()) as k),
  (select array_agg(k order by k) from unnest(array['couple_spaces','profiles','food_composition_items','ingredients','recipes','recipe_ingredients','recipe_ratings','recipe_favorites','inventory_items','inventory_adjustments','weekly_plans','recommendation_runs','recommendation_candidates','meal_sets','meal_histories','recipe_histories','shopping_lists','shopping_items','shopping_category_orders','rice_portions','weight_records']) as k),
  '全対象テーブルを含む（lib/backup/core.mts の BACKUP_TABLES と同じ）'
);
select is(
  (select row(jsonb_array_length(s -> 'profiles'), jsonb_array_length(s -> 'weight_records'))::text from public.backup_snapshot() as s),
  row(1, 1)::text,
  'service roleはRLSに関係なく全行を読む（体重も含む）'
);
reset role;

select * from finish();
rollback;
