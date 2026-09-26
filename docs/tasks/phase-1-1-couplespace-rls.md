# Claude作業指示: Gate 1.1 CoupleSpace / profiles migrationとRLS

## 1. 目的

Gate 1の最初の実装として、2人共有空間のデータ構造とDB側アクセス制御を作る。画面やログイン処理より先に、DBへ直接アクセスされても別空間や未認証者のデータが読めない境界を作る。

この指示はDB migration / RLS / policy testだけを対象とする。認証画面、ユーザー作成、パスコード、Proxy、アプリ画面は後続作業に分ける。

## 2. 事前確認

作業前に次を読む。

- ルート`AGENTS.md`
- `docs/product-spec.md`の対象・認証に関する仮定
- `docs/database.md`の共通規約、認証エンティティ、RLS方針、整合性
- `docs/architecture.md`の認証案
- `docs/development-plan.md`のGate 1
- `docs/handoff.md`の最新状況

現在のブランチとgit statusを確認し、既存変更を保持する。Development用Supabaseだけをテスト対象にし、Production接続・変更をしない。

## 3. 対象ファイル

- `supabase/config.toml`（未作成の場合のみCLI初期化で生成）
- `supabase/migrations/`の新規migration
- `supabase/tests/`のRLS/policy test
- `docs/database.md`の確定したschemaとの差分
- `docs/handoff.md`

必要ならSupabase CLIのdevelopment dependencyとnpm scriptを追加してよい。新規依存は追加理由を報告する。

## 4. 変更してよい範囲

- 最小の`couple_spaces`と`profiles` schema
- 最大2人をDBで強制する仕組み
- anon/authenticatedに対するtable grants、RLS、policy
- RLSを安全に評価する必要最小限のprivate helper function
- migrationを検証するテストとローカル開発設定
- 実装と一致する`docs/database.md` / `docs/handoff.md`の更新

レシピ、在庫、週間献立、体重など後続Gateのtableは追加しない。

## 5. 固定仕様

### データ

- `couple_spaces`: UUID主キー、作成日時など最小列
- `profiles`: `id`は`auth.users.id`を参照、`couple_space_id`は必須FK、`display_name`は共有画面で見せる名前だけを格納する
- email、パスコード、Auth metadataなどの認証情報を`profiles`へ複製しない
- CoupleSpaceはメンバー0〜2人の状態を取れるようにし、ユーザー作成・初期2人の登録はこの作業に含めない
- 初期Authユーザーの追加・profile登録は後続のbootstrap作業で行う。migrationへ環境固有のUUID、メール、名前をハードコードしない

### 2人上限

- 1 CoupleSpaceにつきprofileは最大2件
- 同時に2件を超える追加が行われても上限を超えないよう、space行のロックを含むtransactionalな制約にする
- profileを別spaceへ移す操作を一般ユーザーに許さない

### RLS / grants

- `couple_spaces`と`profiles`の両方でRLSを有効化する
- anonは両tableに一切アクセスできない。必要なtable grantsも明示的にrevokeする
- authenticatedは自分が属するCoupleSpaceと、そのspace内の最小限のprofile列（ID、表示名、space ID）のみ読める
- profileの作成、削除、所属変更、role変更は一般ユーザーに許さない。この作業ではプロフィール更新も許可しない
- policyの所属判定で`profiles`を直接再帰参照しない。helperを使う場合はprivate schemaに置き、`SECURITY DEFINER`は必要最小限にする。使用時は`SET search_path = ''`、全relationをschema修飾し、不要なroleからEXECUTEをrevokeする
- helperをPostgRESTのexposed schemaへ追加しない
- grantsとRLS policyの両方で閉じる。policyを作っただけで安全と判断しない
- service role keyはアプリruntimeやClient Componentへ追加しない

## 6. テスト要件

ローカルDevelopment用DBで、最低限以下をテストする。

1. anonはCoupleSpace/profileの行を読めず、書き込みも拒否される
2. 同じspaceの認証済みユーザーはspaceと最小profile列を読める
3. 未所属ユーザーはどのspace/profileも読めない
4. ユーザーAはprofileを作成・削除・別spaceへ移動できない
5. 3人目の追加は拒否され、既存の2人とspaceに変更がない
6. 2人目までの初期登録は許可される
7. migrationを空のlocal DBへ適用できる

テスト用Auth user・space・profileは架空fixtureだけを使い、Productionや実ユーザーを使用しない。テスト方法が現在のSupabase CLI環境で実行できない場合は、テストを省略して成功扱いにせず、具体的な不足条件を報告する。

## 7. 完了条件

- 新規migrationだけでschema、制約、grants、RLS、policy、必要なhelperを再現できる
- 同一spaceの2ユーザーだけが許可範囲を読めることをpolicy testで確認できる
- anon、未所属、別space、3人目、所属変更を拒否するテストがある
- profileへAuth資格情報を複製せず、テストfixtureに実ユーザー情報を使っていない
- Development projectのみを使い、Productionに接続・変更していない
- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`とDB policy testの結果を報告する
- `docs/database.md`に最終的な設計、`docs/handoff.md`に完了内容・migration・既知の問題・次の作業を反映する

## 8. 変更してはいけないもの

- public signup、ログインUI、パスコード認証、セッションProxy
- service role keyのclient公開、ProductionへのSQL適用
- table grantsを検証せず省略すること
- RLSを無効にすること、security definer helperをpublic/exposed schemaに作ること
- email、PIN、ユーザー名をmigration / fixture / logへハードコードすること
- 対象外tableや将来機能を先回りして追加すること

## 9. エラー時の方針

- Supabase CLI / Dockerが利用できない場合、実行した確認内容と不足条件を報告する。Production DBで代用しない。
- migrationが失敗したら原因を特定し、既存migrationを書き換えて適用済み履歴と不整合にしない。修正migrationが必要か説明する。
- RLS policyの再帰を避けるためだけにRLSを外す、全authenticatedへ広く許可する等の回避をしない。
- テストを無効化・削除して成功扱いにしない。

## 10. 作業後の報告

- 変更ファイルとschema / policyの要点
- 2人上限を同時実行でも守る方法
- policy/grantごとに誰が何をできるか
- 実行コマンドとテスト結果
- 開発依存・環境変数の変更
- 未完了・既知の問題
- 次のGate 1.2作業（2 Auth accountsの開発環境bootstrap）
