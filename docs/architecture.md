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
  (auth)/login/
  (main)/home/ recipes/ inventory/ shopping/ records/
  api/import-recipe/ api/cron/backup/
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

## 認証案

画面は2名の表示名から選択し、個人パスコードを入力する。内部では各人に固定のSupabase Authユーザーを割り当てる。パスコード相当の認証情報はSupabase Authにのみ持たせ、アプリDBにはプロフィールと`auth.uid()`の関連だけを保存する。

短いPINは総当たりに弱いため、初期値は6桁以上、試行回数制限、監査ログ（成功可否・時刻。PIN自体は記録しない）を設ける。将来、端末の利便性が必要なら安全なセッション保持で解決し、独自の認証回避は行わない。

Next.jsの認証セッションはcookieベースのSupabase SSR方式を採用する。`@supabase/ssr`は現時点でbetaのため、導入時にAPI差分を公式文書で確認しversionを固定する。セッション更新が起こる認証済みrouteではISR/CDN cacheを使わない。

## 環境分離

| 項目 | Development | Production |
|---|---|---|
| Vercel project | Preview/開発専用 | 本番専用 |
| Supabase project | 開発専用 | 本番専用 |
| Storage bucket | 開発専用 | 本番専用 |
| Blob store | 開発専用 | 本番専用 |
| OpenAI key / project | 開発用制限 | 本番用制限 |

本番データを開発へコピーしない。seedは架空データだけを使用する。

## 主なリスクと対策

| リスク | 対策 |
|---|---|
| カスタムPINによる認証低下 | Supabase Auth、6桁以上、rate limit、RLSを併用 |
| URL取得によるSSRF/巨大応答 | 宛先検証、DNS/redirect再検証、timeout、容量・Content-Type制限 |
| Instagram取得の不安定さ | 対応可否を保証せず、URLのみ保存と手入力修正を常設 |
| 2人同時操作の二重更新 | 一意制約、transaction、idempotency key、DB側数量更新 |
| 単位誤換算 | 次元・変換係数が確定した単位だけ自動処理 |
| 体重漏えい | owner-only RLS、共有queryから分離、Realtime対象外 |
| バックアップの機密性 | private Blob、署名/secret検証、保持期限、復元テスト |
| SDKの破壊的変更 | betaのSupabase SSR APIを固定し、upgradeを独立作業にする |

RealtimeのPostgres Changesは対象tableのRLSで購読者を制限する。Broadcast/Presenceを追加する場合はpublic channelを無効化し、private channelと`realtime.messages` policyを別途設定する。
