# クイックスタート（自動公開）

[docs/SETUP.md](SETUP.md) の手順 1〜9（Supabase の準備 → Vercel へのデプロイ → URL 設定）を自動化したものです。
やり方は 2 つあります。

| 方法 | 向いている人 | 必要なもの |
|---|---|---|
| **方法 A：GitHub Actions（推奨・実績あり）** | ブラウザだけで済ませたい人。パソコンに何も入れたくない人 | GitHub のリポジトリ画面が開けること、Supabase と Vercel のトークン |
| **方法 B：手元のパソコンでスクリプト** | ターミナル（黒い画面）でコマンドを打てる人 | bash / curl / jq / Node.js |

どちらも中身は同じ 2 本のスクリプト（`scripts/setup-supabase.sh` → `scripts/deploy-vercel.sh`）で、**何度実行しても壊れません**（途中で失敗したら、原因を直してそのまま再実行して構いません）。

実際の本番環境（2026 年 9 月に方法 A で公開済み）:

| 項目 | 値 |
|---|---|
| 本番 URL | <https://rootive-profit.vercel.app>（Vercel の本番エイリアス。デプロイのたびに変わる `rootive-profit-xxxx.vercel.app` ではなく、こちらを使います） |
| Supabase プロジェクト | 参照 ID `rmchixgmeqtszqsdvxrj`（東京 `ap-northeast-1`・Free プラン）。ダッシュボード：<https://supabase.com/dashboard/project/rmchixgmeqtszqsdvxrj> |
| Vercel プロジェクト | `rootive-profit`（東京 `hnd1`・Hobby プラン） |

```
scripts/setup-supabase.sh   Supabase プロジェクト作成 → SQL 適用 → 会社・オーナー招待 → 認証設定 → API キー
        ↓
scripts/deploy-vercel.sh    Vercel プロジェクト作成 → 環境変数（REST API で登録）→ 本番デプロイ → 本番 URL → Supabase の URL 更新
        ↓
招待リンクをブラウザで開いてログイン
```

---

## 1. トークンを取得する（方法 A・B 共通）

### 1-1. Supabase Personal Access Token（必須）

1. <https://supabase.com/dashboard/account/tokens> を開きます（ダッシュボード右上のアイコン → **Account Settings** → **Access Tokens** でも同じ）。
2. **「Generate new token」** → Name に `rootive-setup` → **「Generate token」**。
3. 表示された `sbp_…` を控えます（**この画面を閉じると二度と見られません**）。
4. このトークンは「あなたの Supabase アカウントの全操作権限」です。他人に渡さないでください。作業が終わったら同じ画面の「Revoke」で無効化して構いません（その場合、次回は再発行）。

### 1-2. Supabase 組織 ID（組織が 1 つなら不要）

スクリプトはあなたの組織が 1 つだけなら自動検出します。複数ある場合は次で確認します。

1. <https://supabase.com/dashboard/org> を開き、使う組織を選びます。
2. 左メニュー **「General」**（組織設定）に **Organization slug**（または ID）が表示されます。URL の `https://supabase.com/dashboard/org/<ここ>/general` の部分と同じ値です。
3. 分からなければ、いったん実行すると組織の一覧（ID と名前）がログに出るので、それを `SUPABASE_ORG_ID` に指定して再実行します。

### 1-3. Vercel Token（必須）

1. <https://vercel.com/account/settings/tokens> を開きます（右上のアイコン → **Account Settings** → **Tokens** でも同じ）。
2. **Create Token**：Token Name `rootive-deploy`、Scope は自分のアカウント（チームで使う場合はそのチーム）、Expiration は任意（例 90 days）→ **「Create」**。
3. 表示されたトークンを控えます（1 回しか表示されません）。
4. チーム（Team）にデプロイする場合は、チームの URL `https://vercel.com/<チームslug>` の `<チームslug>` を `VERCEL_SCOPE` に指定します（方法 B のみ。方法 A は個人アカウント前提）。

> **貼り付けの注意**：トークンをコピーするとき、末尾に改行（Enter）が混ざることがあります。改行入りのトークンは Vercel CLI が「無効なトークン」として拒否します。スクリプトは前後の空白・改行を自動で取り除くようになりましたが、GitHub の Secrets や `export` に貼るときは、値の末尾に余計な行が入っていないか一度確認してください。

---

## 方法 A：GitHub Actions で公開する（推奨）

GitHub のリポジトリ画面から「ボタンを押すだけ」で、Supabase の準備から Vercel へのデプロイまで自動で行います。パソコンに何もインストールしません。

### A-1. Secrets（トークン）を登録する

1. GitHub でこのリポジトリを開き、上部の **「Settings」** タブ → 左メニューの **「Secrets and variables」** → **「Actions」** を押します。
2. **「New repository secret」** を押し、**Name** と **Secret** を入れて **「Add secret」**。次の分だけ繰り返します。

| Name | Secret（値） | 必須 |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | 1-1 の `sbp_…` | 必須 |
| `VERCEL_TOKEN` | 1-3 の Vercel トークン | 必須 |
| `SUPABASE_ORG_ID` | 1-2 の組織 slug | 組織が複数あるときだけ |
| `ANTHROPIC_API_KEY` | Anthropic Console で発行した `sk-ant-…` | AI（経営分析・相談・文章の下書き）を使うときだけ。取り方と料金の目安は [AI_SETUP.md](AI_SETUP.md) |

Secrets は登録後に値を見ることができません（上書きは可能）。値の末尾に改行が入らないように注意してください。

### A-2. ワークフローを実行する

1. リポジトリ上部の **「Actions」** タブを押します（初回に「Workflows aren't being run on this repository」と出たら、緑のボタンで有効化します）。
2. 左の一覧から **「本番公開（Supabase + Vercel）」** を押します。
3. 右側の **「Run workflow」** ボタン → 入力欄が開きます。

| 入力欄 | 入れる値 |
|---|---|
| `app_url` | 本番 URL。**初回は空のままで構いません**（Vercel が割り当てた URL を自動で使います）。URL が分かっている場合は `https://rootive-profit.vercel.app` のように入れます |
| `owner_email` | オーナーのメールアドレス（既定 `rootive.biz@gmail.com`） |
| `company_name` | 会社名（既定 `株式会社ROOTIVE`） |
| `skip_supabase` | `false` のまま。コードを直して **Vercel の再デプロイだけ**したいときは `true` |

4. 緑の **「Run workflow」** を押します。5〜10 分かかります（新規に Supabase を作る場合は起動待ちが加わります）。
5. 一覧に出た実行（黄色 → 緑のチェック）を押し、ジョブ **「セットアップとデプロイ」** を開きます。ログの各ステップ（Supabase セットアップ／Vercel デプロイ）を展開すると進捗が読めます。
6. 実行のトップ画面（ジョブ一覧の下）にある **Summary（公開結果）** に次が表示されます。
   - **本番 URL**（例 `https://rootive-profit.vercel.app`）
   - **Supabase プロジェクト**のダッシュボードへのリンク
   - **招待リンク**（`https://…/invite/…`）。**ブラウザで開いて「ログインして始める」を押すだけでログインできます**（有効期限 30 日・1 回のみ）

### A-3. 本番 URL が決まったら、もう一度実行する（初回に app_url を空にした場合）

初回は URL を知らずに実行するため、Supabase の **Site URL** と Vercel の **`NEXT_PUBLIC_APP_URL`** が Vercel から自動取得した値になります。通常はそれで正しく動きますが、確実にするために **Summary に出た本番 URL を `app_url` に入れて、もう一度 Run workflow** してください（Supabase は既存プロジェクトを再利用、Vercel は再デプロイ。招待リンクは有効なものがそのまま表示されます）。これで Supabase の Site URL・Redirect URLs と `NEXT_PUBLIC_APP_URL` が本番 URL に揃います。

### A-4. 自動でできないこと（手作業）

| 項目 | 何をするか |
|---|---|
| **メールの日本語テンプレート** | 無料プランで Supabase 標準メールを使っている間は、テンプレートを API から変更できません（HTTP 400。ログに「メールテンプレートは API から設定できませんでした」と警告が出ますが処理は続行します）。Supabase → **Authentication → Emails（Email Templates）** に `supabase/email-templates/*.html` を手で貼り付けます（[docs/SETUP.md](SETUP.md) 手順 5）。カスタム SMTP（SETUP.md 手順 12）を設定すると API からも変更できるようになります。招待リンク＋パスワードで運用するなら、急いで貼らなくても使えます |
| **定期アクセスの確認** | `CRON_SECRET` は自動生成されて Vercel に登録済みです。Vercel → プロジェクト `rootive-profit` → **Settings → Cron Jobs** に `/api/cron/keepalive`（毎日 6 時）と `/api/cron/daily`（毎朝 7 時：異常の検知と LINE 通知）が並び、直近の実行が **200** になっていることを確認します（`CRON_SECRET` が無いと 503 になり、Supabase の一時停止を防げません） |
| **振込データを使うなら** | 会社設定 → 「振込元（総合振込のデータに使う）」に、銀行から通知された**委託者コード**と自社の口座を登録します。各ドライバーの設定に**振込先口座**（銀行・支店・預金種目・口座番号・半角カナ名義）を入れると、支払画面の「振込データ」から全銀フォーマットのファイルを作れます |
| **決算月の確認** | 会社設定の**決算月**（既定 3 月）を自社に合わせます。財務 → 税務タブの「この年の期限をまとめて作る」で、決算・申告・納付の目安がカレンダーに入ります（正確な期限は税理士に確認してください） |
| **動作確認** | [docs/SETUP.md](SETUP.md) 手順 11 のチェックリスト |
| **カスタム SMTP** | メールを本格的に使う場合のみ（SETUP.md 手順 12。オーナーの判断事項） |

### A-5. 2 回目以降（コードを更新したとき）

- GitHub と Vercel を連携していれば、`main` に push するだけで Vercel が自動で再デプロイします。
- 連携していない場合は、同じワークフローを **`skip_supabase` = `true`** で Run workflow すると Vercel の再デプロイだけ行います。
- データベースのスキーマ（`supabase/migrations`）を更新したときは `skip_supabase` = `false`（既定）で実行します。SQL は何度適用しても安全です。

---

## 方法 B：手元のパソコンでスクリプトを実行する

### B-0. 必要なもの

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

### B-1. Supabase を準備する

リポジトリのフォルダで実行します。`export` 行の `...` を自分の値に置き換えてください。

```bash
cd ROOTIVE                                   # リポジトリのフォルダへ
export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx   # 1-1 のトークン
# export SUPABASE_ORG_ID=xxxxxxxxxxxxxxxx          # 組織が複数あるときだけ
# export APP_URL=https://rootive-profit.vercel.app # 本番 URL が分かっていれば（未定なら省略可）
# export SUPABASE_PROJECT_REF=rmchixgmeqtszqsdvxrj # 既にある本番プロジェクトを使うとき
bash scripts/setup-supabase.sh --write-env
```

処理内容（画面に進捗が出ます。新規作成時は起動待ちで 1〜3 分かかります）:

1. `rootive-profit` という名前のプロジェクトを **東京リージョン・Free プラン**で作成（同名があれば再利用。`SUPABASE_PROJECT_REF=xxxx` を渡せば既存プロジェクトを直接使用）。DB パスワードは自動生成して**画面に表示**するので控えます（`SUPABASE_DB_PASSWORD=...` で指定も可）。
2. `supabase/migrations/*.sql` を順番に適用（`setup_all.sql` と同じ内容。何度でも安全）。テーブル数・`backups` バケット・招待トリガーの存在を確認。
3. 会社「株式会社ROOTIVE」とオーナー招待（`rootive.biz@gmail.com`）を作成。有効な招待が既にあればそれを再利用し、**招待リンク**を表示。（`OWNER_EMAIL` / `COMPANY_NAME` で変更可）
4. 認証設定を更新：自由登録 OFF、Site URL / Redirect URLs（`APP_URL` 指定時）。続けて 5 種類の**日本語メールテンプレート**（`supabase/email-templates/`）と件名を設定しようとしますが、**無料プランで標準メールを使っている場合は API から変更できず（HTTP 400）、警告を出して続行**します。その場合は Supabase → Authentication → Emails に手で貼り付けてください（SETUP.md 手順 5）。
5. API キー（anon / service_role）を取得し、環境変数の形式で表示。`--write-env` を付けたので **`.env.production.local`** にも保存（Git には入りません。service_role キーを含むので他人に渡さない）。
6. 次のステップ（deploy-vercel.sh）を案内。

終了時の表示例:

```
■ オーナー招待リンク（ブラウザで開いて「ログインして始める」を押すだけでログインできます）
  <本番URL>/invite/7c3a9f…（48 文字）
  有効期限 : 2026-10-16 12:00（日本時間）／1 回のみ使用可
■ 環境変数（Vercel に設定する値）
NEXT_PUBLIC_SUPABASE_URL=https://rmchixgmeqtszqsdvxrj.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ…
SUPABASE_SERVICE_ROLE_KEY=（.env.production.local に保存済み）
...
```

`APP_URL` を省略した場合、招待リンクの `<本番URL>` 部分は次のステップで決まる URL に置き換えて使います。

### B-2. Vercel にデプロイする

```bash
export VERCEL_TOKEN=xxxxxxxxxxxxxxxx          # 1-3 のトークン（末尾に改行を入れない）
# export VERCEL_SCOPE=my-team                  # チームにデプロイするときだけ
# export ANTHROPIC_API_KEY=sk-ant-...          # AI 月次分析を使うときだけ
bash scripts/deploy-vercel.sh
```

Supabase の値（URL・anon・service_role・プロジェクト参照 ID）は `.env.production.local` から自動で読み込まれます。ファイルを作っていない場合は `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` を `export` してから実行してください。
`SUPABASE_ACCESS_TOKEN` を同じターミナルで `export` したままにしておくと、最後に Supabase の Site URL も自動更新されます。

処理内容:

1. Vercel にログインできるか確認 → プロジェクト `rootive-profit` を作成（既にあれば再利用）してこのフォルダにリンク（`.vercel/` フォルダが作られます。Git には入りません）。
2. 本番（production）の環境変数を設定：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`（秘匿）/ `NEXT_PUBLIC_APP_URL` / 任意で `ANTHROPIC_API_KEY`・`ANTHROPIC_MODEL`。**`CRON_SECRET`（必須。Supabase 一時停止防止の定期アクセス用）は未指定なら 32 文字のランダム文字列を自動生成**します。
   - 環境変数の登録は Vercel CLI ではなく **Vercel の REST API** で行います（CLI は「資格情報に見える値」を貼ると保存方法を対話で聞いてきて止まるため）。API が使えない場合だけ CLI に切り替えます。
   - `NEXT_PUBLIC_APP_URL` を指定しなかった場合は、Vercel が割り当てた本番ドメイン（`https://rootive-profit.vercel.app` など）を自動で使います。
3. `vercel --prod` で本番デプロイ（2〜4 分）。`vercel.json` により東京リージョン（`hnd1`）で動きます。
4. 本番 URL を確定。手順 2 の時点で取得できなかった場合はここで `NEXT_PUBLIC_APP_URL` を設定して自動的にもう一度デプロイします。本番 URL は Vercel の**エイリアス**（`https://rootive-profit.vercel.app`）です。デプロイごとの `rootive-profit-xxxx-….vercel.app` は使いません。
5. `SUPABASE_ACCESS_TOKEN` と `SUPABASE_PROJECT_REF` がある場合、Supabase の **Site URL** と **Redirect URLs**（`/auth/confirm`、`/auth/callback`、`/**`）を本番 URL で自動更新。無い場合は手動で設定する内容を表示します。

終了時に本番 URL が表示されます。

### B-3. ログインして動作確認

1. B-1 で表示された招待リンクの `<本番URL>` を B-2 の URL に置き換えてブラウザで開き、**「ログインして始める」** を押します。ダッシュボードが開けば成功です。
2. メールの日本語テンプレートが API から設定できなかった場合（B-1 の 4）は、Supabase → Authentication → Emails に手で貼ります（SETUP.md 手順 5）。
3. Vercel → プロジェクト → **Settings → Cron Jobs** で `/api/cron/keepalive` の実行結果が **200** であることを確認します。
4. [docs/SETUP.md](SETUP.md) の **手順 11 動作確認チェックリスト** を実施します。
5. メールを本格的に使う場合は **手順 12 カスタム SMTP** を設定します（スクリプトでは行いません。オーナーの判断事項です）。

---

## 失敗したとき・もう一度実行したいとき（方法 A・B 共通）

| 状況 | 対応 |
|---|---|
| `jq が見つかりません`（方法 B） | B-0 の表のとおりインストールして再実行 |
| `HTTP 401` | トークンが間違っている・期限切れ。1-1 / 1-3 で再発行（方法 A は Secrets を上書き） |
| `HTTP 403`／`404` | 組織 ID・プロジェクト参照 ID・チーム（scope）が違う |
| `HTTP 429` | API の回数制限。1 分待って再実行 |
| `メールテンプレートは API から設定できませんでした（HTTP 400）` | 無料プランで標準メールを使っている場合の制限。処理は続行しています。テンプレートは Supabase → Authentication → Emails に手で貼る（SETUP.md 手順 5）。カスタム SMTP を設定すると API からも設定できます |
| `Vercel にログインできません`／トークンが無効と言われる | トークンの期限切れか、貼り付け時に末尾へ改行・空白が混ざった。スクリプトは自動で除去しますが、値そのものが欠けていないか確認して再発行 |
| Vercel の環境変数の登録で止まる・対話プロンプトが出る | 通常は REST API で登録するため起きません。起きた場合は `jq` が入っているか確認（無いと CLI にフォールバックします） |
| プロジェクト作成後に SQL でエラー | 表示されたエラー文（どのファイルの何行目か）を開発担当へ。直したら**そのまま再実行**（作成済みプロジェクトは再利用され、SQL は最初から適用し直されます） |
| 再実行したら招待リンクが変わった | 前のリンクが期限切れ・使用済みだった場合だけ新しく発行されます。有効なリンクがあれば同じものが表示されます |
| DB パスワードを控え忘れた | アプリの動作には不要です。必要になったら Supabase → Project Settings → Database → **Reset database password** で再設定できます |
| Vercel のビルド失敗 | Vercel ダッシュボード → Deployments → 失敗したデプロイ → Build Logs を確認。環境変数の値（特にキーの前後の空白）を確認して再実行 |
| `/api/cron/keepalive` が 503 | `CRON_SECRET` が Vercel に無い。スクリプト／ワークフローを再実行すると自動生成されます。手で入れる場合は Vercel → Settings → Environment Variables に 32 文字以上のランダム文字列を追加して Redeploy |
| GitHub Actions が赤くなった（方法 A） | 実行を開いて赤いステップを展開し、`[エラー]` の行を探します。Secrets の名前の綴り（`SUPABASE_ACCESS_TOKEN` / `VERCEL_TOKEN`）と値を確認して Run workflow をやり直します |
| コードを更新した | 方法 A：push で自動デプロイ、または `skip_supabase` = `true` で Run workflow。方法 B：`bash scripts/deploy-vercel.sh` を再実行 |
| DB のスキーマを更新した | 方法 A：`skip_supabase` = `false` で Run workflow。方法 B：`bash scripts/setup-supabase.sh`（`SUPABASE_PROJECT_REF` を指定）を再実行。または SETUP.md 手順 2 で `setup_all.sql` を Run |
| 別の Supabase プロジェクトにやり直したい | Supabase → Project Settings → General → **Delete project** で削除し、再実行 |

作業が終わったら、`SUPABASE_ACCESS_TOKEN` と `VERCEL_TOKEN` は各サービスの画面で **Revoke（無効化）** しておくと安全です（アプリの動作には影響しません。方法 A で次回も使う場合は、再発行して Secrets を上書きします）。
