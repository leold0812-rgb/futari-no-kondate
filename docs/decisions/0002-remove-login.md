# ADR 0002: ログイン画面をやめ、ふたり共有の1つのデータにする

- 状態: 承認済み（2026-10-08、利用者の指示「ログインは不要、体重記録も不要にしてシンプルに」）
- 日付: 2026-10-08
- 関連: [ADR 0001](0001-pin-session-issuance.md)（PIN方式。一部取り消し）、`docs/architecture.md`「ログインなしで使う」、`docs/database.md`、migration `supabase/migrations/20261009090000_remove_login_and_weight.sql`

## 背景

ふたりだけで使うアプリで、毎回PINを入れるのが手間だった。「自分」と「相手」を分けていたお気に入り・評価・ご飯の量も、ふたりで同じものを見たいという要望があった。体重の記録は使っていなかった。

## 決定

**ログイン画面・PIN・試行制限を削除し、URLを開いたらすぐ使えるようにする。データはふたりで共有する1つのものとして扱う。**

1. `proxy.ts`（このリポジトリのミドルウェア。名前は`middleware.ts`ではない）は、sessionが無いリクエストを`/api/auth/start`へ転送する。
2. `/api/auth/start`（`app/api/auth/start/route.ts`・`lib/auth/auto-session.ts`）がサーバーだけが持つsecret keyで`auth.admin.generateLink({ type: "magiclink" })`を呼び、`verifyOtp`でsessionのcookieを書いてから元の画面へ戻す（ADR 0001の手順から、PINの照合だけを外した形）。
3. session発行の相手は`profiles`を`created_at`の古い順に並べた最初の1件。アカウントは1人だけ作るのが既定（`scripts/auth/bootstrap-couple.mts`は1人または2人を受け付ける）。
4. 転送が繰り返されないよう、`kondate-session-tried`という60秒で消えるcookieを1度だけ置く。発行できないときは日本語で理由を説明する503ページを返す。
5. sessionが無くても開けるpathは`/api/auth/start`と`/offline`だけ（`lib/auth/paths.ts`の`PUBLIC_PATHS`）。
6. お気に入り・評価・ご飯の量は、テーブルの形を変えずに**読むときだけ`user_id`で絞らない**。書くときは今もログイン中の本人のIDで書く。レシピ詳細の「相手の評価」表示と、設定画面の「自分の名前」「相手の名前」「PINの変更」「ログアウト」は無くした。
7. 体重の記録（テーブル・画面・集計）をすべて削除する。

## RLSは変えていない

policyとgrantは一切変更していない。DBから見れば今までどおり「ログイン済みの利用者1人」としての読み書きで、**anonへは何も開放していない**。service role keyはserver-onlyのRoute Handlerだけで使い、ブラウザ・ログ・応答へ出さない。この発行手順が成立することの検証テストは`tests/integration/auth-session-issuance.test.ts`に残している（役割の説明を「/api/auth/startが使う仕組みの検証」に書き換えた）。

## 受け入れたリスク

- **URLを知っている人は誰でも読み書きできる。** 利用者が「鍵を完全になくす」ことを選んだため、URLそのものが唯一の防壁になる。URLを共有しない運用が前提。
- URLが第三者に知られた場合、アプリ側では止められない。対処はVercelのドメイン（URL）を変えるか、Deployment Protectionの併用になる（`docs/runbooks/production-checklist.md` 6）。
- 検索避けの`noindex`（`app/layout.tsx`）は引き続き設定している。

## 削除したもの

- 画面・コード: `app/(auth)/`一式（layout・login/page・login/actions・login/login-form・CSS）、`app/(main)/settings/actions.ts`、`lib/auth/pin.ts`、`lib/auth/pin-login.ts`、`lib/services/members.ts`、`components/records/weight-form.tsx`、`components/records/weight-chart.tsx`、`app/(main)/records/actions.ts`、`lib/services/records.ts`の`getMyWeights`、`lib/records/summary.ts`の`weightSeries`/ `parseWeightKg` / `WeightPoint` / `WeightSeries`
- スクリプト・テスト: `scripts/auth/set-pin.mts`、`scripts/auth/smoke-session.mts`、`supabase/tests/database/pin_auth.test.sql`、`supabase/tests/database/weight_records.test.sql`、`tests/integration/pin-login.test.ts`、`tests/unit/pin.test.ts`
- DB: テーブル`private.pin_credentials`・`private.login_throttles`・`public.weight_records`、関数`public.pin_login_begin(uuid, text)`・`public.pin_login_succeeded(uuid)`・`public.pin_set(uuid, text)`・`private.delete_stale_login_sources(text)`・`private.check_weight_record_date()`。`public.backup_snapshot()`は体重を外して作り直した（対象は20テーブル）
- 環境変数: `PIN_PEPPER`（`lib/env/server.ts`の検証、`scripts/check-client-bundle.mjs`、CIから削除）、CIの`E2E_PIN_1` / `E2E_PIN_2` / `E2E_MEMBER_1_NAME` / `E2E_MEMBER_2_NAME`

## 検討した代替案

- **PIN入力を残し、入力の間隔を長くする**: 手間が完全には無くならず、利用者の「ログインは不要」という指示に合わない。
- **URLに長い秘密の文字列を付けて鍵の代わりにする**: ブックマークや履歴に残り、管理の手間が増える。防壁としてはURLを秘密にする今の方式と同程度のため採らなかった。
- **anonへRLSを開放して誰でも読み書きできるようにする**: 鍵の管理は不要になるが、DB側の防壁まで無くなるため採らなかった（session発行をサーバーに限定し、RLSは据え置いた）。
