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
- `scripts/setup-supabase.sh` を使う場合は、このフォルダの内容が Management API 経由で自動的に設定されます（件名も上の表のとおり）。

## リンクの形式

すべてのリンクは次の形式です（`{{ .SiteURL }}` は Authentication → URL Configuration の **Site URL**、`{{ .TokenHash }}` は Supabase が差し込むワンタイムトークン）。

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<種別>
```

アプリ側の `app/auth/confirm/route.ts` がこの URL を受け取り、`verifyOtp({ type, token_hash })` で検証してログイン状態にします。
パスワード再設定だけは `&next=/settings/account?reset=1` を付けて、ログイン後に「アカウント」画面へ移動させています。

## 注意

- Site URL が本番 URL（例 `https://rootive-profit.vercel.app`）になっていないと、メール内のリンクが間違った場所を指します。Vercel の本番 URL が決まったら必ず更新してください（`docs/SETUP.md` 手順 9）。
- 本文の `{{ ... }}` は Supabase の差し込み変数です。書き換えないでください。
- 会社名や文面は自由に変更して構いません（HTML の中の文章部分だけを編集）。
