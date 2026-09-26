# データベース設計案

## 共通規約

- 主キーはUUID、日時は`timestamp with time zone`、週の基準日は`date`を使う。
- 共有テーブルは`couple_space_id`、個人テーブルは`user_id`を必須にする。
- 金額・重量・栄養値は浮動小数ではなく`numeric`を使う。
- `created_at`、`updated_at`を持ち、必要なテーブルは論理削除とする。
- 全テーブルでRLSを有効化し、所有関係を辿れない匿名アクセスを許可しない。

## エンティティ

### 認証・設定

- `couple_spaces`（確定・Gate 1.1）: 共有領域。`id`, `created_at`, `updated_at`。メンバー数は0〜2人
- `profiles`（確定・Gate 1.1）: `id`（`auth.users.id`へのFK、削除はcascade）, `couple_space_id`（必須FK、`on delete restrict`）, `display_name`（1〜30文字、同一space内で重複不可）, `created_at`, `updated_at`。email・PIN・Auth metadataは持たない。`role`列は未追加（使う機能ができた時点で追加する）
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

- `profiles`（確定・Gate 1.1）: authenticatedは同じCoupleSpaceのprofileを最小列（`id`, `couple_space_id`, `display_name`）だけ読める。作成・更新・削除は一般ユーザーに許可しない（本人の表示名更新も現時点では不可）。認証情報は持たない。
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

## 確定済みschema: CoupleSpace / profiles（Gate 1.1）

migration: `supabase/migrations/20260926180000_create_couple_spaces_and_profiles.sql`。テスト: `supabase/tests/database/couple_space_rls.test.sql`（pgTAP、`npm run db:test`）と`scripts/db/test-member-limit-concurrency.sh`（`npm run db:test:concurrency`）。

### 2人上限

`profiles`のBEFORE INSERT / UPDATE OF `couple_space_id` triggerが、対象`couple_spaces`行を`FOR UPDATE`でロックしてから同space内の他profile数を数え、2以上なら`check_violation`で拒否する。同じspaceへの同時追加は行ロックで直列化され、read committedでも後続transactionはcommit済みの先行分を含めて数え直す。ロック対象は1行だけで、deadlockしない。triggerは`private` schemaの`SECURITY DEFINER`関数（`search_path = ''`）で、一般ユーザーにはprofilesへの書き込み権限がないため管理者操作でのみ発火する。

### 権限（誰が何をできるか）

| role | couple_spaces | profiles |
|---|---|---|
| anon | 一切不可（table権限なし） | 一切不可（table権限なし） |
| authenticated（所属あり） | 自分のspaceの`id`, `created_at`のみSELECT | 同じspaceのprofileの`id`, `couple_space_id`, `display_name`のみSELECT |
| authenticated（未所属） | 0行 | 0行 |
| 一般ユーザーの書き込み | INSERT / UPDATE / DELETE不可 | INSERT / UPDATE / DELETE不可（別spaceへの移動も不可） |
| service role / postgres | 初期登録・移動などの管理者操作（bootstrap作業で使用） | 同左。2人上限は管理者操作にも適用される |

- Supabaseの既定privilegesがanon / authenticatedへ付与する権限は、migrationで明示的にREVOKEしてから最小限だけGRANTしている。列単位のSELECTのため、`profiles`の`select *`はauthenticatedでは権限エラーになる（列を明示する）。
- RLS policyは`couple_spaces_select_own_space`と`profiles_select_same_space`の2本（どちらもSELECT・authenticated）。書き込み用policyは作らない（grantsも無いため二重に拒否）。
- 所属判定は`private.current_couple_space_id()`（`SECURITY DEFINER`、`search_path = ''`、EXECUTEはauthenticatedのみ）。`profiles`を直接再帰参照しない。`private` schemaはPostgRESTのexposed schemas（`supabase/config.toml`の`api.schemas`）に含めない。

### 後続で必要になる設計事項

- 初期2人のAuth account・profile登録は後続のbootstrap作業（Gate 1.3）で管理者権限により行う。
- `profiles`のUPDATE（表示名変更）を許す場合は、列単位のGRANTとpolicyを別migrationで追加する。
