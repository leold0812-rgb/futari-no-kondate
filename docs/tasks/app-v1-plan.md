# アプリv1 実装計画と進捗（feature list）

2026-09-27開始。ユーザー指示「Gate 1.3以降、アプリ実装まで進める。判断はClaudeのおすすめに任せ、最後に判断一覧を開示する」に基づく長期作業の状態ファイル。
中断・再開時はこのファイルと`docs/handoff.md`を読む。

## 進め方

- Gateごとにブランチ → PR → CI（lint / typecheck / unit / build、DB pgTAP、Auth統合、E2E）→ Codexレビュー（`codex review --base main`）→ Critical解消 → マージ。
- MacにDockerがないため、Supabaseを使うテスト（pgTAP・統合・E2E）はGitHub Actionsのローカル Supabase で実行する。hosted Supabaseには接続しない。
- hosted Development / Productionの操作（Supabaseのlogin・DB password・secret key・Auth設定・Vercelの秘密値）は、Claudeが資格情報を扱えないため、`docs/runbooks/`の手順書としてユーザーへ渡す。

## Feature list

状態：`todo` / `wip` / `done`（PR番号）

| Gate | 内容 | 状態 |
|---|---|---|
| 1.3 | 固定2人のAuthアカウントbootstrapスクリプト（冪等・dry-run既定）とhosted Dev手順書 | wip |
| 1.4 | PINのハッシュ保存・サーバー検証・永続的試行制限・session発行 | todo |
| 1.5 | ユーザー選択＋PIN画面 | todo |
| 1.6 | `proxy.ts`によるsession更新・保護route・ログアウト | todo |
| 1.7 | 個人/共有アクセスの統合テスト、E2E基盤（CIのローカルSupabase＋Playwright） | todo |
| 2 | レシピ・材料・評価/お気に入り・検索/filter/sort・人数換算・調理モード・画像・栄養マスタ | todo |
| 3 | URL取り込み（SSRF対策fetch・JSON-LD抽出・OpenAI構造化・確認画面・URLのみ保存） | todo |
| 4 | 在庫（単位ライブラリ・lot・状態算出・手動補正・監査） | todo |
| 5 | 週間計画（推薦純粋関数・10候補・スワイプ/undo・5品確定） | todo |
| 6 | 副菜/汁物・材料合算・在庫差引・家にあるチェック・保険食材・買い物・購入済み・Realtime | todo |
| 7 | ホーム5献立・差し替え・作った（冪等）・初回評価・余裕日 | todo |
| 8 | 体重（本人のみ）・食事履歴・週平均・グラフ・Blobバックアップ・復元・PWA仕上げ・本番チェックリスト | todo |

## 判断ログ（最後にユーザーへ開示する）

ユーザーから委任された判断を記録する。各項目は「判断 / 理由」。

1. hosted Supabaseの操作（migration適用・Auth設定・bootstrap実行・PIN設定）は手順書化してユーザーが実行する / Supabase CLIが未ログインで、DB password・secret keyなどの資格情報をClaudeが扱わない安全上のルールのため。
2. 管理用メールは配送されない`.invalid`ドメイン（例 `member-1@futari-no-kondate.invalid`）を推奨値とする / RFC 6761の予約TLDで誤配送が起きない。hostedで拒否された場合の代替は手順書に記載。
3. Gate 1.3にhostedでのsession発行確認（ADR 0001の未検証項目）を含める / 2人が実際にログインできることの実証になるため。手順書の最終ステップとして用意する。
