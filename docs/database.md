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

migration: `supabase/migrations/20260926180000_create_couple_spaces_and_profiles.sql`と修正`20260927090000_fix_member_limit_isolation.sql`。テスト: `supabase/tests/database/couple_space_rls.test.sql`（pgTAP、`npm run db:test`）と`scripts/db/test-member-limit-concurrency.sh`（`npm run db:test:concurrency`）。

### 2人上限

`profiles`のBEFORE INSERT / UPDATE OF `couple_space_id` triggerが、対象`couple_spaces`行を`UPDATE`（`updated_at`の更新）してから同space内の他profile数を数え、2以上なら`check_violation`で拒否する。同じspaceへの同時追加は、この行更新で直列化される。read committedでは先行transactionのcommitを待ち、その後の件数取得は新しいsnapshotで先行分を含めて数える。repeatable read / serializableでは、snapshot取得後に同じspaceへprofileが追加（=space行が更新）されていれば`could not serialize access`（40001）で失敗し、競合が無ければsnapshotの件数は正確なので、分離レベルに依らず上限を超えない。ロック対象は1行だけで、deadlockしない。副作用としてprofile追加・移動のたびにspaceの`updated_at`が更新される。当初の実装（`FOR UPDATE`のみ）はrepeatable read以上で上限を超えられたため、migration `20260927090000_fix_member_limit_isolation.sql`で修正した。triggerは`private` schemaの`SECURITY DEFINER`関数（`search_path = ''`）で、一般ユーザーにはprofilesへの書き込み権限がないため管理者操作でのみ発火する。

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

## 確定済みschema: PIN認証（Gate 1.4）

migration: `supabase/migrations/20260928090000_create_pin_auth.sql`。テスト: `supabase/tests/database/pin_auth.test.sql`、`tests/integration/pin-login.test.ts`。

- `private.pin_credentials`（`user_id` PK→`auth.users` cascade、`pin_hash`は`scrypt$`形式のみ）と`private.login_throttles`（`scope`=`account`/`source`、`subject`、試行回数、window、`locked_until`、`lockout_count`）。どのroleにもテーブル権限を与えない（service_roleも関数経由のみ）。`private` schemaはAPIに公開しない。
- 関数（`public`、`SECURITY DEFINER`、`search_path = ''`、EXECUTEはservice_roleのみ）:
  - `pin_login_begin(user_id, source)`：ロック中なら`allowed=false`と残り秒数。profileとPIN登録のある利用者以外は`allowed=false`・待ち0（アカウント行を作らず、照合もしない）。そうでなければ試行を1回予約し`pin_hash`を返す。行ロックは常にaccount→sourceの順。1日以上前の送信元記録は各呼び出しの最後に`private.delete_stale_login_sources`で削除（他の処理がロック中の行は`skip locked`で飛ばし、ロック順を崩さない）
  - `pin_login_succeeded(user_id)`：アカウントの連続試行・ロック段階をリセット
  - `pin_set(user_id, pin_hash)`：profileのあるユーザーだけ。登録・更新しアカウントのロックを解除
- 制限：送信元（IPのHMAC）は1時間の固定windowで20回（成功も数える）で1時間。アカウント単位のロックは`20261007090000_disable_pin_account_lockout.sql`で廃止（利用者の指示。`pin_login_begin`はアカウント行を作らず、`pin_login_succeeded`・`pin_set`のアカウント行リセットは空振りになる）。
- PIN照合はアプリサーバー（`lib/auth/pin.ts`、scrypt N=2^15・r=8・p=1、pepperは環境変数`PIN_PEPPER`）。

## 確定済みschema: レシピ（Gate 2）

migration: `supabase/migrations/20260929090000_create_recipes.sql`。テスト: `supabase/tests/database/recipes_rls.test.sql`、`tests/integration/recipes.test.ts`。

- `ingredients`（spaceごとの材料マスタ。名前は`lower(btrim(name))`でspace内一意、category 10区分、`default_unit`、`storage_days`（保存目安、nullは目安なし）、`aliases`）
- `recipes`（status `URL_ONLY`/`DRAFT`/`READY`、`dish_type` 主菜/副菜/汁物、`main_category`（推薦の偏り補正用の大分類）、`cuisine`、`servings` 1〜8、`instructions` jsonb配列、`high_cost`/`special_seasoning`/`one_dish`、`tags`、1人前の栄養と`nutrition_source`、`image_path`、`deleted_at`で論理削除）
- `recipe_ingredients`（`raw_name`、`quantity`（null=少々など）、`unit`、`note`、`is_main`、`sort_order`、`ingredient_id`は材料マスタへ（削除時null））
- `recipe_ratings`（`MAKE_AGAIN`/`NORMAL`/`NEVER_AGAIN`）、`recipe_favorites`：主キー(recipe_id, user_id)
- 子テーブルは (親id, couple_space_id) の複合外部キーで、別spaceの親を参照できない
- 権限：authenticatedだけ。recipesはDELETE権限なし（論理削除）。評価・お気に入りは同じspaceで読め、本人の行だけ変更可
- `public.save_recipe(recipe_id, recipe jsonb, ingredients jsonb)`：`SECURITY INVOKER`（RLSが効く）。レシピ本体と材料行を1 transactionで保存し、材料名を材料マスタへ対応付け（無ければ作成）
- Storage：private bucket `recipe-images`（5MB、JPEG/PNG/WebP）。パス先頭が自分のspace IDのものだけ読み書き可

## 確定済みschema: URL取り込みの利用記録と上限（Gate 3）

migration: `supabase/migrations/20260930090000_create_recipe_import_logs.sql`。テスト: `supabase/tests/database/recipe_import_logs.test.sql`。

- `recipe_import_logs`（`source_host`、`method` = `JSON_LD`/`AI`/`NONE`、`outcome` = `PENDING`/`SUCCESS`/`FAILED`、`ai_reserved`、`created_by`、`created_at`、`finished_at`）。URL全体・本文・AIの入出力は保存しない
- 利用者は読むだけ（同じspace）。書き込みは `begin_recipe_import(space, user, host, want_ai)` と `finish_recipe_import(id, method, outcome)`（`SECURITY DEFINER`、**service_role専用**）だけ。Server Actionがsessionで確かめた利用者とspaceを渡して呼ぶ（利用者が枠の返却・消費を偽れない）
- `begin_recipe_import` はspace単位のadvisory lockで直列化し、直近1時間30回を超えたら取り込み自体を止め、日本時間の1日20回（`method = 'AI'`または予約中）を超えたらAIの枠を出さない。AIを使わなかった取り込みは完了時に枠を返す

## 確定済みschema: 在庫（Gate 4）

migration: `supabase/migrations/20261001090000_create_inventory.sql`。テスト: `supabase/tests/database/inventory.test.sql`、`tests/unit/inventory-units-parity.test.ts`。

- `inventory_items`（lot：材料・数量（0以上）・単位・購入日（日本時間）・`source_shopping_item_id`（Gate 6の購入済み、unique））。数量0になったlotは削除
- `inventory_adjustments`（監査：変更前後の量・単位・理由 `MANUAL_ADD`/`MANUAL_EDIT`/`MANUAL_REMOVE`/`PURCHASE`/`PURCHASE_UNDO`/`COOKED`/`HOME_CHECK`・実行者）。更新・削除不可
- `private.unit_base(unit)`：`lib/units`と同じ単位定義（単体テストで一致を確認）
- 利用者は在庫表・監査表を読むだけ（直接の書き込み権限なし）。書き込みは内部関数 `private.inventory_add_lot` / `inventory_set_lot` / `inventory_consume`（`SECURITY DEFINER`、spaceを明示、監査を同じtransactionで記録）に集約
- 利用者が呼べる入口は `inventory_add`（手入力、理由は`MANUAL_ADD`固定、未来日不可）と `inventory_set_quantity`（手動補正、0なら`MANUAL_REMOVE`）だけ。購入済み・作った・家にあるチェックはGate 6 / 7の処理関数だけが内部関数を呼ぶ（理由の偽装を防ぐ）
- `inventory_consume`：互換単位のlotだけ古い順に減らし、lotの小数2桁への丸めで実際に減った量から残りを計算して、減らせなかった量を返す
- 「そろそろ使いたい」は保存せず、購入日と材料の`storage_days`からアプリで算出（`lib/inventory/status.ts`：残りが保存目安の3割（最低1日）以下）

## 確定済みschema: 週間計画（Gate 5）

migration: `supabase/migrations/20261002090000_create_weekly_plans.sql`。テスト: `supabase/tests/database/weekly_plans.test.sql`、`tests/unit/recommendation-weekly.test.ts`。

- `weekly_plans`（`week_start`は月曜、(space, week_start)一意、status `DRAFT`/`CONFIRMED`/`COMPLETED`、`version`）
- `recommendation_runs`（`algorithm_version`、入力の要約、緩和理由の`notes`）と `recommendation_candidates`（順位・点数・内訳・`manual`・`decision` `PENDING`/`ACCEPTED`/`SKIPPED`）
- `meal_sets`（1主菜＝1献立セット：主菜・副菜・汁物・人数・`PLANNED`/`COOKED`・`version`）。設計案の`weekly_main_dishes`は`meal_sets`に統合
- `recipe_histories`（作った記録。推薦の「未調理」「最近作った」。書き込みはGate 7）
- 利用者は読むだけ。書き込みは関数（`SECURITY DEFINER`、関数内で自分のspaceかを確認）：`ensure_weekly_plan`、`save_recommendation_run`（DRAFTのみ、版を進める）、`decide_candidate`（計画行をロックし、DRAFT・最新runの候補だけ。版を進める）、`add_manual_candidate`（もう作らない料理も手動なら可）、`confirm_weekly_plan(plan, version)`（最新runで採用済みの候補がちょうど5品のときだけ、判断順に献立セットを作る。楽観ロック、確定済みへの再送は成功扱い）
- Realtime：`weekly_plans`・`recommendation_candidates`・`meal_sets`（Gate 4で`inventory_items`も）

## 確定済みschema: 買い物（Gate 6）

migration: `supabase/migrations/20261003090000_create_shopping.sql`。テスト: `supabase/tests/database/shopping.test.sql`、`tests/unit/shopping-*.test.ts`、`tests/unit/recommendation-sides.test.ts`。

- `shopping_lists`（週の計画ごとに1つ、`DRAFT`/`CONFIRMED`）、`shopping_items`（基準単位の必要量・在庫差引・買う量、`PLAN`/`INSURANCE`/`MANUAL`、家にある・購入済み・対応する在庫lot）、`shopping_category_orders`（spaceごとの売り場順）
- 利用者は読むだけ。関数（`SECURITY DEFINER`・自分のspaceを確認）：`set_meal_set_sides`、`prepare_shopping_list`（DRAFTなら献立由来の項目を作り直す、確定済みは変えない）、`set_home_check`（不足分を在庫へ`HOME_CHECK`、外すと戻す、DRAFTのみ）、`add_shopping_item` / `remove_shopping_item`（保険・手動）、`confirm_shopping_list`、`set_purchased`（在庫へ`PURCHASE`、行ロックと`source_shopping_item_id`一意で二重加算を防ぐ、取り消しは`PURCHASE_UNDO`）、`set_shopping_category_order`
- 材料の合算・在庫差引（`lib/shopping/aggregate.ts`）、副菜・汁物（`lib/recommendation/sides.ts`）、保険食材（`lib/shopping/insurance.ts`）はアプリの純粋関数で計算してDB関数へ渡す
- Realtime：`shopping_items`・`shopping_lists`（買い物中の2人の同時操作）

## 確定済みschema: 日常利用（Gate 7）

migration: `supabase/migrations/20261004090000_create_meal_histories.sql`。テスト: `supabase/tests/database/meal_histories.test.sql`。

- `rice_portions`（本人のご飯量g、同じspaceで読め本人だけ変更）、`meal_histories`（食べた日・作った人・冪等キー（spaceごとに一意）・料理名と各自の栄養の写し・在庫で減らせなかった材料）、`recipe_histories.meal_history_id`
- 関数（`SECURITY DEFINER`・自分のspaceを確認）：`complete_meal_set(meal_set, key)`（献立セットの行ロック、冪等キー・作った済みなら何もしない、食事履歴・調理履歴・在庫の減算（`private.consume_recipe`→`inventory_consume`、理由COOKED）・献立セットを1 transactionで。全部作ったら週をCOMPLETED。初めて作った料理のIDを返す）、`complete_free_meal`（余裕日、advisory lockで冪等）、`swap_meal_set_dish`（楽観ロック・同じ種類のREADYだけ・作った後は不可）
- 栄養の写し：作った時点のレシピの1人前の値と各自のご飯量を、DB内の`private.meal_nutrition`で算出（クライアントの値は受け取らない）。エネルギー・PFCのどれかが無い料理は推測せず未登録として残す。余裕日は2人分・READYのレシピのみ

## 確定済みschema: 食品成分表と栄養計算（Gate 2b）

migration: `supabase/migrations/20261005090000_create_food_composition.sql`。テスト: `supabase/tests/database/food_composition.test.sql`、`tests/unit/nutrition-recipe.test.ts`、`tests/unit/food-csv.test.ts`。

- `food_composition_items`（版・食品番号で一意、可食部100g当たりのエネルギー・たんぱく質・脂質・炭水化物）。全space共通の参照データで、利用者は読むだけ。取り込みは`scripts/nutrition/import-food-composition.mts`（service role、ユーザーが公式データからCSVを用意）
- `ingredients`に`food_item_id`・`grams_per_unit`（1個当たりg）・`grams_per_ml`（1ml当たりg）
- レシピの1人前は`lib/nutrition/recipe.ts`で計算し、手入力が無いレシピだけ`nutrition_source = CALCULATED`で保存（レシピ保存時・材料の対応付けを変えた時）。換算できない材料があれば保存しない（古い計算値は消す）
- `rice_nutrition_per_100g(food_number default '01088')`、`private.meal_nutrition`を置き換えて作ったときの栄養の写しにご飯を加える

## 確定済みschema: 体重とバックアップ（Gate 8）

migration: `supabase/migrations/20261006090000_create_weight_records.sql`、`20261006100000_create_backup_snapshot.sql`。テスト: `supabase/tests/database/weight_records.test.sql`、`backup_snapshot.test.sql`、`tests/unit/records-summary.test.ts`、`tests/unit/backup-core.test.ts`、CIの復元テスト（`scripts/backup/roundtrip-check.mts`）。

- `weight_records`（user_id既定`auth.uid()`、measured_on、weight_kg 20〜300・小数1桁、`(user_id, measured_on)` unique）。`couple_space_id`を持たず、policyは本人の行だけselect/insert/update/delete。Realtimeのpublicationに入れない。同じ日の入力は上書き（upsert）。利用者の書き込みは未来日と366日より前をtriggerで拒否（service roleの復元は対象外）
- 記録画面の週平均夕食カロリーは`meal_histories.nutrition_per_person`の本人の値のうち完全なものだけで平均する（`lib/records/summary.ts`）
- バックアップ（`lib/backup/core.mts`）はservice role専用のDB関数`public.backup_snapshot()`で全対象テーブルを1つのSQL文（同じスナップショット）から主キー順に読み、gzip JSONでprivate Blobへ保存。対象外：`private.pin_credentials`・`login_throttles`・`recipe_import_logs`・auth.users・画像ファイル。復元は空のprojectへ外部キーの親から入れ、`recommendation_runs.seq`（常に生成されるidentity）は外して元の順に採番し直す

## 後続で必要になる設計事項

- 初期2人のAuth account・profile登録は後続のbootstrap作業（Gate 1.3）で管理者権限により行う。
- `profiles`のUPDATE（表示名変更）を許す場合は、列単位のGRANTとpolicyを別migrationで追加する。
