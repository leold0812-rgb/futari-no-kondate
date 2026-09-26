# Handoff

更新日: 2026-09-26（Gate 1.1追記）

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

### Gate 1.1: CoupleSpace / profiles migrationとRLS（今回・未コミット）

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

- **Gate 1.1のDBテストはSupabase公式のローカル環境では未実行**：この環境にDocker（およびDockerランタイム）がなく`supabase start` / `supabase test db` / `supabase db reset`を実行できなかった。代替として、Homebrewの`postgresql@17`（17.11）とpgTAP 1.3.4（本家v1.3.4をソースからビルド）で使い捨てのローカルDB（作業ディレクトリ内、`127.0.0.1:54399`）を作り、Supabaseのロール（`anon` / `authenticated` / `service_role`）・`auth.users`（`id`のみ）・`auth.uid()`・`public`の既定privileges・`extensions` schemaを最小限に再現したうえでmigration適用とテストを行った。実際のSupabaseイメージでは、`auth.users`の列構成、`auth.uid()`実装、既定privileges、pgTAPの導入場所が異なる可能性があるため、GitHub ActionsのDBジョブ（公式のSupabaseローカルDBイメージ）で`npm run db:test` / `npm run db:test:concurrency`を実行して確認する。
- **CIのDBテスト（`db / rls policy tests`ジョブ）は初回のActions実行で初めて公式環境に掛かる**。MacへDockerは導入せず、GitHub Actionsランナー（`ubuntu-latest`のDocker）で`npx supabase db start` → `npm run db:test` → `npm run db:test:concurrency`を実行する。次の4点はDocker不在のためローカルで事前確認できておらず、初回実行で確認する：(1) `db start`だけでmigrationが適用されるか（されなければ`supabase db reset`を追加） (2) DBのみの起動で`auth.users`が存在するか（無ければ`supabase start -x ...`で必要サービスだけ起動） (3) ランナーで`psql`が使えるか（PostgreSQL 16.15クライアントが搭載。無ければ`postgresql-client`をapt導入） (4) 所要時間（Dockerイメージのpullを含め数分の見込み）。
- CIのDBジョブは追加Action不使用（`npm ci`で入る固定版Supabase CLIを`npx`で使う）、secretsなし、`contents: read`のみ。`supabase link` / `--linked` / `--db-url` / `--project-ref` / `db push`の混入を検出するGuard手順あり。hosted Supabaseには接続しない。
- **mainのルールセット`main: CI必須`の必須チェックへ`db / rls policy tests`をまだ追加していない**。PRで初回成功を確認してから追加する（`gh api`でruleset id 24036317を更新）。パスフィルタは付けない（必須チェックが実行されずマージが止まるため）。
- 公開repositoryのため、GitHubの設定で外部contributorのworkflow実行に承認を必須にすることを推奨（未設定・要ユーザー操作）。
- Development用hosted Supabase projectにはmigrationを適用していない（指示範囲外）。適用は`supabase link`とレビュー後に別作業で行う。Production projectには接続・変更していない。
- `.next/types/routes.d 2.ts`のような` 2`付き重複ファイルが生成され、`npm run typecheck`が`Duplicate identifier 'LayoutProps'`で一度失敗した（その後のbuildで`.next`が再生成され解消、再実行で成功）。リポジトリがiCloud等の同期対象フォルダ（`~/Documents`）配下にあることが原因の可能性がある。再発する場合は`.next`を削除して再生成する。
- publicのため、fork PRでもCIが走る。workflowは`contents: read`・secret不使用なので漏えい面は増えないが、今後secretを使うworkflowを追加する場合は`pull_request_target`を使わず、fork PRへsecretを渡さない。
- repositoryがpublicなので、今後もコード・fixture・docsへ実データ・個人情報・秘密値を入れない（AGENTS.mdのルールがより重要になる）。
- actionlintが手元にないため、workflowはYAML構文と手順のローカル再現でのみ検証した。初回push時にActionsの結果を確認する。
- 依存更新の自動化（Dependabot等）は未導入。`@supabase/ssr`を固定しているため、導入時は固定方針と合わせて検討する。

- 仮アイコンはSVGのみ。iOSのホーム画面アイコン（`apple-touch-icon`、180px PNG）と192/512 PNGは未作成。正式デザイン確定時に追加する。
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

### Gate 1.1（2026-09-26）

検証環境：ローカルの使い捨てPostgreSQL 17.11 + pgTAP 1.3.4 + Supabase最小再現（上記「既知の問題」参照）。Supabase公式ローカル環境ではない。

- migrationを空DBへ適用：成功（`ON_ERROR_STOP`）。`drop`後の再適用も成功
- pgTAP：`1..47`、ok 47 / not ok 0
- 変異検証（テストが実際に壊れた状態を検出するか）：上限triggerの削除→6件失敗、authenticatedへのINSERT権限＋policy追加→3件失敗、profilesのRLS無効化→6件失敗、anonへのSELECT付与→2件失敗
- 同時実行（実2接続）：`scripts/db/test-member-limit-concurrency.sh`成功（2回連続）。`FOR UPDATE`を外した版では3人目が通り、スクリプトが失敗することを確認。実行後fixtureは残らない（profiles / spaces / auth.users とも0件）。remote hostを指定すると実行を拒否することも確認
- `npm run lint`：成功 / `npm run typecheck`：成功（上記の`.next`重複ファイルによる一時失敗のあと再実行で成功） / `npm test`：5 files / 20 tests成功 / `npm run build`：成功 / `npm run check:bundle`：成功 / `npm audit`：0 vulnerabilities
- Supabase公式のローカルDBでの`supabase db start` / `supabase test db`：Macでは未実行（Docker不在）。GitHub ActionsのDBジョブで実行する

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

- Gate 1.1のPRでCIの`db / rls policy tests`ジョブが成功することを確認し、成功後にruleset `main: CI必須`の必須チェックへ追加する
- Gate 1.1の差分レビュー（Codex）→ commit / PR
- Gate 1.2：PIN認証後にSupabase Auth sessionを作る方式のDevelopment-only spike（`docs/development-plan.md`）。指示書で「次のGate 1.2作業（2 Auth accountsの開発環境bootstrap）」とされている場合は、`development-plan.md`の番号（1.2=spike、1.3=bootstrap）と作業指示書の呼び方を揃える
- Gate 1で認証を入れる際に、Supabase session更新用の`proxy.ts`を追加する
