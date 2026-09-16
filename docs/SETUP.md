# 本番公開の手順書（手作業版）

ROOTIVE 利益管理システムをインターネット上で使えるようにするための手順です。
すべてブラウザ上の操作で完了します（プログラミングの知識は不要）。所要時間は 40〜60 分程度です。

コマンド操作に慣れている場合は、同じ内容を自動化した [docs/QUICKSTART.md](QUICKSTART.md) の方が早く終わります。

---

## 全体像

| サービス | 役割 | 料金 |
|---|---|---|
| **GitHub** | プログラム（ソースコード）の保管場所 | 無料（Private リポジトリ） |
| **Supabase** | データベース・ログイン機能・バックアップ保存 | 無料プラン（Free）で十分 |
| **Vercel** | アプリを動かすサーバー（画面を配信） | 無料プラン（Hobby）で十分 |

```
 スマホ / PC のブラウザ
        │  https://rootive-profit.vercel.app
        ▼
 ┌──────────────┐        ┌────────────────────────┐
 │  Vercel（東京）    │ ────▶ │  Supabase（東京）             │
 │  画面・計算・PDF   │        │  データベース・ログイン・Storage │
 └──────────────┘        └────────────────────────┘
```

---

## 前提（用意するもの）

1. **メールアドレス** `rootive.biz@gmail.com`（オーナーのログイン用。3 つのサービスの登録にも使います）
2. **GitHub アカウント**（<https://github.com/signup>）と、このプログラム一式が入った **Private（非公開）リポジトリ**
   - リポジトリの作成とコードの push は開発担当が行います。Public（公開）にはしないでください。
3. **Supabase アカウント**（<https://supabase.com> → 「Start your project」→ GitHub でサインイン）
4. **Vercel アカウント**（<https://vercel.com/signup> → 「Continue with GitHub」でサインイン。GitHub と連携するとリポジトリを直接取り込めます）
5. メモ帳（パスワードやキーを一時的に控えるため。**service_role キーは他人に見せない・チャットに貼らない**）

> 用語：本書で「本番 URL」と書いたら、手順 8 で決まる `https://rootive-profit.vercel.app` のような URL のことです。

---

## 手順 1：Supabase プロジェクトを作る

1. <https://supabase.com/dashboard> を開き、緑色の **「New project」** ボタンを押します。
2. 入力欄を次のように埋めます。
   - **Organization**：自分の組織（初回は自動で作られています）
   - **Project name**：`rootive-profit`
   - **Database Password**：**「Generate a password」** を押して自動生成し、表示されたパスワードを**必ずメモ帳に控えます**（後から見られません。アプリの動作には使いませんが、データ移行 CLI や復旧時に必要になります）
   - **Region**：**Northeast Asia (Tokyo)**（`ap-northeast-1`）を選びます
   - **Pricing Plan**：Free
3. **「Create new project」** を押します。1〜3 分で準備が終わり、プロジェクトのホーム画面になります（「Setting up project」の表示が消えるまで待ちます）。
4. ブラウザのアドレスバーに `https://supabase.com/dashboard/project/xxxxxxxxxxxxxxxxxxxx` と表示されます。この `xxxx…`（20 文字の英数字）が **プロジェクト参照 ID（Project Ref）** です。メモしておくと便利です。

---

## 手順 2：データベースを作る（SQL を 1 回実行）

1. 左メニューの **「SQL Editor」**（`</>` のアイコン）を押します。
2. **「+ New query」** → **「New blank query」** を押し、空のエディタを開きます。
3. リポジトリの [`supabase/setup_all.sql`](../supabase/setup_all.sql) をテキストエディタで開き、**全文をコピー**して SQL Editor に貼り付けます（1,500 行ほどあります）。
   - GitHub 上で開いている場合は、ファイル画面右上の **「Raw」** → 全選択（Ctrl+A）→ コピー（Ctrl+C）が確実です。
4. 右下の **「Run」**（または Ctrl+Enter / Mac は Cmd+Enter）を押します。
5. 下の結果欄に **「Success. No rows returned」** と出れば完了です。
   - 赤いエラーが出た場合は、貼り付けが途中で切れていないか（最後の行が `-- =====` で終わっているか）確認し、もう一度全文を貼り直して Run します。
   - この SQL は **何度実行しても安全**です（既にあるものは作り直さず、変更点だけ反映されます）。プログラムを更新したときも同じ手順で最新の `setup_all.sql` を実行してください。

これで、テーブル・集計ビュー・アクセス制御（RLS）・監査ログ・招待制ログインの仕組み・バックアップ用の Storage バケット（`backups`）がすべて作られます。

---

## 手順 3：会社とオーナー招待を作る（招待リンクを控える）

1. SQL Editor で **「+ New query」** → **「New blank query」** を押し、もう 1 つ空のエディタを開きます。
2. リポジトリの [`supabase/seed/bootstrap_owner.sql`](../supabase/seed/bootstrap_owner.sql) を開きます。
3. **`do $$` の行から最後の行までをコピー**して貼り付けます。
   - ファイル先頭にある `\set` で始まる 3 行はターミナル用（psql 専用）の命令なので、SQL Editor には貼り付けないでください（貼るとエラーになります）。
4. 貼り付けた SQL の中の **`https://rootive.vercel.app`（2 か所）** を本番 URL に書き換えます。
   - SQL Editor 上で Ctrl+H（Mac は Cmd+Option+F）を押すと「置換」ができます。
   - 本番 URL がまだ決まっていない場合は、予定している `https://rootive-profit.vercel.app` のままで構いません。招待リンクは `<本番URL>/invite/<英数字のトークン>` という形で、**大切なのは末尾のトークン部分**です。ドメイン部分は後から読み替えられます。
   - メールアドレス（`rootive.biz@gmail.com`）と会社名（`株式会社ROOTIVE`）を変えたい場合は `v_owner_email` / `v_company_name` の値を書き換えます。
5. **「Run」** を押します。
6. 結果欄に 1 行の表が出ます。**`invite_link` 列の値**（`https://…/invite/xxxxxxxx…`）を**メモ帳に控えます**。これが最初のオーナーログイン用リンクです（有効期限 30 日、1 回のみ使用可）。
   - 表が出ずに「Success」だけの場合は、次の SQL を新しいクエリで実行すると表示されます。
     ```sql
     select 'https://rootive-profit.vercel.app/invite/' || token as invite_link, email, expires_at
       from public.invitations where accepted_at is null and cancelled_at is null
      order by created_at desc limit 1;
     ```
   - この SQL をもう一度実行すると、前の招待は取り消され**新しい招待リンク**が発行されます（古いリンクは使えなくなります）。

---

## 手順 4：ログイン設定（自由登録を禁止し、URL を登録する）

### 4-1. 自由登録を OFF にする

1. 左メニューの **「Authentication」**（人型のアイコン）を押します。
2. 左側のサブメニューから **「Sign In / Providers」**（古い画面では「Providers」）を押します。
3. 上の方にある **「User Signups」** の **「Allow new users to sign up」** のスイッチを **OFF** にします。
   - これにより、招待された人以外はアカウントを作れなくなります（アプリ側でも二重に拒否します）。
4. 同じ画面の **「Auth Providers」** の一覧で **「Email」** を押して開き、次を確認します。
   - **Enable Sign in with Email**：ON
   - **Confirm email**：どちらでも構いません（招待リンクからのログインはメール確認済みとして作られます。ON のままで問題ありません）
   - **Secure email change** / **Secure password change**：既定のままで構いません
5. 変更したら **「Save」** を押します。

### 4-2. Site URL と Redirect URLs

メールに載るリンクの行き先を登録します。本番 URL が未定の場合は、いったん予定の URL（`https://rootive-profit.vercel.app`）を入れ、手順 9 で直します。

1. Authentication のサブメニューから **「URL Configuration」** を押します。
2. **Site URL** に本番 URL（例 `https://rootive-profit.vercel.app`。末尾に `/` は付けない）を入力し、**「Save」** を押します。
3. **Redirect URLs** の **「Add URL」** を押し、次の 3 つを 1 つずつ追加して **「Save」** します。
   ```
   https://<本番URL>/auth/confirm
   https://<本番URL>/auth/callback
   https://<本番URL>/**
   ```
   （`<本番URL>` の部分は `rootive-profit.vercel.app` のようにドメインだけを入れます。例：`https://rootive-profit.vercel.app/auth/confirm`）

---

## 手順 5：メールの文面を日本語にする（テンプレート置換）

Supabase 標準のメールは英語で、しかも「送信した端末でしか開けない」形式です。次の置き換えで日本語になり、スマホで受信して PC で開いてもログインできるようになります。

1. Authentication のサブメニューから **「Emails」**（古い画面では「Email Templates」）→ **「Templates」** タブを開きます。
2. 上部のタブで各テンプレートを選び、**Subject heading**（件名）と **Message body**（本文、`<Source>` 表示）を下の表のファイルの内容で**丸ごと置き換え**、**「Save changes」** を押します。本文は「ファイルを開いて全選択 → コピー → Message body の中身を全選択 → 貼り付け」です。

| Supabase のタブ名 | ファイル（`supabase/email-templates/`） | 件名（Subject heading） |
|---|---|---|
| Magic Link | [`magic-link.html`](../supabase/email-templates/magic-link.html) | `【ROOTIVE 利益管理】ログイン用リンク` |
| Invite user | [`invite.html`](../supabase/email-templates/invite.html) | `【ROOTIVE 利益管理】招待のご案内` |
| Reset Password | [`recovery.html`](../supabase/email-templates/recovery.html) | `【ROOTIVE 利益管理】パスワード再設定` |
| Confirm sign up | [`confirmation.html`](../supabase/email-templates/confirmation.html) | `【ROOTIVE 利益管理】メールアドレスの確認` |
| Change Email Address | [`email-change.html`](../supabase/email-templates/email-change.html) | `【ROOTIVE 利益管理】メールアドレス変更の確認` |

- Reauthentication は使わないので変更不要です。
- 本文の `{{ .SiteURL }}` や `{{ .TokenHash }}` は Supabase が自動で差し込む部分です。書き換えないでください。
- 詳しくは [`supabase/email-templates/README.md`](../supabase/email-templates/README.md) を参照してください。

---

## 手順 6：API の URL とキーを控える

アプリ（Vercel）が Supabase に接続するための 3 つの値を取得します。

1. 左メニュー一番下の **「Project Settings」**（歯車アイコン）を押します。
2. **「Data API」**（古い画面では「API」）を開き、**Project URL**（`https://xxxxxxxxxxxxxxxxxxxx.supabase.co`）をメモ帳にコピーします。
   → これが **`NEXT_PUBLIC_SUPABASE_URL`** です。
3. **「API Keys」** を開きます。
   - **「Legacy anon, service_role」** タブ（または一覧）にある **`anon` `public`** のキー（`eyJ…` で始まる長い文字列）を **「Copy」** でコピーします。
     → これが **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** です（ブラウザに渡っても安全なキーです）。
   - 同じ画面の **`service_role` `secret`** のキーを **「Reveal」** → **「Copy」** でコピーします。
     → これが **`SUPABASE_SERVICE_ROLE_KEY`** です。
   - 画面に「Publishable key / Secret keys」しか無い場合は、Publishable key（`sb_publishable_…`）を `NEXT_PUBLIC_SUPABASE_ANON_KEY` に、Secret key（`sb_secret_…`）を `SUPABASE_SERVICE_ROLE_KEY` に使います。

> **service_role キーは「データベースの全権限」です。** ブラウザに埋め込んだり、LINE・メール・チャットに貼ったり、GitHub に置いたりしないでください。Vercel の環境変数（手順 8）にだけ入れます。漏れた疑いがあるときは API Keys 画面の「Generate new key」/「Roll」で作り直し、Vercel の値も更新します。

---

## 手順 7：Storage（バックアップ保存先）の確認

手順 2 の SQL で自動作成されているので、確認だけします。

1. 左メニューの **「Storage」** を押します。
2. バケット一覧に **`backups`** があり、鍵マーク（Private）になっていれば OK です。
3. もし無い場合だけ、**「New bucket」** → Name `backups`、**Public bucket は OFF** → **「Save」** で作ります。

月締めをすると、ここに `会社ID/2026-09_日時.json` のようなバックアップが自動保存されます。

---

## 手順 8：Vercel にデプロイする

1. <https://vercel.com/dashboard> を開き、右上の **「Add New…」** → **「Project」** を押します。
2. **「Import Git Repository」** の一覧から、このプログラムの GitHub リポジトリ（例 `rootive-profit`）の **「Import」** を押します。
   - 一覧に出ない場合は「Adjust GitHub App Permissions」からリポジトリへのアクセスを許可します。
3. 設定画面で次を確認・入力します。
   - **Project Name**：`rootive-profit`（この名前が URL になります：`https://rootive-profit.vercel.app`。他の人が使っていると `rootive-profit-xxxx` のように変わります）
   - **Framework Preset**：**Next.js**（自動で選ばれます）
   - **Root Directory**：`./`（そのまま）
   - **Build and Output Settings**：変更不要
   - **Environment Variables**：**「Add」** を押して、次の項目を 1 つずつ **Key** と **Value** に入力します（Environment は Production / Preview / Development すべてにチェックのままで構いません）。

   | Key | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | 手順 6 の Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 手順 6 の anon キー |
   | `SUPABASE_SERVICE_ROLE_KEY` | 手順 6 の service_role キー |
   | `NEXT_PUBLIC_APP_URL` | 本番 URL（例 `https://rootive-profit.vercel.app`。まだ不明ならこの予定値。手順 9 で直します） |
   | `ANTHROPIC_API_KEY` | （任意）AI 月次分析を使う場合のみ。Anthropic Console で発行した `sk-ant-…` |
   | `ANTHROPIC_MODEL` | （任意）AI のモデル名を指定したい場合のみ。未設定なら既定のモデル |
   | `CRON_SECRET` | （任意・推奨）定期アクセス（下の補足）を第三者が呼べないようにする合言葉。英数字 32 文字程度の適当な文字列（例：パスワード生成ツールで作る） |

4. **「Deploy」** を押します。2〜4 分でビルドが終わり、「Congratulations!」の画面になります。
5. **「Continue to Dashboard」** を押すと、**Domains** に本番 URL（`rootive-profit.vercel.app`）が表示されます。これを控えます。

補足：

- サーバーの場所は、リポジトリ内の [`vercel.json`](../vercel.json) の `"regions": ["hnd1"]` により **東京** になります（Supabase も東京なので速く動きます）。PDF 生成の処理時間の上限（30 秒）も同じファイルで設定済みです。
- 同じ `vercel.json` の `crons` により、毎日 6 時（日本時間）に `/api/cron/keepalive` が自動で呼ばれ、Supabase 無料プランの「7 日間アクセスが無いと一時停止」を防ぎます（Project → Settings → Cron Jobs で確認できます）。
- 以後、GitHub のリポジトリにコードが push されると Vercel が自動で再デプロイします。
- 環境変数を後から変えるには、Vercel の Project → **「Settings」** → **「Environment Variables」** で編集し、**「Deployments」** タブ → 最新のデプロイの **「…」** → **「Redeploy」** を押します（環境変数の変更は再デプロイしないと反映されません）。

---

## 手順 9：本番 URL が決まったら URL 設定を合わせる

手順 8 で表示された本番 URL が、手順 3・4・8 で入れた予定値と**違う場合**（例 `rootive-profit-abc123.vercel.app` になった）は、次の 3 か所を直します。同じなら何もしなくて構いません。

1. **Supabase → Authentication → URL Configuration**：Site URL を本番 URL に変更し、Redirect URLs の 3 つ（`/auth/confirm`、`/auth/callback`、`/**`）も本番 URL のものを追加 → Save。
2. **Vercel → Settings → Environment Variables**：`NEXT_PUBLIC_APP_URL` を本番 URL に変更 → Save → **Deployments → 最新 → … → Redeploy**。
3. 手順 3 で控えた招待リンクは、ドメイン部分を本番 URL に読み替えて使います（`https://<本番URL>/invite/<トークン>`。トークン部分はそのまま）。

---

## 手順 10：オーナーとしてログインする

1. 手順 3 で控えた招待リンク（`https://<本番URL>/invite/<トークン>`）をスマホか PC のブラウザで開きます。
2. 「株式会社ROOTIVE への招待」画面に、メールアドレスと権限（オーナー）が表示されます。
3. **「ログインして始める」** を押します。メールは届きません。数秒でログインが完了し、**ダッシュボード**が開きます。
4. 右上のユーザーアイコン → **「アカウント」** で表示名の変更と、**パスワードの設定**ができます。パスワードを設定すると、次回からログイン画面の「パスワード」タブでメール＋パスワードでも入れます（設定しなくても「メールでログイン」タブでログイン用リンクを受け取れます。ただしメールが届くにはメール送信の設定 = 手順 12 が必要です）。
5. スマホでは、ブラウザのメニューから **「ホーム画面に追加」** をするとアプリのように起動できます。

初期データ（ドライバー 10 名・案件 7 件・2026 年 9 月の稼働）を入れたい場合は、ログイン後に **設定 → データ** の「初期データを投入」を使うか、試作アプリの JSON を取り込みます（[docs/OPERATIONS.md](OPERATIONS.md) 参照）。

---

## 手順 11：動作確認チェックリスト

公開直後に、次を順番に確認してください（仕様書 §10-5 の受け入れ確認です）。

| # | 確認内容 | 操作 | 期待する結果 |
|---|---|---|---|
| 1 | ダッシュボード表示 | ログイン直後、または下タブ「ホーム」 | 会社売上・会社利益・支払合計・利益率の 4 つの数字と、ドライバー別の表が出る（データが無ければ 0 と「まだデータがありません」） |
| 2 | マスタ登録 | 設定 → ドライバー →「追加」、設定 → 案件・単価 →「追加」 | 保存できて一覧に出る。同じ名前を 2 回登録するとエラーになる |
| 3 | 稼働の追加 | 下タブ「稼働」→「＋ 稼働を追加」→ ドライバー・案件・数量を入れる | 受注単価・支払単価・率が自動で入り、下のプレビューに会社売上・ロイヤリティ・行の利益が即時表示される。保存後に一覧と合計が更新される |
| 4 | 支払明細 | 下タブ「支払」→ ドライバーを選ぶ | 稼働 × 単価、ロイヤリティ、管理費、調整、支払額、振込予定日（翌月末）が出る |
| 5 | PDF・テキスト | 支払明細の「PDF」「テキストをコピー」 | 日本語の A4 PDF がダウンロードされる。テキストに会社利益が含まれていない |
| 6 | 月締め | 設定 → 月締め → 対象月の「この月を締める」 | 状態が「締め済み」になり、稼働画面の編集ボタンが消える。「締め時バックアップのダウンロード」で JSON が落とせる |
| 7 | 締め解除 | 同じ画面の「締めを解除」（オーナーのみ） | 再び編集できる |
| 8 | 閲覧者の編集不可 | 設定 → ユーザー管理で自分の別メールを「閲覧者」として招待し、そのユーザーでログイン | 稼働・設定の編集ボタンが無い。URL を直接叩いても「権限がありません」 |
| 9 | ドライバーポータル | ドライバー本人のメールを「ドライバー」ロール（対応ドライバーを選択）で招待し、そのリンクでログイン | 締め済み月の自分の明細だけが見える。他の人や会社利益は見えない |
| 10 | 試作 JSON の取り込み | 設定 → データ → 取り込み → 試作アプリの JSON を選ぶ | プレビューの月別合計（売上・利益・支払）が試作アプリの数字と一致し、取り込み後のダッシュボードも一致する |
| 11 | 監査ログ | 設定 → 監査ログ | 上の操作が「誰が・いつ・何を」の形で並ぶ |

---

## 手順 12：メール送信の設定（カスタム SMTP）

### 設定しない場合の制限

Supabase 標準のメール送信は**開発用**で、**1 時間に数通（現在 2 通）**しか送れず、届きにくい（迷惑メール判定されやすい）ため本番利用は推奨されていません。

とはいえ、本システムは **招待リンク（メール不要）** でログインでき、パスワードを設定すれば以後もメール無しでログインできます。そのため、次の運用なら SMTP を設定しなくても使えます。

- 新しいユーザーには、設定 → ユーザー管理で発行される**招待リンクを LINE で送る**
- 各自が「アカウント」画面で**パスワードを設定**しておく

「メールでログイン」（マジックリンク）やパスワード再設定メールをきちんと届けたい場合は、以下のカスタム SMTP を設定してください。

### Resend を使う場合（無料枠：月 3,000 通・1 日 100 通）

1. <https://resend.com> でアカウントを作成します（GitHub でサインイン可）。
2. **送信元ドメインの認証**：左メニュー **「Domains」** → **「Add Domain」** → 会社のドメイン（例 `rootive.co.jp`。サブドメイン `mail.rootive.co.jp` でも可）を入力 → 表示された DNS レコード（TXT / MX、DKIM・SPF 用）をドメイン管理会社（お名前.com、ムームードメイン等）の DNS 設定に追加 → Resend 画面で **「Verify」** を押し「Verified」になるのを待ちます（最大 1 日）。
   - 独自ドメインが無い場合、Resend は自分宛のテスト送信しかできません。独自ドメインの取得（年 1,000〜2,000 円程度）が必要です。§12 未決事項 3 のとおり、オーナーの判断事項です。
3. **API キー**：左メニュー **「API Keys」** → **「Create API Key」** → 名前 `supabase`、Permission は **Sending access** → 作成 → 表示されたキー（`re_…`）を控えます（1 回しか表示されません）。
4. **Supabase 側の設定**：Supabase → **Authentication → Emails → 「SMTP Settings」** タブ（古い画面では Project Settings → Authentication → SMTP Settings）。
   - **Enable Custom SMTP**：ON
   - **Sender email**：`noreply@<認証したドメイン>`（例 `noreply@rootive.co.jp`）
   - **Sender name**：`ROOTIVE 利益管理`
   - **Host**：`smtp.resend.com`
   - **Port number**：`465`（つながらない場合は `587`）
   - **Username**：`resend`
   - **Password**：手順 3 の API キー
   - **「Save」** を押します。
5. **送信回数の上限を上げる**：Authentication → **「Rate Limits」** → **Rate limit for sending emails** を `30`（1 時間あたり）程度に上げて Save。
6. **テスト**：アプリのログイン画面の「メールでログイン」で自分のメールアドレスを入れ、日本語のメールが届き、リンクでログインできることを確認します。

SendGrid・Amazon SES・Gmail（Google Workspace）でも同様に設定できます（Host / Port / Username / Password をそれぞれのサービスの値にする）。

---

## 手順 13：よくあるトラブルと対処

| 症状 | 原因 | 対処 |
|---|---|---|
| 招待リンクを開くと「招待リンクの有効期限が切れています」 | 招待は 7 日（最初のオーナー招待は 30 日）で失効 | オーナー：手順 3 の SQL をもう一度実行して新しいリンクを発行。他のユーザー：設定 → ユーザー管理 → 該当ユーザーの「再送」で新しいリンクを発行して LINE で送る |
| 「この招待リンクは既に使用されています」 | 招待リンクは 1 回限り | ログイン画面から「メールでログイン」か「パスワード」でログイン。メールが届かない・パスワード未設定なら、オーナーが「再送」で新しいリンクを発行 |
| 「サーバーの設定（SUPABASE_SERVICE_ROLE_KEY）が不足しています」 | Vercel の環境変数が未設定・誤り | Vercel → Settings → Environment Variables で `SUPABASE_SERVICE_ROLE_KEY` を確認 → Redeploy |
| ログイン用メールが届かない | 標準メールは 1 時間 2 通まで／迷惑メール判定／SMTP 未設定 | 迷惑メールフォルダを確認。1 時間待つ。恒久対策は手順 12 の SMTP 設定。急ぎなら招待リンク（メール不要）を使う |
| メールのリンクを開くと「リンクの有効期限が切れているか、無効です」 | リンクは 1 回限り・約 1 時間で失効／Site URL が間違っている | ログイン画面からやり直す。Supabase の Site URL と Redirect URLs（手順 4-2・9）が本番 URL になっているか確認。テンプレートが手順 5 の内容になっているか確認 |
| 「招待が必要です」「このメールアドレスは招待されていません」 | 招待されていないメールアドレスでログインしようとした／招待のメールアドレスと 1 文字違う／招待が取消・期限切れ | 設定 → ユーザー管理で招待のメールアドレスを確認（大文字小文字は区別しませんが、スペルは正確に）。必要なら再招待 |
| 画面に「この操作を行う権限がありません（RLS）」 | 権限の無いロール（閲覧者・ドライバー）で操作した／ユーザーが無効化されている／手順 2 の SQL が途中で失敗している | オーナーがユーザー管理でロールと状態を確認。SQL Editor で `setup_all.sql` をもう一度 Run（安全） |
| ログインしても真っ白・「データベースエラー」 | 手順 2 の SQL が未実行、または URL / anon キーの取り違え | Supabase の Table Editor に `companies` などのテーブルがあるか確認。Vercel の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` を確認して Redeploy |
| Supabase に「Project is paused」と表示される／急に動かなくなった | 無料プランは 7 日間アクセスが無いと一時停止する | Supabase ダッシュボード → 該当プロジェクト → **「Restore project」** を押して数分待つ。`vercel.json` の定期アクセス（毎日 6 時）が動いていれば通常は起きません |
| Vercel のビルドが失敗する（Deployments が赤い） | 環境変数の入力ミス／Node.js のバージョン | Deployments → 失敗したデプロイ → **Build Logs** の赤い行を確認。Settings → General → **Node.js Version** を 20.x 以上にする。環境変数を直したら Redeploy |
| 「Redirect URL が許可されていません」系のエラー | Redirect URLs に本番 URL が無い | 手順 4-2 の 3 つの URL を追加 |
| PDF が出ない／タイムアウト | 生成に時間がかかる（大量の稼働行） | 30 秒以内なら待つ。続く場合は開発担当へ連絡（`vercel.json` の `maxDuration` を確認） |
| 招待メールを送ったのに届かず、リンクも渡していない | Supabase 標準メールの制限 | 設定 → ユーザー管理でユーザーの「招待リンクを表示」から LINE 等で直接送る |
| 数字が合わない | 単価・率・端数処理・管理費の条件 | [docs/OPERATIONS.md](OPERATIONS.md) の「数字が合わない時のチェック順」 |

困ったときは、Supabase の **Logs**（左メニュー → Logs → Auth / Postgres）と Vercel の **Logs**（Project → Logs）にエラーの詳細が出ます。開発担当に連絡するときは、そのエラーメッセージと操作した時刻を添えてください。

---

## 参考

- 自動化スクリプト版：[docs/QUICKSTART.md](QUICKSTART.md)
- 毎月の運用：[docs/OPERATIONS.md](OPERATIONS.md)
- 仕組みの説明：[docs/ARCHITECTURE.md](ARCHITECTURE.md)
- 仕様書：[docs/SPEC.md](SPEC.md)
