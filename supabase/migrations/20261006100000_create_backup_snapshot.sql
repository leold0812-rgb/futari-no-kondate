-- Gate 8: バックアップ用の一括読み出し
--
-- テーブルごとに別々に読むと、実行中の更新をまたいだとき「親を読んだ後に追加された子」だけが入り、
-- 復元で外部キー違反になり得る。1つのSQL文（1つのスナップショット）で全テーブルを読む。
-- 対象と並びは lib/backup/core.mts の BACKUP_TABLES と同じ（テスト: supabase/tests/database/backup_snapshot.test.sql）。
-- 実行できるのはservice role（Cronのバックアップ・管理スクリプト）だけ。利用者には体重を含む全データを返さない。

create function public.backup_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'couple_spaces', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.couple_spaces as t), '[]'::jsonb),
    'profiles', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.profiles as t), '[]'::jsonb),
    'food_composition_items', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.food_composition_items as t), '[]'::jsonb),
    'ingredients', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.ingredients as t), '[]'::jsonb),
    'recipes', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.recipes as t), '[]'::jsonb),
    'recipe_ingredients', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.recipe_ingredients as t), '[]'::jsonb),
    'recipe_ratings', coalesce((select jsonb_agg(to_jsonb(t) order by t.recipe_id, t.user_id) from public.recipe_ratings as t), '[]'::jsonb),
    'recipe_favorites', coalesce((select jsonb_agg(to_jsonb(t) order by t.recipe_id, t.user_id) from public.recipe_favorites as t), '[]'::jsonb),
    'inventory_items', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.inventory_items as t), '[]'::jsonb),
    'inventory_adjustments', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.inventory_adjustments as t), '[]'::jsonb),
    'weekly_plans', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.weekly_plans as t), '[]'::jsonb),
    'recommendation_runs', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.recommendation_runs as t), '[]'::jsonb),
    'recommendation_candidates', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.recommendation_candidates as t), '[]'::jsonb),
    'meal_sets', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.meal_sets as t), '[]'::jsonb),
    'meal_histories', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.meal_histories as t), '[]'::jsonb),
    'recipe_histories', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.recipe_histories as t), '[]'::jsonb),
    'shopping_lists', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.shopping_lists as t), '[]'::jsonb),
    'shopping_items', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.shopping_items as t), '[]'::jsonb),
    'shopping_category_orders', coalesce((select jsonb_agg(to_jsonb(t) order by t.couple_space_id, t.category) from public.shopping_category_orders as t), '[]'::jsonb),
    'rice_portions', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id) from public.rice_portions as t), '[]'::jsonb),
    'weight_records', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.weight_records as t), '[]'::jsonb)
  )
$$;

comment on function public.backup_snapshot() is 'バックアップ用。全対象テーブルを同じスナップショットで読む（service role専用）';

revoke all on function public.backup_snapshot() from public, anon, authenticated;
grant execute on function public.backup_snapshot() to service_role;
