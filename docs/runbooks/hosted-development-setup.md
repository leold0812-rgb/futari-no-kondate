# hosted Development のセットアップ手順

Supabase Development project（`futari-no-kondate-dev`）を、アプリが動く状態にするための手順。
Claudeは資格情報（Supabaseのログイン、DB password、secret key）を扱わないため、**この手順はユーザーが自分のターミナルとDashboardで実行する**。
Production projectには触れない（Productionは`production-checklist.md`で別に行う）。

Development projectのproject refは `jqkslfjdppwliugchwbm`（Dashboard URLの `/project/<ref>` 部分）。スクリプトはこのref以外のhosted projectを拒否する（Productionを取り違えないため）。

## 0. 前提

- mainの最新を取得済み（`git switch main && git pull`）で、`npm ci` 済み
- Node.js 24（`node --version`）

## A. migrationの適用

リポジトリの `supabase/migrations/` をDevelopment DBへ適用する。DB passwordはプロンプトに自分で入力する。

```bash
npx supabase login
```

```bash
npx supabase link --project-ref jqkslfjdppwliugchwbm
```

適用予定のmigrationだけが表示されることを確認する（まだ何も変わらない）。

```bash
npx supabase db push --dry-run
```

```bash
npx supabase db push
```

LocalとRemoteの列が同じになっていれば完了。

```bash
npx supabase migration list
```

後で誤ってpushしないよう、linkを外す。

```bash
npx supabase unlink
```

## B. Auth設定（Dashboard）

Development projectのDashboardで次を設定する（ADR 0001の決定）。

1. Authentication → Sign In / Providers →「Allow new users to sign up」を**OFF**
2. Authentication → Sign In / Providers → Email →「Email OTP Expiration」を**60秒**（設定できない場合は許容される最小値）にして保存
3. 同じEmail設定で「Enable Email provider」を**OFF**にして保存

補足：`supabase config push` は使わない。`supabase/config.toml` にはローカル専用の値（`site_url = 127.0.0.1`、`otp_expiry = 20`）が入っているため。

## C. 管理用secret keyの準備

1. Settings → API Keys → Secret keys →「New secret key」で名前 `local-admin` のキーを作る（既存のキーは使わない。不要になったらこのキーだけ削除できる）
2. リポジトリ直下に `.env.bootstrap.local` を作り、次を書く（`.env*` はGit管理外。値をチャットやissueに貼らない）

```text
NEXT_PUBLIC_SUPABASE_URL=https://jqkslfjdppwliugchwbm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Development の publishable key>
SUPABASE_SERVICE_ROLE_KEY=<上で作った secret key>
BOOTSTRAP_MEMBER_1_EMAIL=member-1@futari-no-kondate.invalid
BOOTSTRAP_MEMBER_1_DISPLAY_NAME=<1人目の表示名>
BOOTSTRAP_MEMBER_2_EMAIL=member-2@futari-no-kondate.invalid
BOOTSTRAP_MEMBER_2_DISPLAY_NAME=<2人目の表示名>
```

- メールは配送されない管理用アドレス（`.invalid`はRFC 6761の予約TLD）。Authのログインには使わず、サーバーがsession発行時に内部で参照するだけ。
- 表示名はログイン画面に出る名前（1〜30文字、2人で別の名前）。

## D. 2人のアカウント登録（bootstrap）

まずdry-run（書き込まない）。予定の操作が「Authユーザー作成×2、CoupleSpace作成、profile作成×2」であることを確認する。

```bash
node --env-file=.env.bootstrap.local scripts/auth/bootstrap-couple.mts --project-ref jqkslfjdppwliugchwbm
```

実行する。

```bash
node --env-file=.env.bootstrap.local scripts/auth/bootstrap-couple.mts --project-ref jqkslfjdppwliugchwbm --apply
```

もう一度実行して「変更なし」になることを確認する。

```bash
node --env-file=.env.bootstrap.local scripts/auth/bootstrap-couple.mts --project-ref jqkslfjdppwliugchwbm --apply
```

- 「中止: 設定にないAuthユーザーが…」と出た場合は、Dashboard → Authenticationで既存ユーザーを確認する（スクリプトは既存ユーザーを削除しない）。
- Authユーザーの作成が失敗した場合は、Email providerを有効に戻さず（ADR 0001：有効中は匿名のログインメール送信要求が受理される）、出力をそのままClaudeへ渡す。ローカルではEmail provider無効でも作成できることを確認済み。
- `.invalid` のアドレスが拒否された場合（`email_address_invalid` など）は、自分が管理するドメインの配送されないアドレス（例：Gmailの`+`付きアドレス）に変えて再実行する。Email providerは無効なのでメールは送られない。

## E. session発行のスモークテスト

ADR 0001で未検証だった「hostedでもサーバー方式のsession発行が動くか」を確かめる。すべて `OK` なら完了。

```bash
node --env-file=.env.bootstrap.local scripts/auth/smoke-session.mts --project-ref jqkslfjdppwliugchwbm
```

`NG` の項目があれば、出力をそのままClaudeへ渡す（token・keyの値は出力されない）。

## F. 以降のGateで追加される手順

- PINの設定と`PIN_PEPPER`の登録（Gate 1.4）→ このファイルの「G」以降へ追記する
- アプリの秘密値のVercel登録（Preview環境、Sensitive）→ 同上

## 後片付け・漏えい時

- secret keyが漏れた疑いがあれば、Settings → API Keysで `local-admin` を削除し、新しいキーを作ってC以降をやり直す。
- 登録をやり直したい場合（破壊的操作）：Dashboard → Authenticationで2人のユーザーを削除すると、profilesもcascadeで削除される。その後SQL Editorで `delete from public.couple_spaces;` を実行してからDをやり直す。
