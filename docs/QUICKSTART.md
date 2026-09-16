# クイックスタート（スクリプトで自動公開）

[docs/SETUP.md](SETUP.md) の手順 1〜9 を、2 本のスクリプトで自動化したものです。
ターミナル（黒い画面）でコマンドを打てる方向けです。ブラウザだけで進めたい場合は SETUP.md を使ってください。

```
scripts/setup-supabase.sh   Supabase プロジェクト作成 → SQL 適用 → 会社・オーナー招待 → 認証設定 → API キー
        ↓
scripts/deploy-vercel.sh    Vercel プロジェクト作成 → 環境変数 → 本番デプロイ → 本番 URL → Supabase の URL 更新
        ↓
招待リンクをブラウザで開いてログイン
```

どちらのスクリプトも**何度実行しても壊れません**（途中で失敗したら、原因を直してそのまま再実行して構いません）。

---

## 0. 必要なもの

| もの | 確認・インストール |
|---|---|
| macOS / Linux のターミナル、または Windows の **Git Bash** か **WSL** | Windows の PowerShell やコマンドプロンプトでは動きません |
| `bash` 4 以上 | `bash --version` |
| `curl` | 通常は入っています。`curl --version` |
| `jq`（JSON を扱うコマンド） | macOS: `brew install jq` ／ Ubuntu: `sudo apt-get install -y jq` ／ Windows: `winget install jqlang.jq`（Git Bash を再起動）|
| Node.js 20 以上と npm | <https://nodejs.org/>（LTS 版）。`node -v` で `v20` 以上 |
| Vercel CLI（任意） | `npm i -g vercel`。無くても `npx` 経由で自動的に使います |
| このリポジトリ | `git clone <リポジトリURL>` して `cd ROOTIVE`（フォルダ名は環境により異なります） |
| Supabase / Vercel / GitHub のアカウント | SETUP.md の「前提」参照。無料プランで構いません |

---

## 1. トークンを取得する

### 1-1. Supabase Personal Access Token（必須）

1. <https://supabase.com/dashboard/account/tokens> を開きます（ダッシュボード右上のアイコン → **Account Settings** → **Access Tokens** でも同じ）。
2. **「Generate new token」** → Name に `rootive-setup` → **「Generate token」**。
3. 表示された `sbp_…` を控えます（**この画面を閉じると二度と見られません**）。
4. このトークンは「あなたの Supabase アカウントの全操作権限」です。他人に渡さないでください。作業が終わったら同じ画面の「Revoke」で無効化して構いません（その場合、次回は再発行）。

### 1-2. Supabase 組織 ID（新規作成時。組織が 1 つなら不要）

スクリプトはあなたの組織が 1 つだけなら自動検出します。複数ある場合は次で確認します。

1. <https://supabase.com/dashboard/org> を開き、使う組織を選びます。
2. 左メニュー **「General」**（組織設定）に **Organization slug**（または ID）が表示されます。URL の `https://supabase.com/dashboard/org/<ここ>/general` の部分と同じ値です。
3. 分からなければ、いったんスクリプトを実行すると組織の一覧（ID と名前）が表示されるので、それを `SUPABASE_ORG_ID` に指定して再実行します。

### 1-3. Vercel Token（必須）

1. <https://vercel.com/account/settings/tokens> を開きます（右上のアイコン → **Account Settings** → **Tokens** でも同じ）。
2. **Create Token**：Token Name `rootive-deploy`、Scope は自分のアカウント（チームで使う場合はそのチーム）、Expiration は任意（例 90 days）→ **「Create」**。
3. 表示されたトークンを控えます（1 回しか表示されません）。
4. チーム（Team）にデプロイする場合は、チームの URL `https://vercel.com/<チームslug>` の `<チームslug>` を `VERCEL_SCOPE` に指定します。個人アカウントなら不要です。

---

## 2. Supabase を準備する

リポジトリのフォルダで実行します。`export` 行の `...` を自分の値に置き換えてください。

```bash
cd ROOTIVE                                   # リポジトリのフォルダへ
export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx   # 1-1 のトークン
# export SUPABASE_ORG_ID=xxxxxxxxxxxxxxxx          # 組織が複数あるときだけ
# export APP_URL=https://rootive-profit.vercel.app # 本番 URL が分かっていれば（未定なら省略可）
bash scripts/setup-supabase.sh --write-env
```

処理内容（画面に進捗が出ます。新規作成時は起動待ちで 1〜3 分かかります）:

1. `rootive-profit` という名前のプロジェクトを **東京リージョン・Free プラン**で作成（同名があれば再利用。`SUPABASE_PROJECT_REF=xxxx` を渡せば既存プロジェクトを直接使用）。DB パスワードは自動生成して**画面に表示**するので控えます（`SUPABASE_DB_PASSWORD=...` で指定も可）。
2. `supabase/migrations/*.sql` を順番に適用（`setup_all.sql` と同じ内容。何度でも安全）。テーブル数・`backups` バケット・招待トリガーの存在を確認。
3. 会社「株式会社ROOTIVE」とオーナー招待（`rootive.biz@gmail.com`）を作成。有効な招待が既にあればそれを再利用し、**招待リンク**を表示。（`OWNER_EMAIL` / `COMPANY_NAME` で変更可）
4. 認証設定を更新：自由登録 OFF、Site URL / Redirect URLs（`APP_URL` 指定時）、5 種類の**日本語メールテンプレート**（`supabase/email-templates/`）と件名。
5. API キー（anon / service_role）を取得し、環境変数の形式で表示。`--write-env` を付けたので **`.env.production.local`** にも保存（Git には入りません。service_role キーを含むので他人に渡さない）。
6. 次のステップ（deploy-vercel.sh）を案内。

終了時の表示例:

```
■ オーナー招待リンク（ブラウザで開いて「ログインして始める」を押すだけでログインできます）
  <本番URL>/invite/7c3a9f…（48 文字）
  有効期限 : 2026-10-16 12:00（日本時間）／1 回のみ使用可
■ 環境変数（Vercel に設定する値）
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ…
SUPABASE_SERVICE_ROLE_KEY=（.env.production.local に保存済み）
...
```

`APP_URL` を省略した場合、招待リンクの `<本番URL>` 部分は次のステップで決まる URL に置き換えて使います。

---

## 3. Vercel にデプロイする

```bash
export VERCEL_TOKEN=xxxxxxxxxxxxxxxx          # 1-3 のトークン
# export VERCEL_SCOPE=my-team                  # チームにデプロイするときだけ
# export ANTHROPIC_API_KEY=sk-ant-...          # AI 月次分析を使うときだけ
bash scripts/deploy-vercel.sh
```

Supabase の値（URL・anon・service_role・プロジェクト参照 ID）は `.env.production.local` から自動で読み込まれます。ファイルを作っていない場合は `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` を `export` してから実行してください。
`SUPABASE_ACCESS_TOKEN` を同じターミナルで `export` したままにしておくと、最後に Supabase の Site URL も自動更新されます。

処理内容:

1. Vercel にログインできるか確認 → プロジェクト `rootive-profit` を作成（既にあれば再利用）してこのフォルダにリンク（`.vercel/` フォルダが作られます。Git には入りません）。
2. 本番（production）の環境変数を設定：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`（秘匿）/ `NEXT_PUBLIC_APP_URL` / 任意で `ANTHROPIC_API_KEY`・`ANTHROPIC_MODEL`。`CRON_SECRET`（Supabase 一時停止防止の定期アクセス用）は未指定なら自動生成します。既にある変数は削除してから入れ直します。
   `NEXT_PUBLIC_APP_URL` を指定しなかった場合は、Vercel が割り当てた本番ドメイン（`https://rootive-profit.vercel.app` など）を自動で使います。
3. `vercel --prod` で本番デプロイ（2〜4 分）。`vercel.json` により東京リージョン（`hnd1`）で動きます。
4. 本番 URL を確定。手順 2 の時点で取得できなかった場合はここで `NEXT_PUBLIC_APP_URL` を設定して自動的にもう一度デプロイします。
5. `SUPABASE_ACCESS_TOKEN` と `SUPABASE_PROJECT_REF` がある場合、Supabase の **Site URL** と **Redirect URLs**（`/auth/confirm`、`/auth/callback`、`/**`）を本番 URL で自動更新。無い場合は手動で設定する内容を表示します。

終了時に本番 URL が表示されます。

---

## 4. ログインして動作確認

1. 手順 2 で表示された招待リンクの `<本番URL>` を手順 3 の URL に置き換えてブラウザで開き、**「ログインして始める」** を押します。ダッシュボードが開けば成功です。
2. [docs/SETUP.md](SETUP.md) の **手順 11 動作確認チェックリスト** を実施します。
3. メールを本格的に使う場合は **手順 12 カスタム SMTP** を設定します（スクリプトでは行いません。オーナーの判断事項です）。

---

## 5. 失敗したとき・もう一度実行したいとき

| 状況 | 対応 |
|---|---|
| `jq が見つかりません` | 0. の表のとおりインストールして再実行 |
| `HTTP 401` | トークンが間違っている・期限切れ。1-1 / 1-3 で再発行 |
| `HTTP 403`／`404` | 組織 ID・プロジェクト参照 ID・チーム（scope）が違う |
| `HTTP 429` | API の回数制限。1 分待って再実行 |
| プロジェクト作成後に SQL でエラー | 表示されたエラー文（どのファイルの何行目か）を開発担当へ。直したら**そのまま再実行**（作成済みプロジェクトは再利用され、SQL は最初から適用し直されます） |
| `setup-supabase.sh` を再実行したら招待リンクが変わった | 前のリンクが期限切れ・使用済みだった場合だけ新しく発行されます。有効なリンクがあれば同じものが表示されます |
| DB パスワードを控え忘れた | アプリの動作には不要です。必要になったら Supabase → Project Settings → Database → **Reset database password** で再設定できます |
| `deploy-vercel.sh` でビルド失敗 | Vercel ダッシュボード → Deployments → 失敗したデプロイ → Build Logs を確認。環境変数の値（特にキーの前後の空白）を確認して再実行 |
| コードを更新した | `bash scripts/deploy-vercel.sh` を再実行するだけで再デプロイされます。GitHub と Vercel を連携している場合は push でも自動デプロイされます |
| DB のスキーマを更新した | `bash scripts/setup-supabase.sh`（`SUPABASE_PROJECT_REF` を指定）を再実行するか、SETUP.md 手順 2 で `setup_all.sql` を Run |
| 別の Supabase プロジェクトにやり直したい | Supabase → Project Settings → General → **Delete project** で削除し、再実行 |

作業が終わったら、`SUPABASE_ACCESS_TOKEN` と `VERCEL_TOKEN` は各サービスの画面で **Revoke（無効化）** しておくと安全です（アプリの動作には影響しません）。
