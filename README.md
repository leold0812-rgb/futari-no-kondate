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
- VercelのDevelopment / Preview / Production環境とSupabase Development / Production projectを分ける

## 現在地

Gate 0-4まで完了し、Gate 0-5（環境分離の設定手順）を整備しました。設計と運用手順は次の文書にあります。

- [プロダクト仕様](docs/product-spec.md)
- [アーキテクチャ](docs/architecture.md)
- [データベース](docs/database.md)
- [実装計画](docs/development-plan.md)
- [引き継ぎ](docs/handoff.md)
- [開発・本番環境の設定手順](docs/development-environments.md)
