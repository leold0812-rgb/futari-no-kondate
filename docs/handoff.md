# Handoff

更新日: 2026-09-29（Gate 0〜8とPR #7〜#17がmainへマージ済み。UI刷新PR #19、速度・初回利用改善PR #20を作成）

v1実装の全体計画・進捗・判断ログ：[docs/tasks/app-v1-plan.md](tasks/app-v1-plan.md)

## 利用者の3つの要望への対応（2026-10-01）

- **遅い**：PR #21（マージ済み）でVercelの関数を東京（hnd1）へ。PR #22（#20の上）で買い物・献立の読み込みをまとめ、購入チェック後の二重の読み直しをなくした（`lib/realtime/local-write.ts`）。
- **材料の入力**：`components/recipes/recipe-form.tsx` の材料行を「数量（選ぶ／入力）＋単位（選ぶ）」に変更。選択肢は `lib/units/amount-choices.ts`。読み取りの強化は `lib/units/index.ts`（parseAmount）と `lib/ingredients/index.ts`（splitIngredientLine）。
- **Instagram**：`lib/import/instagram.ts`（埋め込み用ページから文章を取得）、`lib/import/recipe-text.ts`（AIなしで「材料」「作り方」を読む）、`importRecipeFromText` / `importRecipeTextAction`（貼り付け）。利用者が試した投稿は文章にレシピが無く（動画のみ）、その場合は理由を表示する。
- テスト：unit 432件（`amount-choices`・`recipe-text`・`local-write` ほか）、E2E `02-recipes`（単位・数量の選択）・`03-import`（貼り付け）。DB変更・環境変数の変更なし。
- 未対応：在庫の手動追加・買い物の手動追加の分量欄は従来の1欄のまま（同じ部品へ寄せるのは次の候補）。AIでの読み取りは `OPENAI_API_KEY`（手順書H）が未登録。

## 表示速度と初回利用の改善（2026-09-29、PR #20）

- PR #19を土台に別ブランチ `codex/home-speed-ux` を作成。
- 利用者の要望で、献立未決定ホームをスマートフォン1画面内に収める調整を追加。480px以下はイラストをカード内で本文と重ね、カードと間隔を圧縮。720px以下の短い画面向けにも追加の高さ調整を行い、手順リンクは46px以上を維持する。
- PR #20の計測前CI（ローカルSupabase・iPhone相当Chromium）は、献立なし158ms／献立あり208ms、TTFB 41ms／68ms（当時はページ全体の`load`を待ってから見出しを確認する計測）。修正後の最新CIは、見出し表示624ms／443ms、全体`load` 626ms／445ms、TTFB 62ms／28ms。計測方法とランナーに差があるため前後比較には使わず、CI内の目安として記録する。これは実機・hosted Previewの速度を示さない。
- 認証中・画面遷移中の共通読み込み表示を追加し、ホームの買い物状態を1問い合わせにまとめて献立カード取得と並行する。献立未決定のホームには、レシピ追加・任意の在庫確認・献立決定の直接リンクを追加する。
- DB migration・環境変数・新規依存の変更なし。
- Codexレビューの指摘で、計測を見出し表示と全体読込に分け、Safariでも手順リストと番号を読み上げられるよう修正。iPhone相当のE2Eスクリーンショットで案内の見た目を確認。
- E2E CIのartifact uploadログがstep環境変数を表示するため、使い捨てのローカルAuth/PIN値をGitHub Actionsのmaskへ登録してから環境へ渡すよう変更。対象値はCIのローカルSupabase内だけで使い、hosted Supabase・GitHub Secretsは使わない。過去ログに出た値もこの実行専用の使い捨て値で、Development/Productionの資格情報ではない。
- 実装確認：`npm run lint`、`npm run typecheck`、`npm test -- tests/unit/home-shell.test.tsx`（3件）、`git diff --check`が成功。mask修正後CIもlint/typecheck/test/build、DB/RLS、Auth（2構成）、E2E（26件）、Vercel Previewが成功。E2E upload stepの環境変数ログで`PIN_PEPPER`・`CRON_SECRET`・2人分のPINがすべて`***`と表示されることを確認。
- Preview確認：利用者のVercelログイン後、PR #20のhosted Previewでホームを表示。390×844のブラウザー表示幅で横スクロールなし（document width 390px）、ヒーロー・初回手順3つ・下部ナビを確認。これはiPhone実機ではなくブラウザーの表示幅エミュレーション。実機の通信速度・操作感は未確認。
- 追加調整後CIはlint/typecheck/test/build、DB/RLS、Auth（2構成）、E2E（26件）、Vercel Previewが成功。最新E2EのiPhone 14相当390×844画像では、ヒーロー・初回手順3件・説明・下部5タブが1画面内に見え、横幅も390pxで収まることを確認した（Chromiumエミュレーションであり実機ではない）。短い高さ向けCSSも追加したが、667pxの画面は未確認。
- 最新コミット固有のPreview URLは別オリジンでアプリのPINログイン状態が引き継がれず、画面確認はCIのE2E画像で実施。利用者の実機iPhoneで速度と操作感を確認する。PR #20はPR #19をbaseにしており、#19の後にマージする。

## UI刷新（2026-09-28）

- ホームの未決定状態を、料理イラスト・週間フロー・献立開始ボタンのある歓迎画面に変更。献立決定後の横スクロールカードも見直した。
- 写真未登録レシピと共通EmptyStateに自作SVGの料理イラストを追加し、共通ページ見出し・5タブナビ・背景にトマトとバター色のアクセントを追加した。
- 新規依存・画像外部送信なし。食材データ・認証・DB変更なし。
- `npm run lint` 成功、`npm run typecheck` 成功。テストは未実行。
- CodexレビューのP2（ボタン・小見出しの文字コントラスト）とP3（カード角丸・影の共通トークン不一致）を反映。ボタンを濃色化し、角丸・影をガイドラインへ揃えた。
- Codex再レビューの追加指摘（200%文字拡大時のヒーロー・手順表示、調理済みカード文字のコントラスト）も修正。狭幅ではボタン折返し・イラスト下置き・手順縦並び、調理済みカードは写真のみ薄くする。
- Codex最終レビューの指摘を反映：押下中の主ボタンも十分なコントラストを維持し、ヒーロー内の丸いメモは拡大文字に合わせて伸びる。
- PR #19のCIで、刷新したホームの見出しに追随していない既存unit期待値2件と、日本時間0時に不安定になるURL取り込み上限テストを確認・修正。変更後CIで再確認する。
- CIで刷新したホームに対する古いE2E期待値を修正後、献立一覧の確認範囲がホーム全体になっており、手順ガイド内のリストまで数えて10件になる問題を特定。確認対象を「今週の献立」領域に絞った。
- PR #19: https://github.com/leold0812-rgb/futari-no-kondate/pull/19 。最終コミット `cf224ca` のCIはlint/typecheck/test/build、DB/RLS、Auth（2構成）、E2Eの全ジョブが成功。Vercel Previewもデプロイ成功。Preview固有URLはログイン画面が表示され、既存セッションを使ったログイン後画面の確認は未実施（PINは入力せず）。PRはレビュー可能な状態で未マージ。
- lint / typecheck / 差分チェックは今回の修正後に実行中。ローカルではテストを実行していない。CI上の失敗を見て期待値と時刻fixtureを直したため、PR CIで検証する。

## PR #3 レビュー（2026-09-26）

> 解決済み（2026-09-27）：下記の欠陥は`fix/member-limit-isolation`（新規migration `20260927090000_fix_member_limit_isolation.sql`）で修正し、`REPEATABLE READ` / `SERIALIZABLE`の回帰テストを追加した。

- 完了：`origin/main...HEAD` のmigration、RLSテスト、CI、仕様を確認。PostgreSQL 17.11の使い捨てローカルDBに実際のmigrationを適用し、`REPEATABLE READ`で同一spaceに3件登録できることを再現した（最終件数3、両transaction成功）。コード修正は未実施。
- 未完了・既知の問題：`private.enforce_couple_space_member_limit()`はspace行を`FOR UPDATE`でロックするが、古いtransaction snapshotでの件数判定を防げない。2人上限を全分離レベルで保証する修正と、同条件の回帰テストが必要。hosted Development / Production DBは変更していない。
- DB migration / 環境変数の変更：レビューによる変更なし。
- テスト：`npm run lint` 成功、`npm run typecheck` 成功、`npm test` 5 files / 20 tests成功。公式SupabaseローカルDBテストは手元にDockerがないため未実行（PRの既存CI実行記録は下記）。
- 次の推奨作業：上限チェックを分離レベルに依存しない方式へ修正し、並行transactionの回帰テストを追加してからPRを再確認する。

## 完了

### 設計フェーズ（既存）

- 原仕様全体を確認し、プロダクト仕様、アーキテクチャ、DB、UI、推薦、開発計画を文書化
- Gate 0の最初のClaude向け作業指示を作成

### Gate 0-1 / 0-2: Next.js最小土台・PWA manifest・モバイルshell

（開発計画の0-2「PWA manifest・アイコン・空の5タブ」はGate 0-1の作業指示に含まれていたため同時に完了）


- `create-next-app@16.3.6`（App Router / TypeScript / ESLint / Tailwindなし / npm）で土台を生成し、ルートへ配置
- `app/globals.css`：`docs/ui-guidelines.md`の色・角丸・Safe Area・タップ最小値をCSS変数化。`prefers-reduced-motion`対応
- `app/layout.tsx`：`lang="ja"`、`viewport-fit=cover`、theme color、apple web app metadata、`noindex`（2人専用のため）
- `app/manifest.ts`：PWA manifest（`/manifest.webmanifest`）。仮アイコン `public/icons/icon.svg`。Service Workerは未導入
- `app/(main)/layout.tsx`：本文＋下部タブのshell。本文下余白 = タブ高さ + Safe Area + 24px
- `components/navigation/`：下部5タブ（ホーム / レシピ / 在庫 / 買い物 / 記録）。現在地は`aria-current`、色＋太字＋上部バーで表示
- `components/ui/`：`EmptyState`、`PageHeader`
- ホームに`今週の献立を決める`空状態（ボタンは準備中としてdisabled）。他4ページは簡潔な空状態
- `.env.example`（変数名のみ、値は空）、`.gitignore`に`!.env.example`と`.claude/`を追加
- `next.config.ts`：`agentRules: false`（`next dev`がルート`AGENTS.md`へNext.js用ブロックを自動追記し、`CLAUDE.md`を生成するのを防ぐ）、`poweredByHeader: false`
- Vitest + Testing Library の最小render test（`tests/unit/home-shell.test.tsx`）

### PINのロック廃止・連番の許可（2026-09-27、利用者の指示）

- migration `20261007090000_disable_pin_account_lockout.sql`：`pin_login_begin`を差し替え、アカウント単位のロックを外した。既存のアカウント記録（ロック）を削除。送信元単位の1時間20回は総当たり対策として残した
- `lib/auth/pin.ts`：連番のPINを許可（同じ数字だけは引き続き不可）。`lib/auth/pin-login.ts`：PIN違いの文言からロックの警告を削除
- テスト：pgTAP `pin_auth` 27件、unit `pin.test.ts`、結合 `pin-login.test.ts`（連続6回間違えた後も正しいPINで入れる）

### Gate 8: 記録・バックアップ・PWA仕上げ（PR作成時点）

- migration `20261006090000_create_weight_records.sql`（本人だけのRLS、Realtime対象外、利用者の書き込みは未来日・1年より前を拒否）、`20261006100000_create_backup_snapshot.sql`（全対象テーブルを同じスナップショットで読むservice role専用関数）
- 記録画面 `/records`：自分の体重（入力・過去90日のSVGグラフ・直近5件の削除）、週平均夕食カロリー（本人・直近4週）、食事の履歴（30件）。`lib/records/summary.ts`、`lib/services/records.ts`、`components/records/`
- バックアップ：`lib/backup/core.mts`（対象テーブル・読み出し・復元・保持期限）、`app/api/cron/backup/route.ts`（CRON_SECRET認証・private Blobへgzip JSON・30日削除）、`vercel.json`（毎日UTC 18時）
- 管理スクリプト `scripts/backup/`：`export.mts`（手元へ保存）、`fetch.mts`（Blobから取得）、`restore.mts`（空のprojectへ復元・ID対応表）、`roundtrip-check.mts`（CIの復元テスト）
- PWA：PNGアイコン（192・512・maskable・apple-touch-icon）、`public/sw.js`（オフライン案内だけ。利用データはキャッシュしない）、`/offline`、`app/(main)/error.tsx`、`app/not-found.tsx`
- 手順書：`docs/runbooks/backup-restore.md`、`docs/runbooks/production-checklist.md`、`hosted-development-setup.md` J
- 依存追加：`@vercel/blob` 2.8.0（固定）
- テスト：unit 375件（`records-summary`・`backup-core`を追加）、pgTAP `weight_records.test.sql` 19件・`backup_snapshot.test.sql` 5件、E2E `09-records.spec.ts`（体重・相手に見えない・Cronの認証）、CIの復元テスト

### Gate 2b: 食品成分表と栄養計算（PR作成時点）

- migration `20261005090000_create_food_composition.sql`、`scripts/nutrition/`（CSV読み取り・取り込み）、`lib/nutrition/recipe.ts`、`lib/services/nutrition.ts`
- 画面：`/inventory/ingredients/[id]`（食品の検索・選択、重さへの換算）、レシピ詳細に計算の出典と不足している材料の案内。レシピ保存・対応付け変更で自動計算
- 手順書「I. 食品成分表の取り込み」（ユーザー作業）
- テスト：単体（計算・CSV）、pgTAP `food_composition.test.sql`（15件）、E2E `08-nutrition.spec.ts`（架空の食品で計算を確認）

### Gate 7: 日常利用（PR作成時点）

- `lib/nutrition/meal.ts`（1人分の栄養）、`lib/recommendation/free-day.ts`（余裕日）、`lib/services/meals.ts`（献立詳細・差し替え候補・ホームの並び）、`sides.ts`に`rankAlternatives`
- migration `20261004090000_create_meal_histories.sql`（ご飯量・食事履歴・作った・余裕日・差し替え）
- 画面：ホーム（そろそろ使いたい順・作ったは薄く・余裕日への導線・買い物準備の続き）、`/meals/[id]`（主菜/副菜/汁物・材料・各自のご飯と栄養・差し替え・作った・初回評価）、`/free-day`、設定にご飯量
- テスト：単体（栄養・余裕日）、pgTAP `meal_histories.test.sql`（22件）、E2E `07-daily.spec.ts`

### Gate 6: 副菜・汁物と買い物（PR作成時点）

- `lib/recommendation/sides.ts`、`lib/shopping/aggregate.ts`・`insurance.ts`、`lib/services/shopping.ts`（副菜の自動設定・合算・下書き・保険食材）
- migration `20261003090000_create_shopping.sql`（買い物リスト・項目・カテゴリ順と関数、Realtime）
- 画面：主菜の確定後に`/plan/shopping`（献立の確認→家にあるものチェック→保険食材→確定）、`/shopping`（カテゴリ順、押して購入済み・薄く残す、2人に同期、ほかに買う物の追加）、設定にカテゴリ順
- `components/realtime/realtime-refresh.tsx`（Realtimeで画面を読み直す）
- テスト：単体（sides・aggregate・insurance）、pgTAP `shopping.test.sql`（25件）、E2E `06-shopping.spec.ts`

### Gate 5: 週間計画（PR作成時点）

- `lib/recommendation/weekly.ts`（推薦 `weekly-v0.1`、決定的・内訳と緩和理由つき）、`lib/services/weekly-plan.ts`（入力の収集・候補の保存・判断・手動追加・確定）、`lib/plan-week.ts`（今週/来週）
- migration `20261002090000_create_weekly_plans.sql`（計画・推薦の実行と候補・献立セット・調理履歴、関数、Realtime）
- 画面：`/plan`（10候補を1枚ずつ、スワイプ/ボタン/矢印キー、1つ戻る、候補切れ時は出し直し・レシピから追加）、`/plan/confirm`（5品の確認・外す・確定）、`/plan/add`（手動追加）。ホームは今週の状態に応じて「今週の献立を決める」か5つの献立＋「来週の献立を決める」
- テスト：単体（推薦の仕様テスト全項目・ホーム）、pgTAP `weekly_plans.test.sql`（22件）、E2E `05-plan.spec.ts`（`tests/e2e/seed.ts`でローカルSupabaseへ主菜を投入）

### Gate 4: 在庫（PR作成時点）

- migration `20261001090000_create_inventory.sql`（lot・監査・単位換算・`inventory_add` / `inventory_set_quantity` / `inventory_consume`）
- `lib/services/inventory.ts`（一覧・材料の検索/作成・在庫量の単位グループ別合計）、`/inventory`（そろそろ使いたい→カテゴリ別、手入力、数量の補正、使い切り）、`/inventory/ingredients`（カテゴリと保存目安の編集）
- テスト：pgTAP `inventory.test.sql`（20件）、単体`inventory-units-parity.test.ts`（アプリとDBの単位定義の一致）、E2E`04-inventory.spec.ts`
- E2Eのspecは`01-`〜の番号順に流れる前提（DBの状態を共有するため）

### Gate 3: URL取り込み（PR作成時点）

- `lib/import/url-safety.ts`（形式・内部向けIPの判定、IPv4埋め込みIPv6も展開）、`safe-fetch.ts`（接続時に全DNS結果を検査、リダイレクト再検査、10秒・3MB・Content-Type、gzip/br、Shift_JIS等の文字コード）、`extract.ts`（JSON-LD Recipe・OGP・本文要約）、`openai.ts`（Responses API、strict JSON Schema、zod検証、store:false）、`import-recipe.ts`（流れと下書き化、AI上限20回/日）、`remote-image.ts`
- 画面：`/recipes/new` はURL取り込みが既定（成功→確認フォーム、失敗→「URLだけ保存」「手入力で続ける」）。`?replace=<id>`で「URLだけ」レシピの再取り込み。元ページ写真は確認チェック時のみ複製
- migration `20260930090000_create_recipe_import_logs.sql`
- 共通化：材料行の分割を`lib/ingredients`の`splitIngredientLine`へ。`lib/dates.ts`（日本時間の日付・週）、`lib/inventory/status.ts`（Gate 4用の鮮度判定）も追加
- テスト：単体（url-safety 45件・extract・openai・import-recipe・dates・inventory-status）、pgTAP `recipe_import_logs.test.sql`、E2E`import.spec.ts`（CIはOpenAIキーなし＝失敗経路を確認）
- 注意：iCloud同期で`* 2.ts`の重複ファイルが作業ツリーにできることがある。中身を元ファイルと比較してから削除する

### Gate 2: レシピ（PR作成時点）

- migration `20260929090000_create_recipes.sql`（材料マスタ・レシピ・材料行・評価・お気に入り・`save_recipe` RPC・画像bucketとStorage policy）。詳細は`docs/database.md`
- `lib/units`（単位の正規化・互換単位だけの換算・表示・人数換算・分量文字列の解析）、`lib/ingredients`（材料名の正規化・カテゴリ推定・保存目安の初期値）、`lib/recipes/constants.ts`、`lib/validation/recipe.ts`（zod）、`lib/services/recipes.ts` / `recipe-images.ts` / `members.ts`
- 画面：`/recipes`（2列・検索・絞り込み・並べ替え、URLクエリで状態保持）、`/recipes/new`・`/recipes/[id]/edit`（行ごとの材料＋まとめて貼り付け、手順は1行1つ、写真は端末で縮小）、`/recipes/[id]`（1〜4人分換算、評価3段階・お気に入り・相手の評価、栄養、削除確認）、`/recipes/[id]/cook`（1手順ずつ）
- Server Actionの送信上限を6MBへ（写真）。設定画面では記録タブを現在地表示
- テスト：単体（units / ingredients / recipe-validation）、pgTAP `recipes_rls.test.sql`（31件）、統合`recipes.test.ts`、E2E`recipes.spec.ts`。CIのauthジョブでStorageも起動
- ローカル検証：scratchpadのHomebrew PostgreSQL＋Supabase最小再現＋最小pgTAP互換関数で、全DBテストを手元で実行してからCIへ出している

### Gate 1.4〜1.7: PIN認証・ログイン画面・proxy・E2E基盤

- migration `20260928090000_create_pin_auth.sql`：`private.pin_credentials` / `private.login_throttles`（テーブル権限なし）と、service_role専用RPC `pin_login_begin` / `pin_login_succeeded` / `pin_set`。詳細は`docs/database.md`
- `lib/auth/pin.ts`（形式・弱いPIN拒否・scrypt+pepper・送信元HMAC）、`lib/auth/pin-login.ts`（予約→照合→成功記録→`generateLink`+`verifyOtp`）、`lib/supabase/admin.ts`（server-only）、`lib/auth/session.ts`（`getCurrentMember` / `requireMember`）
- 画面：`app/(auth)/login`（2人の名前を選んでPIN入力、失敗理由と次の行動を表示、`next`で戻り先）、`app/(main)/settings`（この端末でログアウト）、記録タブ右上に設定リンク
- `proxy.ts`：session更新（`@supabase/ssr`公式構成、キャッシュ抑止headers）と未ログイン時の`/login?next=`リダイレクト。`(main)/layout.tsx`でも`requireMember()`
- 共通UI：`components/ui/button|alert|card|field`、PageHeaderに`action` / `back` / `description`
- `scripts/auth/set-pin.mts`：端末で非表示入力（CIは`--pin-stdin`）
- 環境変数追加：`PIN_PEPPER`（32文字以上、server-only）。`.env.example`への追記はユーザー作業（Claudeの権限で編集不可）
- テスト：単体`tests/unit/pin.test.ts`、pgTAP`supabase/tests/database/pin_auth.test.sql`（27件）、統合`tests/integration/pin-login.test.ts`、E2E`tests/e2e/auth.spec.ts`（CIジョブ`e2e / app flows`、スクリーンショットはartifact `e2e-results`）
- 追加依存：`@playwright/test` 1.63.0（devDependency、完全固定。CIのE2Eのみ）

### Gate 1.3: 固定2人のAuthアカウントbootstrap

- `scripts/auth/bootstrap-couple.mts`（CLI）/ `bootstrap-runner.mts`（Supabase入出力）/ `bootstrap-plan.mts`（純粋な計画）。Node 24の型除去でそのまま実行する（新規依存なし。`tsconfig.json`に`allowImportingTsExtensions`を追加）
  - 既定はdry-run。`--apply`で書き込み、書き込み後に状態を読み直して「変更なし」になることを確認する
  - `--project-ref`がURLのrefと一致しないと拒否（ローカルは`local`）。publishable / anon keyも拒否
  - 設定にないAuthユーザーがいる・2人が別spaceにいる・空spaceが複数ある場合は何も変更せず停止。途中で止まった状態（ユーザーだけ作成済み、空spaceが1件残る等）からは収束する
  - Authユーザーはパスワード無し・`email_confirm: true`。表示名・メールはGit管理外の`.env.bootstrap.local`から読む
- `scripts/auth/smoke-session.mts`：hostedでサインアップ無効・Email provider無効・`generateLink`+`verifyOtp`・RLSを確認する（ADR 0001の未検証項目）
- `scripts/lib/supabase-target.mts`：操作対象projectとキー種別の検査（以後の管理スクリプトで共用）
- テスト：単体`tests/unit/bootstrap-plan.test.ts`、統合`tests/integration/auth-bootstrap.test.ts`（CIのローカルSupabase）、CIでCLIをdry-run→apply→再実行、Email provider無効matrixでスモーク
- hosted Developmentへの適用は未実施（Supabase CLI未ログイン・資格情報をClaudeが扱わないため）。手順は[docs/runbooks/hosted-development-setup.md](runbooks/hosted-development-setup.md)

### Gate 1.1修正: 2人上限のtransaction分離レベル対応

- 新規migration `supabase/migrations/20260927090000_fix_member_limit_isolation.sql`：上限triggerの`FOR UPDATE`を、対象space行の`UPDATE`（`updated_at`更新）に置き換え。repeatable read / serializableでは競合を`could not serialize access`（40001）として検出する。仕組みは`docs/database.md`
- `scripts/db/test-member-limit-concurrency.sh`：`read committed` / `repeatable read` / `serializable`の3シナリオ（後続接続が先行接続のcommit前にsnapshotを取りcommit後に追加を試みる形を含む）に拡張
- 検証：旧関数でRRシナリオが失敗（3件登録）→ 新migrationで全シナリオ成功（ローカルPostgreSQL）。空DBへ2つのmigrationを順に適用でき、pgTAP 47/47成功。公式のSupabaseローカルDBでの結果はPRのCI（`db / rls policy tests`）で確認する
- 副作用：profile追加・移動のたびにspaceの`updated_at`が更新される

### Gate 1.2: PIN認証後のAuth session発行方式のspike（PR #4でマージ済み）

- 結論（2026-09-27にユーザー承認）：サーバー限定の`auth.admin.generateLink({ type: 'magiclink' })` → `verifyOtp({ token_hash, type: 'email' })`でsessionを発行し、`@supabase/ssr`のcookieへ書く。メールプロバイダーは無効化する。詳細・根拠・未検証事項は`docs/decisions/0001-pin-session-issuance.md`（承認済み）
- `tests/integration/auth-session-issuance.test.ts`（11件）と`vitest.integration.config.mts`、`npm run test:integration`（通常の`npm test`からは除外）。接続先が`127.0.0.1` / `localhost`以外なら拒否
- CI `auth / session issuance (email provider disabled|enabled)`ジョブ（matrix）：ランナーのDockerでローカルSupabase（Auth・API・PostgREST・Mailpit）を起動。GitHub Secrets・hosted Supabase不使用。ジョブは必須チェックには未追加
- `supabase/config.toml`：ローカルの`otp_expiry = 20`（期限切れ拒否の確認用。hostedの値ではない）
- 実装していないもの：PIN保存・検証・試行制限・lockout（Gate 1.4）、ログイン画面（Gate 1.5）、`proxy.ts`（Gate 1.6）、Authアカウントのbootstrap（Gate 1.3）、hosted Developmentでの確認

### Gate 1.1: CoupleSpace / profiles migrationとRLS（PR #3でマージ済み）

作業ブランチ：`feat/gate-1-1-couplespace-rls`（origin/mainから作成。Codex更新済みの`docs/architecture.md` / `docs/product-spec.md` / `docs/development-plan.md`と新規`docs/tasks/phase-1-1-couplespace-rls.md`は未コミットのまま保持）。commit / push / deployはしていない。

- `supabase/config.toml`：`supabase init`で生成し、`project_id = "futari-no-kondate"`、ローカルAuthの`enable_signup = false`（公開登録なし）、`[db.seed] enabled = false`へ調整。`api.schemas`は既定の`public`, `graphql_public`のまま（`private`は公開しない）
- `supabase/migrations/20260926180000_create_couple_spaces_and_profiles.sql`：`couple_spaces` / `profiles`、`private` schema、2人上限trigger、`private.current_couple_space_id()`、`updated_at` trigger、grants、RLS、SELECT policy 2本。詳細は`docs/database.md`の「確定済みschema」
- `supabase/tests/database/couple_space_rls.test.sql`：pgTAP 47件（anon / 同space / 別space / 未所属 / 3人目 / 移動・作成・削除拒否 / 構造・権限）
- `scripts/db/test-member-limit-concurrency.sh`：実際の2接続で「同時に3人目を追加」を検証。ホストが`127.0.0.1` / `localhost`以外なら実行を拒否
- `package.json`：devDependency `supabase`（CLI 2.118.0、完全固定）、scripts `db:start` / `db:stop` / `db:reset` / `db:test` / `db:test:concurrency`
- `docs/database.md`：schema確定内容・権限表・2人上限の仕組みを追記
- 実装していないもの（指示どおり）：ログイン画面、PIN認証、Auth account bootstrap、`proxy.ts`、後続Gateのtable

### Gate 0-4: CI

- 初回コミット`b7df51a`を作成し、private repository `leold0812-rgb/futari-no-kondate` を作成してmainをpush
- GitHub Actions初回実行：全step成功（job名 `lint / typecheck / test / build`）
- repositoryをpublicへ変更（ユーザー判断・ユーザー自身が実行。公開前に全履歴で秘密値・個人メールがないことを確認済み。commit emailはGitHub noreply）
- ruleset `main: CI必須`（id 24036317）を有効化：default branchに対し、required status check `lint / typecheck / test / build`（GitHub Actions）、strict（最新mainとの差分で再検査）、force push禁止、削除禁止
- 以後mainへ直接pushできないため、変更はブランチ→PR→CI成功→マージで行う

- Gate 0-1〜0-3はCodexレビュー完了（ユーザー報告、2026-09-26）
- `.github/workflows/ci.yml`：push（main）とpull_requestで実行。`permissions: contents: read`、同一refの古い実行はキャンセル、15分timeout
  - 手順：checkout → Node（`.nvmrc`）＋npm cache → `.env.example`以外の`.env*`がGit管理下なら失敗 → `npm ci` → lint → typecheck → test → build → client bundle検査
  - secretは一切参照しない（秘密値なしで通ることがGate 0の完了条件のため）
  - `actions/checkout` v7.0.1・`actions/setup-node` v7.0.0 をcommit SHAで固定（タグ付け替え対策）。`persist-credentials: false`
- `scripts/check-client-bundle.mjs`＋`npm run check:bundle`：`.next/static`にserver secret名が含まれたら失敗。検出時もファイル名と変数名だけを出力し、内容は出さない
- `.nvmrc`（24）を追加し、`package.json`の`engines.node`を`>=24`へ変更（`@types/node` ^24・ローカル実行環境と一致させるため）

### Gate 0-3: Supabase client・環境変数schema

- `lib/env/errors.ts`：`EnvConfigError`。messageは変数名と日本語の回復方法だけで、値は含めない
- `lib/env/public.ts`：`readPublicEnv()`。`NEXT_PUBLIC_SUPABASE_URL`はhttps（ローカルSupabaseの`http://localhost` / `127.0.0.1`のみhttp可）、anon keyは必須。公開変数へservice role JWT（`role=service_role`）や`sb_secret_`キーを入れた場合も拒否する
- `lib/env/server.ts`：`import "server-only"`。`readServerEnv(name)`で秘密値を機能ごとに遅延検証（`CRON_SECRET`は16文字以上）。起動時の一括検証はせず、未使用の秘密値が無くても無関係な画面は動く
- `lib/supabase/client.ts`：`createSupabaseBrowserClient()`（`createBrowserClient`、anon keyのみ）
- `lib/supabase/server.ts`：`import "server-only"`。`createSupabaseServerClient()`（`createServerClient`＋`next/headers`の`cookies()`、`getAll`/`setAll`方式）。リクエストごとに生成し、service role keyは使わない
- テスト追加：公開/サーバー環境変数の検証、環境変数不足時にclient生成が通信前に止まること、server secretの静的境界検査（`tests/unit/secret-boundary.test.ts`）
- 実際のDB・認証・table・proxy（middleware）は未実装。clientはまだどの画面からも呼ばれていない

## 合理的仮定（Gate 0-3）

- `setAll`内の書き込み失敗だけを握りつぶしている。Next.jsはServer Component描画中のcookie書き込みを禁止しており、Supabase公式のNext.js構成と同じ扱い。セッション更新はGate 1-4でproxy（Next.js 16で`middleware`から改称）を追加して担う。
- `setAll`の第2引数（キャッシュ抑止headers）は、応答headerを触れないServer Component/Actionでは適用しない。認証済みrouteでISR/CDN cacheを使わない方針（architecture.md）で補い、proxy実装時にheadersを応答へ付与する。
- 変数名は仕様どおり`NEXT_PUBLIC_SUPABASE_ANON_KEY`を維持する。Supabaseの新しいpublishable key（`sb_publishable_...`）もこの変数へ入れられる。
- 環境変数検証にzod等は追加せず手書きにした（対象6変数のみでbundle・依存を増やさないため）。

## 合理的仮定（Gate 0-1）

- ホームのURLは`/`（`app/(main)/page.tsx`）。`docs/architecture.md`の`(main)/home/`は「ホーム画面群」の意味と解釈した。将来`(auth)/login`にタブを出さないよう、タブは`(main)`グループのlayoutに置いた。
- manifestは`public/manifest.webmanifest`ではなく、型検査されるNext.js標準の`app/manifest.ts`で生成する（配信URLは同じ`/manifest.webmanifest`）。
- `今週の献立を決める`は未実装のためdisabled＋「準備中」表示とした（業務フローの仮実装をしない指示に従う）。
- `@types/node`はローカル実行環境（Node v24）とvitest 5のpeer要件に合わせ`^24`とした。
- ESLint 9 / TypeScript 5 は`create-next-app@16.3.6`の既定版をそのまま採用した（eslint-config-next 16との組み合わせ）。

## 追加依存

| package | 種別 | 目的 |
|---|---|---|
| next 16.3.6 / react・react-dom 19.2.8 | dependencies | App Router本体（create-next-app既定） |
| typescript, eslint, eslint-config-next, @types/* | dev | 型検査・lint（create-next-app既定） |
| vitest 5, @vitejs/plugin-react, jsdom | dev | 単体/render test実行。Next.js公式のVitest構成 |
| @testing-library/react, @testing-library/dom, @testing-library/jest-dom | dev | アクセシブルなrole基準のrender test |

| @supabase/ssr 0.12.7（完全固定） | dependencies | cookieベースのSSRセッション。0.x（architecture.mdのbeta扱い）のため`-E`で固定し、upgradeは独立作業にする |
| @supabase/supabase-js 2.117.2（完全固定） | dependencies | @supabase/ssrのpeer（^2.114.0）。ssrと揃えて固定 |
| server-only 0.0.1 | dependencies | server専用moduleをClient Componentからimportした時点でbuildを失敗させる（Next.js公式推奨） |
| @vercel/blob 2.8.0（完全固定） | dependencies | バックアップをprivate Blob storeへ保存・一覧・削除（Gate 8）。Cron routeと管理スクリプトだけで使い、client bundleには入らない |

UI kit・状態管理library・OpenAI SDKは未追加。Supabase clientはまだ画面から呼ばれていないため、現時点のclient bundleには含まれない。

### Gate 0-5: Development / Production設定手順

- `docs/development-environments.md`を作成。VercelのDevelopment / Preview / ProductionとSupabase Development / Productionを分離する対応表、ローカル設定、CI、漏えい時の対応を記載
- 今の段階では使わないservice role / OpenAI / Cron / Blobの秘密値を登録しない方針を明記
- READMEとアーキテクチャの環境分離表現をVercel環境の実態に合わせて更新
- 公式文書で確認した運用条件を追記：Vercel Node.js 24.x、Git Fork Protection維持（public repoのため）、Sensitive変数はProduction/Previewのみ作成可、Supabase Free planの無料project上限2（Dev＋Prodで上限）

#### 実環境の設定（2026-09-26）

- Supabase：`futari-no-kondate-dev` / `futari-no-kondate-prod`（ともにap-northeast-1、Free plan）はユーザーが作成済み。DB passwordはユーザー管理で、Claudeは扱っていない
- Vercel：project `futari-no-kondate`（scope `leold0812-1563s-projects`）を作成。framework `nextjs`、Node.js `24.x`、Git Fork Protection有効、GitHub `leold0812-rgb/futari-no-kondate`へ接続、Production Branch `main`
- GitHub：Vercel GitHub App（installation 123174061）のRepository accessへ`futari-no-kondate`を追加（ユーザー許可のうえ実施。既存の許可repositoryは変更なし）
- Vercel環境変数：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（publishable key）を登録。Development・Preview（全branch）→ dev project、Production → prod project。service role / OpenAI / Cron / Blobは未登録
- ローカルの`.vercel/`はlink情報のみでGit管理外
- 初回Production deploymentは、Production Branchが`main`の設定にもかかわらずPR branch `docs/gate-0-5-environments`（`d33f379`）から作られた（Production deploymentが1件もない状態でGit接続直後にpushしたため）。mainとの差分はdocsのみで、`https://futari-no-kondate.vercel.app`の`/`・`/recipes`・manifestは200。PR #1・#2をmainへマージした後、mainからのProduction deploymentに置き換わったことを確認する

## 未完了

- Gate 1.1のテストをSupabase公式のローカルDBで実行する。MacにはDockerを導入しない方針のため、GitHub ActionsのDBジョブで実行する（下記「既知の問題」）
- OpenAI / Vercel Blobのproject/store作成と接続（各機能を実装するGateで設定）
- 全Gateの業務機能

## 既知の問題・要確認

- （解決済み）Gate 1.1の欠陥（REPEATABLE READ以上で2人上限を超えられる）は2026-09-27に修正。既存migrationは書き換えず、関数を差し替える新規migrationを追加した。
- （解決済み）**Gate 1.1のDBテストはSupabase公式のローカル環境では未実行**：この環境にDocker（およびDockerランタイム）がなく`supabase start` / `supabase test db` / `supabase db reset`を実行できなかった。代替として、Homebrewの`postgresql@17`（17.11）とpgTAP 1.3.4（本家v1.3.4をソースからビルド）で使い捨てのローカルDB（作業ディレクトリ内、`127.0.0.1:54399`）を作り、Supabaseのロール（`anon` / `authenticated` / `service_role`）・`auth.users`（`id`のみ）・`auth.uid()`・`public`の既定privileges・`extensions` schemaを最小限に再現したうえでmigration適用とテストを行った。実際のSupabaseイメージでは、`auth.users`の列構成、`auth.uid()`実装、既定privileges、pgTAPの導入場所が異なる可能性があるため、GitHub ActionsのDBジョブ（公式のSupabaseローカルDBイメージ）で`npm run db:test` / `npm run db:test:concurrency`を実行して確認する。
- **CIのDBテスト（`db / rls policy tests`ジョブ）はPR #3の初回Actions実行で公式のSupabaseローカルDBに対して成功した（2026-09-26）**：`npx supabase db start`でmigration適用、`auth.users`が存在しFKが通る、`psql`利用可、pgTAP `Files=1, Tests=47, Result: PASS`、同時実行テストOK、DBジョブ所要約1分半。事前に懸念した4点（migration適用・`auth.users`・`psql`・所要時間）はすべて問題なし。MacへDockerは導入せず、GitHub Actionsランナーで実行する運用とする。
- CIのDBジョブは追加Action不使用（`npm ci`で入る固定版Supabase CLIを`npx`で使う）、secretsなし、`contents: read`のみ。`supabase link` / `--linked` / `--db-url` / `--project-ref` / `db push`の混入を検出するGuard手順あり。hosted Supabaseには接続しない。
- mainのルールセット`main: CI必須`（id 24036317）の必須チェックへ`db / rls policy tests`を追加済み（`lint / typecheck / test / build`と合わせて2つ必須、strict）。パスフィルタは付けない（必須チェックが実行されずマージが止まるため）。
- 公開repositoryのため、GitHubの設定で外部contributorのworkflow実行に承認を必須にすることを推奨（未設定・要ユーザー操作）。
- Development用hosted Supabase projectにはmigrationを適用していない（指示範囲外）。適用は`supabase link`とレビュー後に別作業で行う。Production projectには接続・変更していない。
- `.next/types/routes.d 2.ts`のような` 2`付き重複ファイルが生成され、`npm run typecheck`が`Duplicate identifier 'LayoutProps'`で一度失敗した（その後のbuildで`.next`が再生成され解消、再実行で成功）。リポジトリがiCloud等の同期対象フォルダ（`~/Documents`）配下にあることが原因の可能性がある。再発する場合は`.next`を削除して再生成する。
- publicのため、fork PRでもCIが走る。workflowは`contents: read`・secret不使用なので漏えい面は増えないが、今後secretを使うworkflowを追加する場合は`pull_request_target`を使わず、fork PRへsecretを渡さない。
- repositoryがpublicなので、今後もコード・fixture・docsへ実データ・個人情報・秘密値を入れない（AGENTS.mdのルールがより重要になる）。
- actionlintが手元にないため、workflowはYAML構文と手順のローカル再現でのみ検証した。初回push時にActionsの結果を確認する。
- 依存更新の自動化（Dependabot等）は未導入。`@supabase/ssr`を固定しているため、導入時は固定方針と合わせて検討する。

- （解決済み・Gate 8）PNGアイコン（192/512・maskable・apple-touch-icon）を仮デザインから生成。正式デザインが決まったら`lib/pwa/icon.tsx`を差し替える。
- 実機iPhone（Safe Area・standalone表示）は未確認。ブラウザの375×667エミュレーションのみで確認。
- Instagramは取得制限やページ構造変更により自動解析できない場合がある。URLのみ保存を必須の正常経路として扱う。
- 短いPINは総当たり耐性が低い。Supabase Auth、6桁以上、試行制限を設計条件とした。
- 食材固有の容量↔重量換算はマスタなしに安全に行えない。
- 日本食品標準成分表の採用版・収載データ範囲・出典表示は栄養Gate開始時に公式一次資料で確認する。
- 元サイト画像の複製可否は取得元の利用条件に依存する。
- `@supabase/ssr`は0.12.7で固定済み（0.x）。`setAll(cookies, headers)`の第2引数など、最近のAPI追加があるためupgrade時はCHANGELOGを確認する。
- `server-only`違反時のbuildエラー文言が「Pages Router」と表示される（Next.js 16.3.6の文言。App Routerでも正しく失敗はする）。

## DB変更

- 新規migration `supabase/migrations/20260926180000_create_couple_spaces_and_profiles.sql`（`couple_spaces`, `profiles`, `private` schemaのhelper / trigger関数、grants、RLS policy）。ローカル検証DBにのみ適用。hosted Development / Production projectには未適用。
- `auth.users`への外部キー（`profiles.id`）以外にAuth側のデータは変更していない。

## 環境変数変更

Gate 1.1での変更なし（`.env.example`・Vercel環境変数とも変更していない）。

Gate 0-5でVercelへ公開用2変数を登録（上記「実環境の設定」）。コード上の変数名に変更なし。Gate 0-1で`.env.example`を新規作成（値は空）：`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`。`lib/env/`から参照するが、Supabase clientを呼ぶ画面はまだないため、未設定でもbuild・起動できる。

## テスト結果

### Gate 1.2（2026-09-26、PR #4のCI）

- `auth / session issuance`：メールプロバイダー無効・有効の両matrixで統合テスト11/11成功（各約26秒）。実測：`verification_type=magiclink`、access token有効期間3600s、cookie名`sb-<ref>-auth-token`、匿名の`signInWithOtp`は有効設定で受理（メール送信キュー投入）・無効設定で`422 email_provider_disabled`、anon keyのAdmin APIは`403 not_admin`
- 途中で判明：メールプロバイダー無効だと匿名のログイン要求が`email_provider_disabled`で断られるため、パスワード未設定を理由とする拒否を検証できていなかった → 有効設定でも実行し、`invalid_credentials`まで確認。`signUp`の拒否コードは設定に関係なく`signup_disabled`だった（当初の想定を修正）
- `lint / typecheck / test / build` 成功（既存20件）、`db / rls policy tests` 成功
- DockerイメージのpullでレジストリのRate limit（`toomanyrequests`）が発生し再試行されたが、最終的に成功。頻発する場合はキャッシュ・リトライを検討する
- Macでは統合テストは実行できない（Docker不在）。CIで実行する

### Gate 1.1（2026-09-26）

検証環境：ローカルの使い捨てPostgreSQL 17.11 + pgTAP 1.3.4 + Supabase最小再現（上記「既知の問題」参照）。Supabase公式ローカル環境ではない。

- migrationを空DBへ適用：成功（`ON_ERROR_STOP`）。`drop`後の再適用も成功
- pgTAP：`1..47`、ok 47 / not ok 0
- 変異検証（テストが実際に壊れた状態を検出するか）：上限triggerの削除→6件失敗、authenticatedへのINSERT権限＋policy追加→3件失敗、profilesのRLS無効化→6件失敗、anonへのSELECT付与→2件失敗
- 同時実行（実2接続）：`scripts/db/test-member-limit-concurrency.sh`成功（2回連続）。`FOR UPDATE`を外した版では3人目が通り、スクリプトが失敗することを確認。実行後fixtureは残らない（profiles / spaces / auth.users とも0件）。remote hostを指定すると実行を拒否することも確認
- `npm run lint`：成功 / `npm run typecheck`：成功（上記の`.next`重複ファイルによる一時失敗のあと再実行で成功） / `npm test`：5 files / 20 tests成功 / `npm run build`：成功 / `npm run check:bundle`：成功 / `npm audit`：0 vulnerabilities
- Supabase公式のローカルDBでの`supabase db start` / `supabase test db`：Macでは未実行（Docker不在）。GitHub ActionsのDBジョブ（PR #3）で成功：pgTAP 47/47・同時実行テストOK

### Gate 0-5

- 公式Vercel/Supabase文書と照合し、環境対応表・ローカル手順・CI方針を文書レビュー（2026-09-26にVercel Sensitive env / Vercel for GitHub / Node.js versions、Supabase Billingを再確認）
- Supabase Free planの非アクティブproject一時停止の条件は今回参照した文書に記載がなく未確認
- コード変更なし
- Vercel環境変数：Development / Previewの値を一時ファイルへpullし、URLのproject refがdev、keyが`sb_publishable_`形式であること、`/auth/v1/health`が200を返すことを確認（一時ファイルは削除）。Production値はローカルへpullせず、prod URLの`/auth/v1/health`が200であることのみ確認
- REST APIでenv一覧を取得し、6件（2変数×3環境）・Preview分はgitBranch指定なし・サーバー秘密値の登録なしを確認
- `vercel env add ... preview`はCLI 50.39.0の非対話モードでbranch確認がループし失敗したため、Vercel REST API（`POST /v10/projects/{id}/env`）で登録した

### Gate 0-4（2026-09-26）

- `npm run check:bundle`：build後に成功。`.next/static`へ`OPENAI_API_KEY`を含む仮ファイルを置くとexit 1で失敗することを確認（仮ファイルは削除済み）
- `.gitignore`を尊重して作業ツリーを別ディレクトリへ複製し、環境変数を空にした状態（`env -i`、`CI=true`）でCIと同じ手順を実行：`npm ci` / lint / typecheck / test（20件）/ build / check:bundle すべて成功
- workflow YAMLをパースし、手順順序と`permissions: contents: read`を確認
- `git ls-files -- '.env*' ':!:.env.example'`が空であることを確認

### Gate 0-3（2026-09-26）

- `npm run lint`：成功 / `npm run typecheck`：成功
- `npm test`：5 files / 20 tests 成功
- `npm run build`：`.env.local`なしで成功（全ページ静的生成）
- `.next/static`（client bundle）にserver secret名が含まれないことをgrepで確認
- 一時的に`"use client"`コンポーネントから`lib/env/server`をimportするページを作り、`next build`が`server-only`エラーで失敗することを確認（検証後に削除済み）
- `npm audit`：0 vulnerabilities

### Gate 0-1（2026-09-26, Node v24.14.0 / npm 11.9.0）

- `npm run lint`：成功（警告0）
- `npm run typecheck`（`next typegen && tsc --noEmit`）：成功
- `npm test`（vitest run）：1 file / 2 tests 成功
- `npm run build`：成功。`/`, `/recipes`, `/inventory`, `/shopping`, `/records`, `/manifest.webmanifest` を静的生成
- `npm audit`：0 vulnerabilities
- `next start`で375×667表示を確認：`scrollWidth = 375`（横スクロールなし）、各タブ75×60px、本文下余白84px > タブ高さ61px、全5ページ200、manifestとアイコン配信200
- `app/` `components/` `tests/`に`process.env`・Supabase・OpenAI参照がないことをgrepで確認

## 次の推奨作業

- PRのマージ（利用者）：#8 → #9 → … → #15 → #16（PINのロック廃止）の順に `gh pr merge <番号> --merge`。マージ前に次のPRのbaseをmainへ付け替え（`gh pr edit <番号> --base main`）、「Update branch」でCIを通してからマージする
- 利用者作業：[hosted Developmentのセットアップ手順](runbooks/hosted-development-setup.md)のA〜J（Aで全migrationを適用）、`.env.example`へ`PIN_PEPPER=`（値は空）を追記、リポジトリをiCloud同期の外へ移す、GitHubで外部contributorのworkflow承認を必須にする
- Developmentで2人が1週間の流れを試し、問題なければ[Production導入チェックリスト](runbooks/production-checklist.md)
- 実機iPhoneでの確認（Safe Area・ホーム画面追加・オフライン案内）
