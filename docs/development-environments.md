# Development / Production 環境の設定手順

更新日: 2026-09-26

この文書はGate 0-5の設定手順です。実際のSupabase/Vercel project作成や秘密値の登録は、各サービスのDashboardで行います。このリポジトリには実値を書きません。

## 1. 分離方針

SupabaseはDevelopment用とProduction用に別projectを作ります。Vercelは1つのproject内の組み込み環境を使い、Development / PreviewをDevelopment用Supabaseへ、ProductionをProduction用Supabaseへ接続します。

```text
ローカル(next dev) ── Vercel Development環境変数 ─┐
PR / branch Preview ─ Vercel Preview環境変数 ─────┴─ Supabase Development project

mainからのProduction deploy ─ Vercel Production環境変数 ─ Supabase Production project
```

Vercelの環境変数はDevelopment / Preview / Productionごとに別値を設定でき、値を変更した後は新しいdeploymentから反映されます。[Vercel Environments](https://vercel.com/docs/deployments/environments) / [Environment Variables](https://vercel.com/docs/environment-variables)

SupabaseのPreview Branch機能は当面使いません。独立したDevelopment projectで開発し、Production projectへ実データを複製しない運用にします。[Supabase Deployment & Branching](https://supabase.com/docs/guides/deployment)

## 2. 作成するもの

1. SupabaseにDevelopment projectを作成する。例：`futari-no-kondate-dev`。
2. SupabaseにProduction projectを別途作成する。例：`futari-no-kondate-prod`。Developmentと別のdatabase、API key、Storage bucketを使う。
3. VercelにこのGitHub repositoryを接続したprojectを作成する。Production Branchは`main`にする。
   - Node.js Versionは`24.x`（Vercel既定）。`package.json`の`engines.node`（`>=24`）もVercel上では最新24.xへ解決され、CI（`.nvmrc`）と一致する。[Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
   - Security設定の**Git Fork Protection**は有効（既定）のままにする。repositoryがpublicのため、forkからのPRは承認するまでdeployされず、環境変数が渡らない。[Deployment Authorizations for Forks](https://vercel.com/docs/git/vercel-for-github#deployment-authorizations-for-forks)
4. VercelのProduction、Preview、Development環境変数を下表どおり設定する。

SupabaseのFree planで作れる無料projectは2つまで（Owner/Admin権限を持つ全organization合計）で、Development＋Productionで上限に達する。検証用に3つ目を作らない。[Billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase)

Supabaseのproject URLとpublishable keyは各projectのConnect/API Keys画面から取得します。アプリ内の変数名`NEXT_PUBLIC_SUPABASE_ANON_KEY`は維持し、新しいSupabase publishable key（`sb_publishable_...`）を設定できます。service role/secret keyを`NEXT_PUBLIC_`変数へ入れてはいけません。

## 3. Vercel環境変数の割り当て

| 変数 | Development | Preview | Production | 備考 |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dev URL | Supabase Dev URL | Supabase Prod URL | 公開値。`https://`を使用 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dev publishable key | Dev publishable key | Prod publishable key | 公開値。service roleは禁止 |
| `SUPABASE_SERVICE_ROLE_KEY` | 未登録 | 未登録 | 未登録 | 必要なサーバー機能を実装するGateまで登録しない |
| `OPENAI_API_KEY` | 未登録 | 未登録 | 未登録 | レシピ取り込み実装時に必要な環境だけへ登録 |
| `CRON_SECRET` | 未登録 | 未登録 | 未登録 | バックアップCron実装時にProductionへ登録 |
| `BLOB_READ_WRITE_TOKEN` | 未登録 | 未登録 | 未登録 | バックアップ実装時にprivate storeごとに登録 |

未使用のサーバー秘密値は空値で登録せず、変数そのものを未登録にします。必要になった機能だけが遅延検証する設計です。

`NEXT_PUBLIC_`付きの値はブラウザのJavaScriptへ埋め込まれます。Supabase publishable/anon keyは公開前提ですが、データ保護はRLSで行います。ほかの秘密値は登録時にVercelの**Sensitive**を有効にし、ログやスクリーンショットへ値を出しません。Sensitiveは作成後に値を読み出せず、Production / Preview環境でのみ作成できます（Developmentでは不可）。そのためDevelopment環境へはサーバー秘密値を登録せず、ローカルで必要な場合は開発用の値を`.env.local`へ直接置きます。[Sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)

## 4. ローカル開発

1. `.env.example`を見ながら、Supabase Development projectのURLとpublishable keyだけをローカル`.env.local`へ設定する。
2. `.env.local`がGit管理されていないことを確認する。ファイルをGitへ追加しない。
3. `npm run dev`で起動する。
4. Supabase接続機能の実装後は、ブラウザのNetwork/画面とSupabase Development projectのデータで確認する。

Vercel Development環境の値を取得する場合は、まず正しいVercel projectへlinkされていることをDashboard/`.vercel/project.json`で確認し、その後に`vercel env pull .env.local`を使います。この操作は既存の`.env.local`を置き換える可能性があるため、手動のローカル値がある場合は退避します。Production環境の値はローカルへpullしません。[Vercel CLI env](https://vercel.com/docs/cli/env)

## 5. PreviewとProduction

- Pull Request / feature branchはPreview deploymentとして確認し、Development用Supabaseへ接続する。
- `main`へマージしたdeploymentだけがProduction環境変数とSupabase Production projectを使う。
- Vercel環境変数を変更した場合は新しいdeploymentを作る。既存deploymentへ遡って反映されない。
- 認証とRLSが完成するまではProductionへ実データを入れず、一般公開URLで実運用を始めない。
- 現在GitHub repositoryはpublicです。Preview URLを共有する場合も、秘密値・実データ・個人情報を画面やfixtureへ出さない。認証実装後はVercel Deployment Protectionの利用可否も確認する。

## 6. GitHub Actions / CI

CIは`.github/workflows/ci.yml`のとおり、Supabase/OpenAI/Vercel/Blobのsecretなしでlint・typecheck・test・build・client bundle検査を実行します。GitHub Secretsへ実サービスの値を登録する必要はありません。将来CIからデプロイする要件ができた場合は、最小権限の認証方式を別途設計します。

## 7. 初期設定チェックリスト

2026-09-26に最終項目（継続ルール）を除き確認済み。記録は`docs/handoff.md`のGate 0-5「実環境の設定」を参照。環境を作り直す場合はこのリストを再利用する。

- [ ] Supabase Development projectを作成し、Productionと別のproject refであることを確認
- [ ] Supabase Production projectを作成し、Developmentと別のAPI key / DB / Storageであることを確認
- [ ] Vercel projectのProduction Branchが`main`、Node.js Versionが`24.x`
- [ ] Vercel projectのGit Fork Protectionが有効
- [ ] Vercel Development / PreviewのSupabase URLとpublishable keyがDevelopment用
- [ ] Vercel ProductionのSupabase URLとpublishable keyがProduction用
- [ ] 不要なservice role / OpenAI / Cron / Blob secretは未登録（登録する時はSensitiveを有効化）
- [ ] `.env.local`がGit管理外であることを確認
- [ ] GitHub Actionsに実サービスのsecretが不要であることを確認
- [ ] 認証・RLS完成までProductionへ実データを登録しない

## 8. 値の更新・漏えい時

- 環境変数の変更はVercel Dashboardで該当環境だけ更新し、新deploymentを作る。
- Supabase keyが漏えいした場合は該当projectでrotateし、影響する環境だけ更新する。
- OpenAI keyが漏えいした場合はOpenAI側で失効・再発行し、Vercelの該当環境だけ更新する。
- `.env.local`を誤ってcommitした場合、値が秘密なら削除commitだけで済ませず、先にサービス側で失効・rotateする。public repositoryではGit履歴にも残るものとして扱う。

