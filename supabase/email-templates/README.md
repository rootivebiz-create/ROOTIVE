# Supabase 認証メールのテンプレート（日本語・token_hash 方式）

Supabase の標準メールは英語で、リンクが「送信した端末でしか開けない」方式（PKCE）になっています。
このフォルダの HTML に置き換えると、日本語になり、リンクを **別の端末（スマホで受信して PC で開く等）で開いても** ログインできるようになります。

## ファイルと貼り付け先

Supabase ダッシュボード → 左メニュー **Authentication** → **Emails**（古い画面では **Email Templates**）→ **Templates** タブ。
各テンプレートを開き、**Subject heading**（件名）と **Message body**（本文。`<Source>` 表示）を下の表のとおり置き換えて **Save changes** を押します。

| Supabase のテンプレート名 | ファイル | 推奨する件名（Subject） | リンクの type |
|---|---|---|---|
| Magic Link | `magic-link.html` | `【ROOTIVE 利益管理】ログイン用リンク` | `magiclink` |
| Invite user | `invite.html` | `【ROOTIVE 利益管理】招待のご案内` | `invite` |
| Reset Password | `recovery.html` | `【ROOTIVE 利益管理】パスワード再設定` | `recovery` |
| Confirm sign up | `confirmation.html` | `【ROOTIVE 利益管理】メールアドレスの確認` | `signup`（`email` でも可） |
| Change Email Address | `email-change.html` | `【ROOTIVE 利益管理】メールアドレス変更の確認` | `email_change` |

- Reauthentication（再認証）テンプレートは使用しないので変更不要です。
- `scripts/setup-supabase.sh`（GitHub Actions の「本番公開」も同じ）は、このフォルダの内容を Management API 経由で設定しようとします。**ただし無料プランで Supabase 標準メールを使っている間は API から変更できず（HTTP 400）、警告を出して続行します。** その場合は上の手順で手で貼り付けてください。カスタム SMTP（`docs/SETUP.md` 手順 12）を設定すると API からも変更できるようになります。
- 招待リンク（`/invite/<token>`）＋パスワードで運用する（メールを使わない）なら、貼り付けは後回しでも困りません。

## リンクの形式

すべてのリンクは次の形式です。

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<種別>&next={{ .RedirectTo }}
```

| 差し込み変数 | 内容 |
|---|---|
| `{{ .SiteURL }}` | Authentication → URL Configuration の **Site URL**（本番 URL `https://rootive-profit.vercel.app`） |
| `{{ .TokenHash }}` | Supabase が発行するワンタイムトークン（1 回限り・約 1 時間） |
| `{{ .RedirectTo }}` | **アプリが指定した「ログイン後の遷移先」**（`signInWithOtp` の `emailRedirectTo`、`resetPasswordForEmail` の `redirectTo`、招待メールの `redirectTo`）。Redirect URLs に `<本番URL>/**` が登録されている必要があります |

アプリ側の `app/auth/confirm/route.ts` がこの URL を受け取り、`verifyOtp({ type, token_hash })` で検証してログイン状態にしたあと、`next` へ移動します。

- **ログイン用リンク**：ログイン前に開こうとしていた画面（`/login?next=…` の `next`）へ戻ります。指定が無ければ `/dashboard`。
- **パスワード再設定**：`/settings/account?reset=1`（「アカウント」画面。パスワード欄が強調表示されます）。
- **ドライバー**（driver ロール）：どの遷移先が指定されていても自動でドライバーポータル（`/driver`。アカウント系なら `/driver/account`）へ移動します。スタッフ画面は開けません。
- `next` は **サイト内のパス、または同一ホストの絶対 URL** だけを受け付けます（`resolveNext()`）。外部サイトや `//` で始まる値はトップ（`/`）に置き換えられるので、メール内リンクを改ざんして外部へ飛ばすことはできません。

## 注意

- Site URL が本番 URL（`https://rootive-profit.vercel.app`）になっていないと、メール内のリンクが間違った場所を指します。Vercel の本番 URL が決まったら必ず更新してください（`docs/SETUP.md` 手順 4-2・9。自動公開では `scripts/deploy-vercel.sh` が更新します）。
- Redirect URLs に `https://rootive-profit.vercel.app/auth/confirm`、`.../auth/callback`、`.../**` の 3 つが必要です（`{{ .RedirectTo }}` の値が許可リストに無いと Supabase がリンクを拒否します）。
- 本文の `{{ ... }}` は Supabase の差し込み変数です。書き換えないでください（`&next={{ .RedirectTo }}` も消さないでください）。
- 会社名や文面は自由に変更して構いません（HTML の中の文章部分だけを編集）。
