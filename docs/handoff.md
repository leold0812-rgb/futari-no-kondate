# Handoff

更新日: 2026-09-26

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

### Gate 0-4: CI（今回）

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

## 未完了

- OpenAI / Vercel Blobのproject/store作成と接続（各機能を実装するGateで設定）
- 全Gateの業務機能

## 既知の問題・要確認

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

なし。

## 環境変数変更

Gate 0-5でVercelへ公開用2変数を登録（上記「実環境の設定」）。コード上の変数名に変更なし。Gate 0-1で`.env.example`を新規作成（値は空）：`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`。`lib/env/`から参照するが、Supabase clientを呼ぶ画面はまだないため、未設定でもbuild・起動できる。

## テスト結果

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

- PR #1 → #2 の順にマージし、mainからの初回Production deploymentが成功することを確認する
- Gate 1（認証・共有境界）の作業指示を作成する
- Gate 1で認証を入れる際に、Supabase session更新用の`proxy.ts`を追加する
