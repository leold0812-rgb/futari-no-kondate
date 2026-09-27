# Production導入チェックリスト（Gate 8）

Developmentで2人が1週間の流れ（docs/product-spec.md「完了条件」）を通せたことを確認してから行う。
hosted Supabase・Vercelの秘密値はClaudeが扱えないため、すべて利用者が行う。手順の詳細は `hosted-development-setup.md` と同じで、**対象をProduction projectに変え、値はすべてDevelopmentと別に作る**。

## 1. 事前確認

- [ ] PR #7〜のGateがすべて `main` にマージされ、`main` のCI（lint・typecheck・test・build・DB・auth・E2E・復元テスト）が成功している
- [ ] Developmentで2人とも、ログイン → レシピ登録 → 週間決定 → 買い物 → 作った → 在庫・栄養・履歴・体重 を一通り使えた
- [ ] 本番データをDevelopmentへコピーしない／Developmentのデータを本番へ持ち込まない（本番は空から始める）

## 2. Supabase Production project

- [ ] Production projectのref（20文字）を確認し、Developmentのref（`jqkslfjdppwliugchwbm`）と違うことを確かめる
- [ ] migrationを適用する（`hosted-development-setup.md` A の `<dev-ref>` をProductionのrefにする。`db push --dry-run` で適用予定を確認してから）
- [ ] Auth設定（B）：Email providerの設定、サインアップ無効、Site URL・Redirect URLsを本番URLにする
- [ ] 管理用secret key（C）を **Production用に新しく** 作る（名前例 `local-admin-prod`）。`.env.production-admin.local` など別ファイルに置き、Developmentのファイルと混ぜない
- [ ] 2人のアカウント登録（D）。管理スクリプトは本番のrefでは止まるので、`--project-ref <prodのref> --production-ref <prodのref>` と2回書く
- [ ] session発行の確認（E、`smoke-session.mts` も同様に `--production-ref`）
- [ ] `PIN_PEPPER` を **Developmentと別の値** で作り（`openssl rand -hex 32`）、2人のPINを設定する（F）
- [ ] 食品成分表を取り込む（I、任意。`--production-ref` を付ける）

## 3. Vercel Production環境

Dashboard → Settings → Environment Variables で **Environment: Production のみ**、秘密値は **Sensitive: ON**。

- [ ] `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` がProduction projectの値
- [ ] `SUPABASE_SERVICE_ROLE_KEY`：Production projectで新しく作ったsecret key（名前例 `vercel-production`）
- [ ] `PIN_PEPPER`：2で作った本番用の値
- [ ] `CRON_SECRET`：`openssl rand -hex 24` などで作った16文字以上の値
- [ ] `OPENAI_API_KEY`（任意）：本番用のOpenAI project key。Usage limitを小さく設定する
- [ ] Blob store：Storage → Create → Blob → **Access: Private** で作り（後から変更不可）、Connect to Project で **Productionだけ** にチェック
- [ ] 登録後に `main` を再デプロイする

## 4. 動作確認（本番URL）

- [ ] iPhoneのSafariで開き、「ホーム画面に追加」する。アイコンが緑地に白いお皿で表示される
- [ ] 2人ともPINでログインでき、PINを数回間違えても正しいPINでログインできる
- [ ] レシピを1件登録し、もう1人の画面に出る（共有・同期）
- [ ] 体重を記録し、もう1人の記録画面には出ない
- [ ] 機内モードで開くと「通信できません」の案内が出る。機内モードを戻して「もう一度開く」で戻る
- [ ] Vercel Dashboard → Settings → Cron Jobs に `/api/cron/backup` があり、「Run」で手動実行すると成功する
- [ ] Storage → Blob store に `backups/日付/….json.gz` ができている
- [ ] 翌日、自動のバックアップが増えている（Logs で `backup: saved` を確認）

## 5. 復元の練習（1回）

- [ ] `backup-restore.md` の「日次バックアップを取り出す」で最新を手元へ保存できる
- [ ] 復元の確認モード（`--apply` なし）で、各テーブルの件数が表示される（空でないため「復元先にデータがあります」で止まるのが正しい）
- [ ] 取り出したファイルを削除する

## 6. 運用

- 環境変数を変えたら新しいデプロイで反映される
- secret key・`PIN_PEPPER`・`CRON_SECRET` が漏れた疑いがあれば、`hosted-development-setup.md`「後片付け・漏えい時」と同じ手順で本番の値を作り直す（`PIN_PEPPER` を変えたら2人のPINを設定し直す）
- 依存パッケージ・Supabase SDKの更新は独立した作業にし、Developmentで確認してから本番へ出す
