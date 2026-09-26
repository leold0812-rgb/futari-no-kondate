# ふたりの献立

週1回の計画だけで、平日は選んで作れる「2人専用」の献立・まとめ買いWebアプリです。

## 解決すること

- 仕事後に献立を考える負担を減らす
- 週5食分の主菜・副菜・汁物から買い物をまとめる
- 在庫と傷みやすさを献立選びへ反映する
- 2人それぞれのご飯量・体重のプライバシーを扱う

## 方針

- Next.js / TypeScript / Supabase / Vercelで構築する
- iPhone向けPWA、モバイルファースト、日本語UIとする
- AIはレシピURLの構造化に限定し、推薦は決定的なスコアリングで行う
- 共有データと個人データをRow Level Security（RLS）で分離する
- ProductionとDevelopmentはVercel・Supabaseともに別環境とする

## 現在地

設計フェーズです。アプリ実装はまだ開始していません。設計の入口は次の文書です。

- [プロダクト仕様](docs/product-spec.md)
- [アーキテクチャ](docs/architecture.md)
- [データベース](docs/database.md)
- [実装計画](docs/development-plan.md)
- [引き継ぎ](docs/handoff.md)

