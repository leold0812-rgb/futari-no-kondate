-- ログイン画面と体重の記録をやめる（2026-10-08 利用者の指示「ログインは不要、体重記録も不要にしてシンプルに」）
--
-- 変更:
--   * 体重（public.weight_records）とその日付検査を削除する。バックアップの対象からも外す。
--   * PINの仕組み（private.pin_credentials / private.login_throttles と public.pin_login_* / pin_set）を削除する。
--     アプリは代表アカウント1つでsessionを自動発行するため、PINの照合と試行制限は使わない。
--   * RLS・共有データの構造は変えない（アプリはこれまでどおり利用者のsessionで読み書きする）。

-- ---------------------------------------------------------------------------
-- 体重
-- ---------------------------------------------------------------------------
-- 先にバックアップ用の読み出しから weight_records を外す（表を消す前に参照を消す）。
-- 並びは lib/backup/core.mts の BACKUP_TABLES と同じ
create or replace function public.backup_snapshot()
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
    'rice_portions', coalesce((select jsonb_agg(to_jsonb(t) order by t.user_id) from public.rice_portions as t), '[]'::jsonb)
  )
$$;

comment on function public.backup_snapshot() is 'バックアップ用。全対象テーブルを同じスナップショットで読む（service role専用）';

-- 体重の表と、その日付検査（トリガー関数）を消す。トリガー本体は表と一緒に消える
drop table if exists public.weight_records;
drop function if exists private.check_weight_record_date();

-- ---------------------------------------------------------------------------
-- PINの仕組み
-- ---------------------------------------------------------------------------
drop function if exists public.pin_login_begin(uuid, text);
drop function if exists public.pin_login_succeeded(uuid);
drop function if exists public.pin_set(uuid, text);
drop function if exists private.delete_stale_login_sources(text);
drop table if exists private.pin_credentials;
drop table if exists private.login_throttles;
