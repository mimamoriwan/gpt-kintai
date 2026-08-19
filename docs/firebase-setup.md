# Firebase本番設定

## 1. プロジェクトを用意する

1. 会社管理のGoogleアカウントでFirebaseプロジェクトを作成し、Blazeプランへ変更します。
2. Authenticationのメール／パスワードを有効化します。一般公開の新規登録画面はありません。
3. Firestore、Cloud Storage、Cloud Functionsを東京リージョンで有効化します。
4. Webアプリを登録し、`.env.example` を複製した `.env.local` に公開用Firebase設定値を入れます。
5. App CheckでWebアプリ用のreCAPTCHA Enterpriseキーを作成し、`VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` に設定します。

## 2. 秘密情報を登録する

OpenAI APIキーはブラウザ側の環境変数へ入れません。Firebase Secret Managerへ登録します。

```bash
firebase functions:secrets:set OPENAI_API_KEY
```

ローカル開発用のキーは `.env.local` の `OPENAI_API_KEY` に保存します。このファイルはGit管理対象外です。

## 3. 最初の3アカウントを作る

Google Application Default Credentialsで対象プロジェクトにログインした状態で実行します。

```bash
npm run bootstrap:production
```

方さん、管理担当者、社長のメールアドレスを順に入力します。表示されたパスワード設定URLは、それぞれ本人へ個別に共有してください。

先に管理担当者だけで動作確認する場合は、次の形式で登録できます。方さんと社長は、運用開始前に管理画面から招待します。

```bash
npm run bootstrap:production -- --project <プロジェクトID> --mode manager-only --name <表示名> --email <メールアドレス>
```

## 4. 配置する

```bash
npm run build:all
firebase use <プロジェクトID>
firebase deploy
```

既存の予定データがある環境でカレンダーv2へ更新するときは、配置前に対象件数を確認し、バックアップ後に移行を適用します。

```bash
npm run calendar:v2:dry-run
node scripts/migrate-calendar-v2.mjs --project <プロジェクトID> --confirm-project <プロジェクトID> --apply --backup tmp/calendar-v2-backup-YYYYMMDD.json
```

配置後、方さん・管理担当者・社長の3権限でログインし、試用受入項目を確認します。

## 5. 費用と利用量を監視する

- Google Cloud Billingで低額の予算通知を複数段階（例: 500円、1,000円、3,000円相当）に設定します。
- OpenAI Platformにも低額の利用通知・上限を設定します。
- 予算通知は課金を自動停止しないため、管理画面の月間利用量と請求画面を毎月確認します。
- FunctionsはNode.js 22を使用します。
