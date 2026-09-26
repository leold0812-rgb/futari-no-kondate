# データベース設計案

## 共通規約

- 主キーはUUID、日時は`timestamp with time zone`、週の基準日は`date`を使う。
- 共有テーブルは`couple_space_id`、個人テーブルは`user_id`を必須にする。
- 金額・重量・栄養値は浮動小数ではなく`numeric`を使う。
- `created_at`、`updated_at`を持ち、必要なテーブルは論理削除とする。
- 全テーブルでRLSを有効化し、所有関係を辿れない匿名アクセスを許可しない。

## エンティティ

### 認証・設定

- `profiles`: `id = auth.users.id`, `display_name`, `couple_space_id`, `role`, `created_at`
- `couple_spaces`: 共有領域。固定2名を上限とする制約はDB functionで検証
- `user_preferences`: `user_id`, ご飯量、表示設定
- `shopping_category_orders`: `couple_space_id`, category, position

### レシピ

- `recipes`: 共有、name, source_url, import_status, image_path, dish_type, cuisine, taste, servings, cooking_minutes, instructions(jsonb), high_cost, special_seasoning, one_dish, nutrition_per_serving, timestamps
- `ingredients`: 共有、canonical_name, category, canonical_unit, storage_days, aliases
- `recipe_ingredients`: recipe_id, ingredient_id(nullable), raw_name, quantity(nullable), unit, note, sort_order
- `recipe_ratings`: recipe_id + user_id unique, rating(`MAKE_AGAIN/NORMAL/NEVER_AGAIN`)
- `recipe_favorites`: recipe_id + user_id unique
- `recipe_histories`: recipe_id, couple_space_id, cooked_by, cooked_at, meal_history_id
- `food_composition_items`: 食品成分表の版・食品番号・100g当たり栄養
- `ingredient_food_mappings`: ingredient_id, food_item_id, edible_ratio, mapping_status, reviewed_by

### 在庫

- `inventory_items`: couple_space_id + ingredient_id + lot識別、quantity, unit, purchased_at, source_shopping_item_id, status override
- 数量0未満は禁止。互換単位へ変換できるlotだけを古い順に減算する。
- 状態は保存日数と購入日からqueryで算出し、手動の残量区分だけ必要に応じて保持する。

### 週間献立

- `weekly_plans`: couple_space_id, week_start, status(`DRAFT/CONFIRMED/COMPLETED`), confirmed_at, version。`(couple_space_id, week_start)` unique
- `weekly_main_dishes`: weekly_plan_id, recipe_id, selected_order, candidate_score_snapshot, status
- `meal_sets`: weekly_main_dish_id, main_recipe_id, side_recipe_id(nullable), soup_recipe_id(nullable), status, cooked_at
- `recommendation_runs`: weekly_plan_id, algorithm_version, input_snapshot, generated_at
- `recommendation_candidates`: run_id, recipe_id, score, score_breakdown, position, decision

### 買い物・履歴

- `shopping_lists`: weekly_plan_id unique, couple_space_id, status, version
- `shopping_items`: shopping_list_id, ingredient_id(nullable), name_snapshot, required_quantity, inventory_quantity, buy_quantity, unit, category, is_insurance, checked_at, checked_by, inventory_applied_at
- `meal_histories`: couple_space_id, meal_set_id(nullable), eaten_at, nutrition_snapshot, completed_by, idempotency_key unique
- `weight_records`: user_id, measured_on, weight_kg。`(user_id, measured_on)` unique
- `rice_portions`: user_id unique, grams

## RLS方針

- `profiles`: 本人は自分を更新。同じCoupleSpaceの表示名は読めるが認証情報は持たない。
- 共有テーブル：`auth.uid()`のprofileと同じ`couple_space_id`だけselect/insert/update/delete可能。
- `weight_records`: `user_id = auth.uid()`のみ。CoupleSpace一致による閲覧は絶対に許可しない。
- `recipe_ratings` / `recipe_favorites`: 同じ空間内レシピを対象に、本人行だけ変更可能。表示上の集約は安全なview/functionを使う。
- バックアップ用service roleは通常UIから到達できないCron routeだけで使う。

## 整合性と同時実行

- 週間二重作成：`weekly_plans`のunique制約で防止する。
- 購入済み：`inventory_applied_at is null`の行だけ、DB transaction内で在庫加算して時刻を設定する。
- 作った：`idempotency_key`を受け、履歴作成・meal set更新・在庫減算を1 transactionで行う。
- 献立差し替え：`version`による楽観ロックを使い、古い画面からの上書きを拒否する。
- 在庫補正：調整前後と実行者を監査テーブルへ残す。

## 未確定事項（実装を止めない）

- 材料の容量↔重量換算は食材固有密度が必要なため、初期版は明示マスタがあるものだけ対応する。
- 「もう作らない」は本人の嗜好として保持し、候補生成では2人のどちらかが指定した料理を通常除外する。手動追加は許可する。
- 画像バックアップ範囲はPhase 12でストレージ容量を測って確定する。

