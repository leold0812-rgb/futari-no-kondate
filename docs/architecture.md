# アーキテクチャ

## 構成

```text
iPhone PWA
  └─ Next.js App Router (Vercel)
       ├─ Server Components / Server Actions / Route Handlers
       ├─ Supabase Auth + PostgreSQL + RLS + Realtime
       ├─ Supabase Storage（料理画像）
       ├─ OpenAI API（URL取り込み時のみ、サーバーから）
       └─ Vercel Cron → private Vercel Blob（バックアップ）
```

ブラウザはSupabase anon keyだけを保持する。service role、OpenAI key、Cron secret、Blob tokenはVercelのサーバー環境だけに置く。

## 推奨フォルダ構成

```text
app/
  (main)/home/ recipes/ inventory/ shopping/ records/
  api/auth/start/ api/import-recipe/ api/cron/backup/
components/
  ui/ navigation/ recipes/ weekly-plan/ inventory/ shopping/
lib/
  auth/ supabase/ validation/ units/ nutrition/ recommendation/ inventory/
  services/              # ユースケース。DB更新の境界
supabase/
  migrations/ seed.sql
tests/
  unit/ integration/ e2e/
public/
  icons/ manifest.webmanifest
docs/
```

機能ページは`app`、再利用UIは`components`、純粋な計算は`lib`、複数テーブルを更新する処理は`lib/services`へ置く。

## 境界と責務

- 推薦・栄養・単位換算は副作用のないTypeScript関数にし、DBなしで単体テスト可能にする。
- `作った`、`購入済み`、`週間確定`はPostgreSQL functionまたは単一トランザクションで処理する。
- Realtimeは表示同期に使う。整合性の保証をクライアントイベントへ任せない。
- レシピ取得は `URL検証 → 制限付きfetch → 本文抽出 → AI構造化 → schema検証 → 確認 → 保存` とする。AI出力を直接DBへ保存しない。
- URLのみ保存する失敗状態を正式な状態として持ち、再試行はユーザー操作で行う。

## ログインなしで使う（2026-10-08の変更）

利用者の指示で**ログイン画面・PIN・試行制限をやめた**。URLを開けばそのまま使え、データはふたりで共有する1つのものとして扱う（[ADR 0002](decisions/0002-remove-login.md)。従来のPIN方式は[ADR 0001](decisions/0001-pin-session-issuance.md)に残す）。

仕組みは次のとおり。

1. `proxy.ts`（このリポジトリではミドルウェアを`middleware.ts`ではなく`proxy.ts`という名前で置く）がSupabase Auth sessionを更新する。sessionが無ければ`/api/auth/start`へ転送する。
2. `/api/auth/start`（`app/api/auth/start/route.ts`）はサーバーだけが持つsecret keyで`auth.admin.generateLink({ type: "magiclink" })`を呼び、得た`hashed_token`を同じリクエスト内の`verifyOtp`でsessionのcookieへ書き、元の画面へ戻す（`lib/auth/auto-session.ts`）。メールは送られず、`hashed_token`はブラウザ・ログに出さない。
3. session発行の相手は`profiles`を`created_at`の古い順に並べた最初の1件。アカウントは1つだけ作るのが既定で、アプリはその1人としてDBへアクセスする。
4. 無限に転送し続けないよう、`kondate-session-tried`という60秒で消えるcookieを1度だけ置く。発行できないときは日本語で理由を説明する503ページを返す（アカウント未登録・設定不足・一時的な不調）。
5. sessionが無くても開けるpathは`/api/auth/start`と`/offline`だけ（`lib/auth/paths.ts`の`PUBLIC_PATHS`）。

**RLSのpolicyとgrantは一切変えていない。** DBから見れば今までどおり「ログイン済みの利用者1人」としての読み書きで、anonへ開放したわけではない。service role keyはserver-onlyのRoute Handlerだけで使い、ブラウザへ返さない。

**変わったセキュリティ上の性質：URLを知っている人は誰でも読み書きできる。** 利用者が「鍵を完全になくす」ことを選んだ結果で、URLそのものが唯一の防壁になる。URLを共有しない運用が前提になる。

Next.jsの認証セッションはcookieベースのSupabase SSR方式を採用する。`@supabase/ssr`は現時点でbetaのため、導入時にAPI差分を公式文書で確認しversionを固定する。セッション更新が起こる認証済みrouteではISR/CDN cacheを使わない。

## 環境分離

| 項目 | Development | Production |
|---|---|---|
| Vercel environment | Development / Preview | Production |
| Supabase project | 開発専用 | 本番専用 |
| Storage bucket | 開発専用 | 本番専用 |
| Blob store | 開発専用 | 本番専用 |
| OpenAI key / project | 開発用制限 | 本番用制限 |

Vercelは1つのproject内で組み込みのDevelopment / Preview / Production環境を使う。Supabase projectはDevelopmentとProductionで分ける。VercelのPreviewはDevelopment用Supabaseへ接続する。

本番データを開発へコピーしない。seedは架空データだけを使用する。

## 主なリスクと対策

| リスク | 対策 |
|---|---|
| URLを知る第三者の読み書き | ログイン画面をやめたため防げない（利用者の選択）。URLを共有しない、検索避け（`noindex`）、session発行は`/api/auth/start`だけに限定する |
| URL取得によるSSRF/巨大応答 | 宛先検証、DNS/redirect再検証、timeout、容量・Content-Type制限 |
| Instagram取得の不安定さ | 対応可否を保証せず、URLのみ保存と手入力修正を常設 |
| 2人同時操作の二重更新 | 一意制約、transaction、idempotency key、DB側数量更新 |
| 単位誤換算 | 次元・変換係数が確定した単位だけ自動処理 |
| バックアップの機密性 | private Blob、署名/secret検証、保持期限、復元テスト |
| SDKの破壊的変更 | betaのSupabase SSR APIを固定し、upgradeを独立作業にする |

RealtimeのPostgres Changesは対象tableのRLSで購読者を制限する。Broadcast/Presenceを追加する場合はpublic channelを無効化し、private channelと`realtime.messages` policyを別途設定する。
