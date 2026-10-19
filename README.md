# GyoumuLog 勤怠・業務記録システム

勤務実態と業務内容を記録し、日報・週次報告・月次資料へつなげる日本語／簡体字対応のPWAです。

## 保存している本番版

2026年10月19日17:29:48（日本時間）に公開したHosting版 `b4e6cd0e9d9aed21` のソースを保存しています。2026年10月20日に現行配信22ファイルとの一致を再確認しました。このGitHub同期では本番への再配置や業務データの変更を行いません。

- [本番版のGitHub保存記録](docs/production-sync.md)
- [公開状態と次回作業の基点](docs/refactor-rollout.md)
- [保存対象のソース照合表](docs/production-source-sha256.json)

## 主な機能

- 始業・終業、打刻訂正、会社休日、共有カレンダー
- 写真・資料・Webリンク付きの業務メモ、AI日報、提出・確認・返信通知
- 商品候補・発見理由・確認状況の記録
- 週次報告、定例会、指定期間の月次レポート
- 会社の取り組み、工程表、節目、近況と担当者の管理
- お知らせの宛先指定、添付、確認・対応、個別チャット、リマインダー、端末プッシュ通知
- 今週のTo Do、目標・進捗・実績・振り返りの共有、社長本人の入力、当日の業務メモへの追加
- ホームの機能アイコン、未確認件数、画面幅に応じた表示、明示操作によるアプリ更新
- ログイン復旧、初回パスワード変更、専用権限でのアカウント管理
- 日本語／簡体字の切り替え・翻訳と、メニューから開く更新情報

## ローカル確認

Node.js 22を使用します。

```bash
npm ci
npm --prefix functions ci
cp .env.example .env.local
cp .env.production.example .env.production
```

既存のFirebase Web・App Check設定を `.env.local` に、Web Push公開鍵を `.env.production` に設定します。これらの実値ファイルはGit管理対象外です。OpenAIの秘密鍵はブラウザーへ渡さず、サーバーのSecret Managerで管理します。

```bash
npm test
npm --prefix functions test
npm test -- src/App.test.tsx src/pages/UpdatesPage.test.tsx
npm run build:all
```

エミュレーターでの試験データは `scripts/seed-emulator.mjs` を使用します。本番でのアカウント作成・データ移行は、それぞれの対象と権限を確認して別途実施します。

## 本番への配置

GitHubへのpushと本番への配置は別の操作です。今回の保存には自動配置のワークフローを追加していません。

Functionsのうち78処理をこのリポジトリで管理します。同じFirebaseプロジェクト上のCOCO関連20処理はCOCO側のソースで管理します。一括配置で共通処理を削除しないよう、変更した関数だけを指定します。Rules・indexesも現在の配備を読み取って保存したものであり、無条件に再配置しません。

詳細は [保存記録と配置範囲](docs/production-sync.md) と [Firebase設定](docs/firebase-setup.md) を確認してください。

## 変更の記録

利用者に見える変更は、同じ変更で `src/data/updates.ts` に日本語・簡体字の記録を追加します。[開発ルール](AGENTS.md) と [記録手順](docs/update-history.md) を参照してください。更新情報はサイドバーまたはスマートフォンの画面メニューで選んだときにだけ表示します。
