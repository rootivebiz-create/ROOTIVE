# ROOTIVE 利益管理システム

株式会社ROOTIVE（軽貨物運送・業務委託ドライバー）の社内アプリ。
月ごとに「ドライバー × 案件」の稼働（日数・個数）を入力するだけで、**会社売上・会社利益・各ドライバーへの支払額**が自動で確定します。
スマホ最優先の日本語 UI、招待制ログイン、月締め・監査ログ・バックアップ、PDF 明細・弥生会計 CSV 出力、試作アプリからのデータ移行を備えています。

- 技術：Next.js 15（App Router / Server Actions）+ Supabase（PostgreSQL・Auth・RLS・Storage）、TypeScript、Tailwind CSS
- 公開先：Vercel（東京 `hnd1`）+ Supabase（東京 `ap-northeast-1`）。どちらも無料プランで動作

## 本番環境

| 項目 | 値 |
|---|---|
| 本番 URL | <https://rootive-profit.vercel.app>（Vercel のエイリアス。デプロイごとの `rootive-profit-xxxx.vercel.app` ではなくこちらを使う） |
| Supabase | プロジェクト参照 ID `rmchixgmeqtszqsdvxrj`（東京・Free）。<https://supabase.com/dashboard/project/rmchixgmeqtszqsdvxrj> |
| Vercel | プロジェクト `rootive-profit`（東京 `hnd1`・Hobby） |
| ログイン | 招待リンク（メール不要）→ アカウント画面でパスワード設定。自由登録は不可 |

## 公開のしかた（GitHub Actions が最も簡単）

1. リポジトリの **Settings → Secrets and variables → Actions** に `SUPABASE_ACCESS_TOKEN` と `VERCEL_TOKEN` を登録（任意で `SUPABASE_ORG_ID`、`ANTHROPIC_API_KEY`）。
2. **Actions** タブ → **「本番公開（Supabase + Vercel）」** → **Run workflow**（`app_url` は初回は空でも可。URL が決まったら `app_url` を指定して再実行すると Supabase の Site URL と `NEXT_PUBLIC_APP_URL` が揃う）。
3. ジョブのサマリーに本番 URL・Supabase プロジェクト・**招待リンク**が出るので、招待リンクを開いて「ログインして始める」。
4. 手作業が残るのは「メールの日本語テンプレートの貼り付け」（無料プランの標準メールでは API から変更不可）と「Vercel → Settings → Cron Jobs で `/api/cron/keepalive` が 200 の確認」。

詳しくは [docs/QUICKSTART.md](docs/QUICKSTART.md)（方法 A：GitHub Actions／方法 B：手元のスクリプト）。ブラウザ操作だけで 1 つずつ行う手順は [docs/SETUP.md](docs/SETUP.md)。

## ドキュメント

| 読者 | ドキュメント | 内容 |
|---|---|---|
| オーナー | [docs/QUICKSTART.md](docs/QUICKSTART.md) | 自動公開。方法 A：GitHub Actions（推奨・実績あり）／方法 B：`scripts/setup-supabase.sh` → `scripts/deploy-vercel.sh`。失敗時の対応表 |
| オーナー | [docs/SETUP.md](docs/SETUP.md) | 本番公開の手順（ブラウザ操作のみ）。Supabase → Vercel → ログイン → 動作確認チェックリスト → SMTP → トラブル対応 |
| オーナー・事務担当 | [docs/OPERATIONS.md](docs/OPERATIONS.md) | 毎月の運用（複製 → 入力 → 管理費・調整 → 月締め → 明細送付 → 弥生 CSV → バックアップ）、マスタ変更、ユーザー追加、復元、移行、トラブル対応、オーナー確認事項 |
| 開発者 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 全体構成、計算式、データモデル、権限とセキュリティ、認証フロー、出力、移行、テスト、既知の制限、環境変数、公開の仕組み |
| 開発者 | [docs/E2E.md](docs/E2E.md) | ブラウザ E2E テスト（Playwright、8 spec・32 シナリオ × スマホ/PC = 64 件）の実行方法・各 spec の内容・スクリーンショット |
| 開発者 | [docs/SPEC.md](docs/SPEC.md) | 要件定義（オーナー指示書・原文） |
| 全員 | [docs/CHANGELOG.md](docs/CHANGELOG.md) | 変更履歴（ドライバー別単価・単価の反映・全員分 PDF ZIP など） |
| 開発者（AI 含む） | [CLAUDE.md](CLAUDE.md) | 実装規約・ディレクトリ・コマンド |
| — | [supabase/email-templates/README.md](supabase/email-templates/README.md) | 認証メールの日本語テンプレート（token_hash 方式・`next={{ .RedirectTo }}`） |

## 主要コマンド

```bash
npm install                 # 依存関係のインストール（Node.js 20 以上）
cp .env.example .env.local  # 環境変数を設定（Supabase の URL / キー、本番 URL）

npm run dev                 # 開発サーバー http://localhost:3000
npm run build && npm start  # 本番ビルドと起動

npm test                    # Vitest（計算ロジック §2.6 の全ケース・スキーマ・移行変換）
npm run test:sql            # SQL 結合テスト（ローカル PostgreSQL を自動起動。ビュー計算・RLS・締めガード・招待制・復元）
npm run test:e2e            # Playwright（Supabase 互換テストサーバーを自動起動。スマホ / PC の主要導線 64 件。docs/E2E.md）
npm run typecheck           # 型チェック
npm run lint                # ESLint
npm run check               # typecheck + lint + test + build:sql

npm run build:sql           # supabase/migrations/*.sql → supabase/setup_all.sql を再生成（マイグレーション変更時は必須）
node scripts/gen-db-types.mjs <postgres url> > lib/db/database.types.ts   # DB 型の再生成
npm run migrate:prototype -- <試作JSON> [--out backup.json] [--apply --db-url <url> --as <owner email>]   # 試作アプリ JSON の変換・取り込み

bash scripts/setup-supabase.sh [--write-env]   # Supabase を自動セットアップ（要 SUPABASE_ACCESS_TOKEN）
bash scripts/deploy-vercel.sh                  # Vercel へ本番デプロイ（要 VERCEL_TOKEN。CRON_SECRET は自動生成）
```

## ディレクトリ

```
app/
  (auth)/login, (auth)/invite/[token]   ログイン・招待リンク
  auth/{confirm,callback,signout}       メールリンク検証（token_hash）・PKCE・ログアウト（Origin 検証）
  (app)/dashboard                       ダッシュボード（KPI・内訳・推移・警告・AI 分析）
  (app)/entries, entries/bulk           稼働入力・一括入力
  (app)/payouts, payouts/[driverId]/statement   支払明細・個人明細
  (app)/projects                        案件別集計
  (app)/settings/{drivers,projects,rates,months,company,users,data,audit,account}   設定（rates ＝ ドライバー別単価）
  driver/*                              ドライバーポータル（本人の締め済み明細。未締め月は「集計中」）
  api/export/*                          CSV・弥生 CSV・PDF・単価表 CSV・全員分 PDF（ZIP）・バックアップ JSON
  api/cron/keepalive                    Supabase 一時停止防止（Vercel Cron、vercel.json。CRON_SECRET 必須）
components/   UI 部品（ui/）、レイアウト（layout/）、画面ごとの部品
lib/
  calc/       計算ロジック（純関数。DB ビューと同じ結果）
  actions/    Server Actions          schemas/   zod スキーマ
  auth/       セッション・ロール確認    db/        supabase-js 型・共通クエリ
  supabase/   server / admin / middleware クライアント
  statement/  明細データ組み立て        pdf/       PDF 明細      yayoi/   弥生仕訳
  exports/    CSV                       migrate/   試作 JSON 変換  ai/      AI 月次分析
supabase/
  migrations/ 0001 スキーマ … 0007 ドライバー別単価  setup_all.sql   全結合（SQL Editor に 1 回貼るだけ）
  seed/bootstrap_owner.sql  会社とオーナー招待         email-templates/  日本語メールテンプレート
scripts/      setup-supabase.sh / deploy-vercel.sh / build-setup-sql.mjs / gen-db-types.mjs / migrate-prototype.ts
.github/workflows/  deploy.yml（本番公開：Supabase + Vercel）、ci.yml
tests/        Vitest（*.test.ts）、sql/（psql 結合テスト）、e2e/（Playwright ＋ supabase-lite）
docs/         SETUP / QUICKSTART / OPERATIONS / ARCHITECTURE / E2E / SPEC、screenshots/
vercel.json   東京リージョン（hnd1）・PDF 生成の maxDuration・定期アクセス（crons）
```

## 環境変数（`.env.example`）

| 変数 | 内容 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase の Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon（publishable）キー |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role（secret）キー。サーバー専用。招待・招待リンクログイン・バックアップ保存・ユーザー管理にのみ使用 |
| `NEXT_PUBLIC_APP_URL` | 本番 URL（招待リンク・メールのリンク生成に使用）。本番は `https://rootive-profit.vercel.app` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | 任意。AI 月次分析を有効にする場合のみ（ドライバー名を含む月次集計を Anthropic API に送る） |
| `CRON_SECRET` | **必須（本番）**。Vercel Cron（`/api/cron/keepalive`、Supabase 一時停止防止）の認証。未設定だと 503 で無効。32 文字以上のランダム文字列（deploy スクリプト／GitHub Actions が自動生成） |

## ライセンス・取り扱い

社内システムです（`private: true`）。リポジトリは GitHub の Private で管理し、`service_role` キーや `.env*.local` は絶対にコミット・共有しないでください。
