# GyoumuLog 勤怠・業務記録システム

方さんと管理担当者がスマートフォンから勤怠・日報を入力し、管理者と社長がPCで活動記録を確認する、日本語／簡体字対応のPWAです。

## MVPでできること

- 出社・出張・在宅・その他を選択した始業／終業記録
- 打刻忘れ・通信不良時の訂正と変更履歴
- 日報の原文保存、中国語から日本語へのAI翻訳、失敗時の再実行
- 写真・PDF・Word・Excel・Webリンクの添付と容量制限
- 管理担当者による確認、修正後の再確認表示
- 社長の閲覧専用ダッシュボード
- 管理者による招待・無効化、カテゴリ設定、月次JSON/CSVバックアップ
- Firebase Security Rules、Custom Claims、App Checkによる権限制御

## ローカル確認

```bash
npm install
npm --prefix functions install
npm run build:all
npm run emulators
```

別のターミナルで次を実行します。

```bash
npm run seed
npm run dev
```

デモ用アカウントは `scripts/seed-emulator.mjs` に記載されています。デモの認証情報を本番では使用しないでください。

## テスト

```bash
npm test
npm --prefix functions test
npm run test:rules
```

本番準備は [Firebase本番設定](docs/firebase-setup.md)、日常運用は [運用手順](docs/operations.md) を参照してください。
