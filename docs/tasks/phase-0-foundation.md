# Claude作業指示: Gate 0-1 Next.js最小土台

## 1. 目的

後続機能を安全に追加できる、最小のNext.js / TypeScriptプロジェクトを作る。この作業では認証・DB schema・業務機能を実装しない。

## 2. 事前確認

作業前にルート`AGENTS.md`、`docs/product-spec.md`、`docs/architecture.md`、`docs/ui-guidelines.md`、`docs/development-plan.md`を読む。不明点が実装を止めなければ合理的仮定を`docs/handoff.md`へ記録して進める。

## 3. 対象ファイル

- Next.js初期生成物（`app/`, `public/`, 設定ファイル）
- `components/navigation/`の最小ナビゲーション
- `.gitignore`, `.env.example`
- package scriptsと最小テスト設定
- `docs/handoff.md`

## 4. 変更してよい範囲

新規プロジェクトの土台、ホームの空状態、下部5タブの見た目、基本CSS、manifest、開発用toolingだけ。既存の設計文書は、実装上の事実との整合修正とhandoff追記を除き変更しない。

## 5. 仕様

- 安定版Next.js App Router、TypeScript、React、ESLintを使用する。
- package managerはlockfileを1種類だけ使用する。
- UIは日本語。Ivory / Charcoal / Muted Greenと`docs/ui-guidelines.md`のtokenをCSS変数化する。
- モバイル優先で、ホームに`今週の献立を決める`空状態と、下部に5タブ（ホーム、レシピ、在庫、買い物、記録）を表示する。
- タブは44px以上、iPhone Safe Areaを考慮する。未実装ページは簡潔な空状態にする。
- PWA manifestと仮アイコン参照を用意する。Service Worker/offline cacheはまだ導入しない。
- `.env.example`には変数名だけを置く：`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`。実値や架空の秘密値を書かない。
- server secretをclient moduleから参照しない。まだSupabase/OpenAI clientは実装しない。
- scriptsとして`dev`, `build`, `lint`, `typecheck`, `test`を実行できるようにする。
- UIの最小render testを1件作る。

## 6. 完了条件

- 依存install後に`lint`, `typecheck`, `test`, `build`が成功する。
- 375px幅で横スクロールせず、下部タブに本文が隠れない。
- manifestが有効で、秘密情報がGit追跡対象にない。
- 業務ロジック、DB、AI呼び出しが追加されていない。
- `docs/handoff.md`が実際の変更とテスト結果で更新されている。

## 7. 変更してはいけないもの

- 認証、Supabase table/migration、URL取得、AI、推薦、在庫、買い物の仮実装
- 外部UI kitや状態管理libraryの追加
- 原仕様の変更、英語UI、一般公開向けの登録画面
- APIキーや接続情報のハードコード

## 8. エラー時の方針

- package取得など外部要因で失敗した場合は、別frameworkや古いversionへ勝手に変更しない。
- エラー全文の要点、実行コマンド、変更済み範囲を報告し、壊れた生成物を隠さない。
- lint/testを無効化して成功扱いにしない。

## 9. 作業後の報告

- 変更ファイル一覧と各変更の目的
- 追加依存と採用理由
- 実行したコマンド、結果
- 未完了・既知の問題
- DB / 環境変数への影響
- 次に推奨するGate 0-2の作業

