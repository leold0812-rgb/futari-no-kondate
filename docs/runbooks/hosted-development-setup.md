# hosted Development のセットアップ手順

Supabase Development project（`futari-no-kondate-dev`）を、アプリが動く状態にするための手順。
Claudeは資格情報（Supabaseのログイン、DB password、secret key）を扱わないため、**この手順はユーザーが自分のターミナルとDashboardで実行する**。
Production projectには触れない（Productionは`production-checklist.md`で別に行う）。

`<dev-ref>` はDevelopment projectのproject ref（Dashboard URLの `/project/<dev-ref>` 部分、20文字の英小文字）。

## 0. 前提

- mainの最新を取得済み（`git switch main && git pull`）で、`npm ci` 済み
- Node.js 24（`node --version`）

## A. migrationの適用

リポジトリの `supabase/migrations/` をDevelopment DBへ適用する。DB passwordはプロンプトに自分で入力する。

```bash
npx supabase login
```

```bash
npx supabase link --project-ref <dev-ref>
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
NEXT_PUBLIC_SUPABASE_URL=https://<dev-ref>.supabase.co
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
node --env-file=.env.bootstrap.local scripts/auth/bootstrap-couple.mts --project-ref <dev-ref>
```

実行する。

```bash
node --env-file=.env.bootstrap.local scripts/auth/bootstrap-couple.mts --project-ref <dev-ref> --apply
```

もう一度実行して「変更なし」になることを確認する。

```bash
node --env-file=.env.bootstrap.local scripts/auth/bootstrap-couple.mts --project-ref <dev-ref> --apply
```

- 「中止: 設定にないAuthユーザーが…」と出た場合は、Dashboard → Authenticationで既存ユーザーを確認する（スクリプトは既存ユーザーを削除しない）。
- Authユーザーの作成がEmail provider無効を理由に失敗した場合（ローカルでは起きないことを確認済み）は、Bの3だけを一時的にONへ戻して実行し、完了後すぐOFFへ戻す。
- `.invalid` のアドレスが拒否された場合（`email_address_invalid` など）は、自分が管理するドメインの配送されないアドレス（例：Gmailの`+`付きアドレス）に変えて再実行する。Email providerは無効なのでメールは送られない。

## E. session発行のスモークテスト

ADR 0001で未検証だった「hostedでもサーバー方式のsession発行が動くか」を確かめる。すべて `OK` なら完了。

```bash
node --env-file=.env.bootstrap.local scripts/auth/smoke-session.mts --project-ref <dev-ref>
```

`NG` の項目があれば、出力をそのままClaudeへ渡す（token・keyの値は出力されない）。

## F. PIN_PEPPERと2人のPIN（Gate 1.4）

PINはサーバーで `scrypt(HMAC(PIN_PEPPER, PIN))` として保存する。`PIN_PEPPER` はアプリ（Vercel）と管理スクリプトで**同じ値**を使う。変えると登録済みPINはすべて無効になり、再設定が必要になる。

1. pepperを作り、`.env.bootstrap.local` に `PIN_PEPPER=<出力>` を追記する（値は表示・共有しない）。

```bash
openssl rand -base64 48
```

2. 1人目が自分のPIN（6〜12桁の数字。同じ数字だけは不可。連番は可）を入力する。画面には表示されない。

```bash
node --env-file=.env.bootstrap.local scripts/auth/set-pin.mts --project-ref jqkslfjdppwliugchwbm --member 1
```

3. 2人目に交代して、本人が入力する。

```bash
node --env-file=.env.bootstrap.local scripts/auth/set-pin.mts --project-ref jqkslfjdppwliugchwbm --member 2
```

- PINを忘れた場合は、同じコマンドで再設定する。
- PINを続けて間違えてもアカウントはロックされない。同じ送信元（回線）からの試行は1時間20回までで、超えると1時間待つ（総当たり対策）。

## G. Vercel（Preview環境）へのサーバー秘密値の登録

PreviewデプロイでログインできるようにDevelopment用の値を登録する。Vercel Dashboard → Project `futari-no-kondate` → Settings → Environment Variables で、**Environment: Preview のみ**、**Sensitive: ON** にして追加する。

| 変数 | 値 |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Development projectで新しく作ったsecret key（名前 `vercel-preview`。Cで作ったローカル用とは分ける） |
| `PIN_PEPPER` | Fと同じ値 |

- Production環境には登録しない（Productionは本番導入チェックリストで別の値を作る）。
- ローカルで `npm run dev` する場合は、`.env.local` に同じ4変数（URL・publishable key・secret key・PIN_PEPPER）を置く。
- 登録後、PRのPreview URLを開き、2人ともログインできることを確認する。

## H. URL取り込み用のOpenAI API key（Gate 3、任意）

JSON-LD（構造化データ）を持つレシピサイトはキーなしでも取り込める。Instagramやブログなど構造化データの無いページをAIで読み取る場合だけ設定する。

1. OpenAIのDashboardで、このアプリ専用のproject（例：`futari-no-kondate-dev`）を作り、月の利用上限（Usage limits）を小さく設定する
2. そのprojectのAPI keyを作る
3. Vercel → Environment Variables に **Preview のみ・Sensitive** で `OPENAI_API_KEY` を追加する（ローカルは`.env.local`）
4. モデルを変える場合だけ `OPENAI_IMPORT_MODEL`（秘密値ではない）を設定する。既定は `gpt-5-mini`

- アプリ側でも1 spaceあたり1日20回までに制限している。失敗しても上位モデルへ自動で再試行しない。
- 送るのは公開ページのタイトル・説明・本文の先頭8000文字だけで、利用者の情報は送らない。

## I. 食品成分表の取り込み（Gate 2b、任意）

レシピの1人前の栄養とご飯の栄養を計算するための参照データ。取り込まなくても、レシピに手入力した栄養は使える。

1. 文部科学省「日本食品標準成分表（八訂）増補2023年」の本表（Excel）を公式サイトからダウンロードする（利用条件に従い、アプリでは出典として版名を表示する）
2. 表計算ソフトで次の6列だけを残し、1行目の見出しを英字に変えて、UTF-8のCSVで保存する（例：`food-composition.csv`、Git管理外の場所に置く）
   - 食品番号 → `food_number` / 食品名 → `name` / エネルギー（kcal） → `energy_kcal` / たんぱく質 → `protein_g` / 脂質 → `fat_g` / 炭水化物 → `carbs_g`
   - 「Tr」（微量）は0、「(0.1)」のような推定値はその値として読み込む。「-」や空欄の食品は取り込まない
3. 確認（取り込まない）

```bash
node --env-file=.env.bootstrap.local scripts/nutrition/import-food-composition.mts --project-ref jqkslfjdppwliugchwbm --file food-composition.csv --version "日本食品標準成分表（八訂）増補2023年"
```

4. 取り込む（同じ版・食品番号は上書きされるので、やり直しても重複しない）

```bash
node --env-file=.env.bootstrap.local scripts/nutrition/import-food-composition.mts --project-ref jqkslfjdppwliugchwbm --file food-composition.csv --version "日本食品標準成分表（八訂）増補2023年" --apply
```

- ご飯の栄養は食品番号 `01088`（こめ［水稲めし］精白米 うるち米）を使う。取り込んだ版で番号が違う場合は Claude に伝える。
- 取り込んだ後、アプリの「在庫 → 材料の設定 → 栄養の設定」で材料ごとに食品を選ぶと、その材料を使うレシピの栄養が自動で計算される。

## J. 記録とバックアップ（Gate 8）

- 体重の記録（`weight_records`）はAのmigration適用で使えるようになる。追加の設定は無い
- 日次バックアップ（Vercel Cron → private Blob）は **Productionでだけ動く**。`CRON_SECRET` とBlob storeは `production-checklist.md` の3で設定する。Developmentでは登録しない
- Developmentで手元にバックアップを取る・復元の手順は `backup-restore.md`
- 本番導入は `production-checklist.md`

## 後片付け・漏えい時

- secret keyが漏れた疑いがあれば、Settings → API Keysで `local-admin` を削除し、新しいキーを作ってC以降をやり直す。
- 登録をやり直したい場合（破壊的操作）：Dashboard → Authenticationで2人のユーザーを削除すると、profilesもcascadeで削除される。その後SQL Editorで `delete from public.couple_spaces;` を実行してからDをやり直す。
