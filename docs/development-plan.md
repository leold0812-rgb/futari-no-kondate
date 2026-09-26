# 開発計画

各作業は「migration → サーバー処理 → UI → テスト」のレビュー可能な単位に分け、完了ごとにCodexレビューと`docs/handoff.md`更新を行う。

## Gate 0: 土台

1. Next.js / TypeScript / lint / testの最小構成
2. PWA manifest・アイコン・モバイルshell（空の5タブ）
3. Supabase browser/server clientと環境変数schema
4. CI（lint、typecheck、test、build）
5. Development / Production設定手順（[環境設定手順](development-environments.md)）

完了条件：秘密値なしでローカル起動・buildでき、環境不足時に安全に失敗する。

## Gate 1: 認証・共有境界

1. [CoupleSpace / profiles migrationとRLS](tasks/phase-1-1-couplespace-rls.md)
2. PIN認証後にSupabase Auth sessionを作る方式のDevelopment-only spike
3. 固定2 Auth accountsのbootstrap（新規登録なし）
4. PINのserver-side検証、永続rate limit、Supabase Auth session発行
5. ユーザー選択＋PIN画面
6. `proxy.ts`によるsession更新、保護route、ログアウト
7. 個人/共有アクセスの統合テスト

完了条件：2人だけが共有領域へ入り、別空間と相手の個人データを読めない。

## Gate 2: レシピと栄養の基盤

1. Ingredient / Recipe migration
2. レシピCRUD service
3. 一覧・詳細・評価・お気に入り
4. 検索・filter・sort
5. 食品成分マスタとingredient mapping
6. 人数・ご飯量・栄養計算
7. 調理モード

## Gate 3: URL取り込み

1. URL検証と安全なfetch
2. 本文抽出adapter
3. OpenAI structured outputとschema検証
4. 確認・修正画面
5. Storage画像コピー
6. URLのみ保存の失敗経路
7. SSRF、timeout、AI errorテスト

## Gate 4: 在庫

1. inventory migrationと状態算出
2. 一覧・手動補正
3. 単位変換ライブラリ
4. 購入/調理によるtransaction更新
5. 監査・境界値テスト

## Gate 5: 週間計画

1. recommendation純粋関数とfixture test
2. weekly plan migration・二重作成防止
3. 10候補生成API/service
4. swipe/button UI、undo、5品確認
5. 確定transactionと同時実行テスト

## Gate 6: 副菜・汁物と買い物

1. meal set組み合わせロジック
2. 全材料の合算と互換単位処理
3. 在庫差引・家にあるチェック
4. 保険食材提案
5. 買い物一覧・カテゴリ順・購入済みtransaction
6. Realtimeと2人同時操作テスト

## Gate 7: 日常利用と余裕日

1. ホームの5献立・USE_SOON順
2. 献立セットと当日差し替え
3. `作った`の冪等transaction
4. 初回評価
5. 余裕日候補

## Gate 8: 記録・バックアップ・仕上げ

1. WeightRecord owner-only RLSとpolicy test
2. 食事履歴・週平均・体重グラフ
3. private Blobへの日次backup、30日削除、Cron認証
4. 復元手順と復元テスト
5. PWA実機、offline/error/empty、アクセシビリティ確認
6. Production導入チェックリスト

Cron endpointは16文字以上のランダムな`CRON_SECRET`で保護し、バックアップ先は作成時からprivate Blob storeを選ぶ（storeの公開/非公開は後から変更できないため）。

## レビュー基準

各単位をCritical / Important / Minor / Goodで判定する。Criticalはマージ前に解消する。重点対象は仕様、RLS、個人/共有、不要入力、モバイル、エラー時整合性、AIコストである。
