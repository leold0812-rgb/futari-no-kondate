# バックアップと復元（Gate 8）

## 仕組み

- Vercel Cron が毎日 **03:00〜03:59（日本時間）** に `/api/cron/backup` を呼ぶ（`vercel.json`、UTC 18時。Hobbyプランは時刻の精度が1時間単位）
  - Cron は **Productionのデプロイでだけ** 動く（Previewでは動かない）
  - `Authorization: Bearer <CRON_SECRET>` が一致しなければ401を返す
- DBの論理データを gzip した JSON にして、**private の Blob store** の `backups/YYYY-MM-DD/<日時>.json.gz` に保存する
- 30日を過ぎたバックアップは同じ処理で削除する（最新の1件は期限を過ぎても残す）

### 含まれるもの・含まれないもの（`lib/backup/core.mts`）

| 含む | 含まない |
|---|---|
| 2人・共有space、レシピ・材料・評価・お気に入り、在庫と補正履歴、週間計画・推薦・献立セット、買い物、食事・調理履歴、ご飯量、**体重**、食品成分表 | PINの派生値と試行記録（復元後にPINを設定し直す）、URL取り込みの利用記録、Authのアカウント（Supabaseが管理）、**料理画像のファイル**（パスだけ保存。画像は再撮影・再取り込みで戻す） |

バックアップには体重などの個人データが入る。**ダウンロードしたファイルはiCloud等の同期フォルダやリポジトリに置かず、用が済んだら削除する。**

## 復元テスト（自動）

CI（`e2e / app flows`）の最後に `scripts/backup/roundtrip-check.mts` が、E2Eで作ったデータを「バックアップ → 全テーブルを空に → 復元 → もう一度バックアップ」し、前後の内容が一致することを確かめる。ローカルSupabase以外では動かない。

## 手動でバックアップを取る

危険な作業の前など。`.env.bootstrap.local`（`docs/runbooks/hosted-development-setup.md` C）を使う。

```bash
node --env-file=.env.bootstrap.local scripts/backup/export.mts --project-ref jqkslfjdppwliugchwbm --out ~/Desktop/futari-backup.json.gz
```

## 日次バックアップを取り出す

1. Vercel Dashboard → Storage → バックアップ用のBlob store → Settings（または `.env.local` タブ）で `BLOB_READ_WRITE_TOKEN` を確認する
2. リポジトリ直下に `.env.backup.local` を作り、`BLOB_READ_WRITE_TOKEN=` の後に貼る（Git管理外。チャットには貼らない）
3. 一覧を見る

```bash
node --env-file=.env.backup.local scripts/backup/fetch.mts --list
```

4. 最新を取り出す（特定の日なら `--pathname backups/…` を指定）

```bash
node --env-file=.env.backup.local scripts/backup/fetch.mts --latest --out ~/Desktop/futari-backup.json.gz
```

## 復元する

復元は **空のSupabase project** へ行う（既存データへの上書き・混在はしない。対象テーブルにデータがあればスクリプトが止まる）。
途中で失敗した場合、スクリプトは入れた分を消して空の状態へ戻す（原因を直してから同じコマンドをもう一度実行できる）。食品成分表もバックアップに含まれるので、復元先で先に取り込まない。

1. 新しいSupabase projectを作り、`hosted-development-setup.md` の A（migration）〜 D（2人のアカウント登録）を行う
2. 2人のAuthアカウントのIDがバックアップと違う場合は、対応表を作る（Dashboard → Authentication で新しいIDを確認。バックアップの旧IDは `profiles` の `id`）

```json
{ "旧ID(1人目)": "新ID(1人目)", "旧ID(2人目)": "新ID(2人目)" }
```

3. 確認（まだ入れない）。空でない・アカウントが無い場合は理由を表示して止まる

```bash
node --env-file=.env.bootstrap.local scripts/backup/restore.mts --project-ref <復元先ref> --file ~/Desktop/futari-backup.json.gz --user-map user-map.json
```

   - 復元先がDevelopment・ローカル以外（本番）なら `--production-ref <同じref>` も付ける

4. 復元する

```bash
node --env-file=.env.bootstrap.local scripts/backup/restore.mts --project-ref <復元先ref> --file ~/Desktop/futari-backup.json.gz --user-map user-map.json --apply
```

5. 2人のPINを設定し直す（F）。アプリで2人ともログインし、レシピ・献立・在庫・記録（体重は本人だけ）が戻っていることを確かめる
6. VercelのURL・keyの環境変数を新しいprojectへ向け直し、再デプロイする
7. 使い終わったバックアップファイルと `user-map.json` を削除する

## 失敗したとき

- Cronの実行結果は Vercel Dashboard → Project → Logs（`/api/cron/backup`）で確認できる。応答とログには件数だけが出る（データの中身は出ない）
- `CRON_SECRET is not configured`（503）：Production環境に `CRON_SECRET`（16文字以上）が無い
- `backup failed`（500）：ログの `backup: failed:` の後の理由を見る。Blob storeが未接続、Supabaseのsecret keyが無効などが多い
