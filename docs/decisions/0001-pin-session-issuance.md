# ADR 0001: PIN認証後のSupabase Auth session発行方式

- 状態: 提案（Gate 1.2 spikeの結果。ユーザー承認待ち）
- 日付: 2026-09-26
- 関連: `docs/architecture.md`「認証案」、`docs/development-plan.md` Gate 1.2 / 1.4、PR #4

## 背景

ユーザー選択＋個人PINで認証する（短い数字PINを許容）。PINをSupabase Authのpasswordとしてブラウザから直接送ると、Supabase Authのendpointはアプリを通さず直接呼べるため、アプリ側のユーザー単位lockoutを迂回できる。そこで「PINはサーバー側で検証・試行制限し、成功時だけサーバーがAuth sessionを発行する」方式が成立するかをspikeで確認した。独自JWTの署名や、PINを直接Authのpasswordにする方式は採らない（architecture.mdの方針）。

## 決定（提案）

**サーバー限定の `generateLink` + `verifyOtp` 方式を採用する。**

1. サーバー（Route Handler / Server Action）がPINを検証し、アカウント単位・送信元単位の永続的な試行制限を適用する（Gate 1.4で実装）。
2. 成功したら、サーバーだけが secret key で `supabase.auth.admin.generateLink({ type: "magiclink", email })` を呼び、`properties.hashed_token` を得る。メールは送信されない。
3. 同じリクエスト内で、anon keyのSSR client（`@supabase/ssr` の `createServerClient`）に対し `verifyOtp({ token_hash, type: "email" })` を呼び、返るsessionをcookieへ書く。
4. `hashed_token` はサーバー内で完結させ、ブラウザ・ログ・レスポンスに出さない。
5. Authアカウントはパスワード無し（`admin.createUser({ email, email_confirm: true })`）で作る。emailは配送されない管理用アドレスとし、PINをAuthに保存しない。
6. メールプロバイダー（Authの「Email」provider）は**無効化**する（下記の理由）。

## 検証結果（ローカルSupabaseを用いたCI、PR #4）

`tests/integration/auth-session-issuance.test.ts`（11件）を、メールプロバイダー「無効」「有効」の両設定で実行し、すべて成功した。

| # | 確認内容 | 結果 |
|---|---|---|
| 1 | サーバーだけで session 発行、cookie（`sb-<ref>-auth-token`）へ書ける。cookieだけから次リクエストで `getUser` できる。`refreshSession` も成功 | 成功（両設定）。`verification_type=magiclink`、access token有効期間 3600s |
| 2 | 発行したsessionでGate 1.1のRLSが効く（自分のspaceと同space内profileのみ読める。別spaceは見えない。sessionなしのanonは拒否） | 成功 |
| 3 | 使用済み `token_hash` の再利用 | 拒否（一回限り） |
| 3b | 期限切れ `token_hash`（ローカルは20秒に設定して25秒待機） | 拒否 |
| 4a | 推測したPIN/パスワードでの `signInWithPassword` | 拒否。有効設定では `invalid_credentials`（アカウントにパスワードが無い）、無効設定では `email_provider_disabled` |
| 4b | 公開サインアップ | 拒否（`signup_disabled`、両設定） |
| 4c | 匿名からの `signInWithOtp`（ログインメール送信要求） | **有効設定では受理される（メールが送信キューに入る）／無効設定では拒否（422 `email_provider_disabled`）**。どちらもsessionは返らない |
| 4d | 推測した6桁OTP、偽造した `token_hash` での `verifyOtp` | 拒否 |
| 4e | anon keyでのAdmin API（`generateLink`・`createUser`） | 拒否（403 `not_admin`） |
| 4f | 一般ユーザーのaccess tokenでの他人向け `generateLink` | 拒否 |
| 5 | Authアカウントにパスワード（PIN）が保存されない（Admin APIの応答にもパスワード関連項目なし） | 確認 |

### メールプロバイダーを無効化する理由

有効のままだと、匿名の第三者がAuthのendpoint経由で既存アドレスへのログインメール送信を要求できる（4c）。本アプリはメールを使わないため、届かない宛先への送信要求でプロジェクトのメール送信枠（内蔵メールは1時間あたり2通）を消費されるだけで実害は小さいが、無効化すれば要求自体が拒否される。無効でも、サーバーの `generateLink` + `verifyOtp` によるsession発行と、その後のRLS・refreshは動作した（ローカルで確認）。

## 前提・残る課題（未検証）

- **hosted projectでの挙動は未検証**。ローカルのGoTrueで確認したもので、hosted Development projectでは次を確認する必要がある：メールプロバイダー無効化後も `generateLink` + `verifyOtp` が動くこと、Auth設定（signup無効、Email OTPの有効期限）。確認にはDevelopment projectのAuth設定変更とsecret keyの利用が必要なため、ユーザー承認を得てから実施する。
- `token_hash` の有効期限の既定は3600秒（hosted）。サーバーが発行直後に消費する設計なので、hostedで許容される最短値へ短縮することを検討する。
- Auth endpointのレート制限（token verification 既定150回/5分・IP単位）はユーザー単位ではない。PIN試行の制限はアプリ側の永続的な仕組み（Gate 1.4）で行う。サーバーからの呼び出しはVercelのegress IPに集約される点に注意。
- secret key（環境変数名は現行 `SUPABASE_SERVICE_ROLE_KEY`）はserver-onlyのRoute Handler / Server Actionだけで使う。漏えいすると任意のユーザーのsessionを発行できるため、Sensitive設定、ログへの非出力、rotate手順を必須とする。
- PINの保存（ハッシュ方式）、試行回数の永続化、lockout、監査ログはこのspikeの対象外（Gate 1.4）。
- テスト実行時にSupabaseのDockerイメージ取得が `toomanyrequests` で再試行されることがあった（CIは最終的に成功）。頻発する場合はキャッシュやリトライを検討する。

## 検討した代替案

- **PINをAuthのpasswordとしてブラウザから直接送る**: アプリ側のlockoutを迂回できるため不採用（architecture.mdで決定済み）。
- **サーバーが高エントロピーの値をAuthのpasswordとして保持し、サーバー側で `signInWithPassword` する**: 今回は主方式が成立したため未検証。主方式がhostedで成立しない場合の代替候補。
- **独自JWTの署名**: 不採用（architecture.mdで禁止）。
