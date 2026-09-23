# システム構成と設計（ARCHITECTURE）

ROOTIVE 利益管理システムの仕組みを、開発者・引き継ぎ担当者向けにまとめたものです。仕様の原文は [docs/SPEC.md](SPEC.md)、実装規約は [CLAUDE.md](../CLAUDE.md) を参照してください。

---

## 1. 全体構成

```
┌──────────────────────────────────────────────────────────────────────┐
│ ブラウザ（iPhone / Android / PC）  PWA（ホーム画面追加）・ダークモード             │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTPS（セキュリティヘッダー：HSTS / X-Frame-Options DENY など）
┌───────────────▼──────────────────────────────────────────────────────┐
│ Vercel（東京 hnd1）  Next.js 15  App Router / Server Components / Server Actions │
│                                                                      │
│  app/(auth)/login, invite/[token]     ログイン・招待リンク                     │
│  app/auth/{confirm,callback,signout}  メールリンク検証（token_hash）・PKCE・ログアウト │
│  app/(app)/*                          スタッフ画面（owner / admin / viewer）        │
│  app/driver/*                         ドライバーポータル（driver）               │
│  app/api/export/*                     CSV / Excel / PDF / 全銀振込 / 月次パック ZIP    │
│  app/api/cron/keepalive               Vercel Cron（毎日）→ Supabase 一時停止の防止     │
│  app/api/cron/daily                   Vercel Cron（毎朝 7 時）→ 異常の検知と LINE 通知   │
│  app/api/cron/weekly                  Vercel Cron（毎週月曜 8 時）→ 週次の経営サマリー   │
│  app/api/version                      いま配っている版（画面が比べて更新を知らせる）      │
│  app/api/nav-badges                   未読・未対応の件数（ベルが定期的に見に行く）        │
│  middleware.ts                        セッション Cookie 更新・未ログインを /login へ   │
│                                                                      │
│  lib/calc        計算（純関数・BigInt で誤差なし）  lib/actions  Server Actions        │
│  lib/auth        セッション・ロール確認          lib/schemas  zod スキーマ           │
│  lib/statement   明細データ組み立て            lib/pdf      @react-pdf/renderer     │
│  lib/yayoi       弥生仕訳 CSV                 lib/migrate  試作 JSON 変換（uuid v5） │
│  lib/exports     CSV / xlsx / 全銀 / ZIP        lib/finance  予実・返済・期限（純関数）  │
│  lib/kpi         経営指標の判定と助言           lib/alerts   異常の表示                 │
│  lib/voice       声で入力（解析は純関数）         lib/line     LINE の質問への回答         │
│  lib/push        通知（宛先と文面は純関数・送信は web-push）                                │
│  lib/supabase    server（RLS 適用）/ admin（service_role、サーバー専用）             │
└───────────────┬──────────────────────────────────────────────────────┘
                │ supabase-js（anon キー + ユーザー JWT → RLS 適用）
                │ service_role キー（招待・招待リンクログイン・バックアップ保存・ユーザー管理のみ）
┌───────────────▼──────────────────────────────────────────────────────┐
│ Supabase（東京 ap-northeast-1）                                            │
│  PostgreSQL  テーブル / 集計ビュー v_* / RPC / トリガー（締めガード・監査・招待制）     │
│  Auth        メール + マジックリンク / パスワード、招待制（auth.users INSERT トリガー）│
│  Storage     backups / company-assets / receipts / contracts（すべて非公開）           │
└──────────────────────────────────────────────────────────────────────┘
        任意：Anthropic API（ANTHROPIC_API_KEY 設定時のみ AI 月次分析）
```

技術スタック：Next.js 15・TypeScript・Tailwind CSS 4・shadcn/ui 相当の部品・zod 4・supabase-js / @supabase/ssr・@react-pdf/renderer（Noto Sans JP 同梱）・iconv-lite（Shift_JIS）・Recharts・Vitest・Playwright。

---

## 2. 計算仕様（§2）

すべて円。内部は小数を許容し、表示時に整数へ四捨五入（負数は 0 から遠い方向）。CSV は生の値。

### 2-1. 稼働行（`lib/calc/entry.ts` / `v_work_entry_calc`）

```
qty           数量（日数 or 個数、0 以上、小数可）
bill        = bill_rate × qty                      会社売上
pay         = pay_rate  × qty                      ドライバー売上
margin      = bill − pay                           単価差額利益
royalty     = ROUND_MODE(pay × royalty_rate)       ロイヤリティ額
entry_profit= margin + royalty                     行の会社利益
ROUND_MODE  = none（丸めない・既定）| floor | round（四捨五入）| ceil
```

`lib/calc/money.ts` は金額・数量を 1e4 倍、率との積を 1e8 倍の BigInt で計算し、浮動小数の誤差を排除します。DB ビューは numeric で同じ結果を返し、`npm test`（§2.6 の全ケース）と `npm run test:sql` の両方で一致を検証します。

### 2-2. ドライバー × 月（`lib/calc/month.ts` / `v_driver_month_summary`）

```
mgmt_fee     = driver_months.mgmt_fee   ただし数量 > 0 の稼働行が 1 件以上ある月のみ。無ければ 0
adj_pay      = Σ adjustments.amount                     符号付き（控除はマイナス）
adj_profit   = Σ (count_as_profit ? −amount : 0)        利益計上にチェックした分だけ
payout       = Σpay − Σroyalty − mgmt_fee + adj_pay      支払額
driver_profit= Σmargin + Σroyalty + mgmt_fee + adj_profit
恒等式        Σbill = payout + driver_profit             利益計上なしの調整がある分だけ崩れる
```

### 2-3. 会社 × 月（`calcCompanyMonth` / `v_month_summary`）

全ドライバー × 月の合計。`profit_rate = profit ÷ bill`（bill = 0 なら 0）。

### 2-4. 案件別（`v_project_summary`）

稼働行の合計のみ（管理費・調整は含めない）。

### 2-5. マスタからの自動入力（`resolveEntryDefaults` / RPC `entry_defaults`）

| 項目 | 優先順 |
|---|---|
| 受注単価 | driver_pay_overrides.bill_rate（ドライバー別単価）→ 案件内容.bill_rate |
| 支払単価 | driver_pay_overrides.pay_rate（ドライバー別単価）→ 案件内容.pay_rate |
| ロイヤリティ率 | drivers.royalty_rate → companies.default_royalty_rate |
| 端数処理 | drivers.rounding_mode → companies.rounding_mode |
| 管理費 | driver_months.mgmt_fee（初回作成時に drivers.mgmt_fee を複写） |

保存後は稼働行の値（スナップショット）が正となり、マスタ変更の影響を受けません。
マスタを変えた後に未締め月の行を追従させたいときは、RPC `rate_diffs(month)`（スナップショットと現在のマスタが異なる行の一覧）と `apply_master_rates(month, driver_id?, project_item_id?, entry_ids?)`（該当行の単価・率・端数処理を現在のマスタの値に更新）を使います（稼働入力の「マスタの値に更新」、設定 → ドライバー別単価の「稼働に反映」、ダッシュボードの警告）。

---

## 3. データモデル（`supabase/migrations/0001_schema.sql`）

主キー uuid、全テーブルに `company_id`（RLS で分離。将来の多社対応）。金額 numeric(12,2)、率 numeric(6,4)（0.1 = 10%）、時刻 timestamptz、稼動月は月初日の date。

| テーブル | 主要列 | 備考 |
|---|---|---|
| `companies` | name, rounding_mode, default_royalty_rate, default_mgmt_fee, payout_month_offset(0..3), payout_day(0=末日), statement_note, invoice_reg_no, address, tel, driver_portal_show_royalty, yayoi_accounts(jsonb) | 会社設定 |
| `profiles` | id(=auth.users.id), company_id, email, display_name, role, driver_id, is_active | auth.users と 1:1。driver ロールは driver_id 必須 |
| `invitations` | email, role, driver_id, display_name, token(unique), expires_at(既定 7 日), accepted_at, cancelled_at, link_used_at, invited_by | 招待。token は 24 バイト乱数 hex |
| `drivers` | name(会社内 unique), kana, is_active, royalty_rate(null=会社既定), mgmt_fee, rounding_mode(null=会社既定), phone, email, bank_info, memo, sort_order, tax_mode(taxable/exempt), invoice_reg_no, payout_month_offset(null=会社既定), payout_day(null=会社既定) | 課税区分・登録番号・支払日は `0008` |
| `projects` | name(unique), client_name, is_active, memo, sort_order | 案件 |
| `project_items` | project_id(restrict), name(既定「標準」, project 内 unique), unit(day/piece), bill_rate, pay_rate, is_active, sort_order | 内容（単価区分） |
| `driver_pay_overrides` | pk(driver_id, project_item_id), bill_rate(null=標準), pay_rate(null=標準)、どちらか必須 | ドライバー別単価（案件内容ごとの受注単価・支払単価の上書き。`0007` で bill_rate 追加） |
| `driver_recurring_adjustments` | driver_id, label, amount, count_as_profit, is_active, sort_order | 固定控除（毎月自動複写） |
| `work_entries` | month, driver_id(restrict), project_item_id(restrict), qty≥0, bill_rate, pay_rate, royalty_rate(0..1), rounding_mode, memo, created_by, updated_by | 稼働行。index (company_id,month) (driver_id,month) (project_item_id,month) |
| `driver_months` | month, driver_id, mgmt_fee, memo, tax_rate/tax_rounding/tax_mode(締め時に固定。未締めは null), unique(company_id,month,driver_id) | ドライバー × 月 |
| `adjustments` | driver_month_id(cascade), label, amount(符号付き), count_as_profit, recurring_id, sort_order | 調整 |
| `month_closings` | pk(company_id,month), status(open/closed), closed_at/by, reopened_at/by, snapshot(jsonb), backup_path, note | 月締め |
| `audit_logs` | actor_id, action, table_name, record_id, before, after, created_at | 監査。書き込みはトリガーのみ |
| `ai_insights` | month, model, kind, summary, findings(jsonb), actions(jsonb), created_by | AI 月次分析の保存（`0011` で総括と改善策を追加） |
| `clients` | name(会社内 unique), honorific, address, tel, invoice_reg_no, payment_month_offset(0..3), payment_day(0=末日), memo, is_active, sort_order | 取引先（`0009`）。`projects.client_id` から参照 |
| `expense_categories` | name(会社内 unique), kind(fixed/variable), memo, is_active, sort_order | 経費カテゴリ（`0009`）。会社作成時に既定 12 件を自動投入 |
| `recurring_expenses` | category_id, label, amount, tax_mode, driver_id, project_id, vendor, start_month, end_month, is_active, sort_order | 毎月かかる経費のテンプレ（`0009`） |
| `expenses` | month, category_id, label, amount(税抜・符号付き), tax_mode, incurred_on, driver_id, project_id, vendor, memo, recurring_id, created_by, updated_by | 経費（`0009`）。締め済み月は変更不可 |
| `invoices` | client_id, month, invoice_no(会社内 unique), status(draft/issued/paid), issue_date, due_date, subtotal, tax_rate, tax_rounding, tax, total, paid_on, note, created_by, unique(company_id,client_id,month) | 請求書（`0009`）。合計はトリガーが再計算 |
| `invoice_items` | invoice_id(cascade), project_id, project_item_id, name, unit, qty, unit_price, amount(自動計算), sort_order | 請求明細（`0009`） |
| `month_targets` | pk(company_id,month), bill_target, profit_target, memo | 月次目標（`0009`） |
| `cash_snapshots` | as_of(会社内 unique), balance, memo, created_by | 資金繰りの起点になる現金残高（`0010`） |
| `ai_conversations` | title, month, message_count, last_message_at, created_by | AI 相談の会話（`0011`）。スタッフ全員が閲覧できる |
| `ai_messages` | conversation_id(cascade), role(user/assistant), content, model, created_by | AI 相談の発言（`0011`）。件数と最終時刻はトリガーが更新 |
| `chat_channels` | name(会社内 unique), description, is_default, is_active, sort_order | 社内チャットのルーム（`0011`）。会社作成時に「全体」「経営」を自動投入 |
| `chat_messages` | channel_id(cascade), author_id, body(1..4000), mentions(jsonb), author_name/author_role(トリガーが写す), edited_at | 社内チャットの発言（`0011`） |
| `chat_reads` | pk(channel_id, profile_id), last_read_at | どこまで読んだか（`0011`）。未読件数の計算に使う |
| `alerts` | month, code, severity(high/medium/low), title, detail, amount, ref_table/ref_id/href, status(open/resolved/ignored), fingerprint(会社内 unique), detected_at, resolved_at/by, note | 異常の検知（`0011`） |
| `integrations` | pk(company_id, kind: line/google_drive/bank), is_enabled, config(jsonb), status, last_ok_at, last_error | 外部連携の設定（`0011`。機密は含まない） |
| `integration_secrets` | pk(company_id, kind), secrets(jsonb) | **RLS ポリシー無し＝サービスロール専用**（`0011`）。アクセストークン等 |
| `integration_logs` | kind, action, status(ok/error), message, detail(jsonb) | 外部連携の実行記録（`0011`） |
| `line_link_codes` | code(pk, 8 桁), driver_id / profile_id, expires_at(30 分), used_at | LINE 連携の合言葉（`0011`） |
| `bank_imports` | file_name, format, row_count, inserted_count, skipped_count, matched_count, period_from/to, created_by | 銀行 CSV の取り込み 1 回分（`0011`） |
| `bank_transactions` | import_id, txn_date, description, amount(入金 ＋／出金 −), balance, status(unmatched/matched/ignored), invoice_id, expense_id, auto_matched, fingerprint(会社内 unique) | 銀行明細（`0011`） |
| `drivers` / `profiles` の追加列 | line_user_id, line_linked_at | LINE 連携（`0011`） |
| `vehicles` | plate(会社内 unique), maker, model, ownership(owned/lease/driver), driver_id, lease_monthly, odometer, is_active, sort_order | 車両（`0012`）。期限は documents で持つ |
| `documents` | kind, driver_id / vehicle_id(どちらか必須), label, number, issued_on, expires_on, reminder_days(既定 60), file_path, is_active | 期限のある書類（`0012`）。免許証・車検・自賠責・任意保険・健康診断・安全管理者講習 |
| `daily_reports` | work_date, month(トリガー), driver_id, vehicle_id, pre_*(業務前点呼), post_*(業務後点呼), start_at/end_at/break_minutes/distance_km/odo_*, unique(company_id,work_date,driver_id) | 日報＝点呼記録簿＋業務記録（`0012`）。1 年保存 |
| `work_day_entries` | work_date, month(トリガー), driver_id, project_item_id, qty, source(staff/driver/import/line), status(submitted/approved/rejected), reject_reason, approved_by/at, unique(company_id,work_date,driver_id,project_item_id) | 日別の稼働（`0012`）。承認済みの合計が月次の qty になる |
| `work_entries` の追加列 | qty_source(manual/daily) | 日別から自動集計した行かどうか（`0012`） |
| `safety_managers` | name, office, appointed_on, training_on, training_expires_on, is_active | 貨物軽自動車安全管理者（`0012`。2025 年 4 月施行） |
| `driver_instructions` | driver_id, kind(initial/regular/accident/elderly/special), instructed_on, hours, topics, instructor | 指導・監督の記録（`0012`）。3 年保存 |
| `incidents` | driver_id, vehicle_id, occurred_at, kind(accident/violation/near_miss), place, description, cause, prevention, reported, cost | 事故・違反・ヒヤリハット（`0012`） |
| `import_profiles` | name(会社内 unique), client_id, project_id, mapping, driver_match, item_match, header_row, encoding | 元請ファイルの取り込み定義（`0013`）。列と名前の対応を覚える |
| `import_runs` | profile_id, file_name, month, row_count, applied_count, skipped_count, unmatched | 取り込み 1 回分の記録（`0013`） |
| `expenses` の追加列 | receipt_path, ocr(jsonb) | レシート画像（Storage `receipts`）と AI の読み取り結果（`0013`） |
| `applicants` / `applicant_events` | name, stage(applied…started/declined/rejected), applied_on, interview_on, started_on, driver_id, checklist(jsonb) | 採用のパイプライン（`0013`）。段階が変わると履歴をトリガーが残す |
| `contracts` | driver_id, status(draft/active/ended), start_on, end_on, auto_renew, notice_days, file_path, agreed_at | 業務委託契約（`0013`） |

### ビュー（`0003_views.sql` ほか、`security_invoker = true`：呼び出し元の RLS が適用）

> 例外は `v_staff`（`0011`）だけです。閲覧者は他人の `profiles` を読めない（`profiles_select` は admin 以上）ため security_invoker にせず、ビューの中で `company_id = current_company_id()` と `is_staff()` を必ず絞り込んでいます。チャットの宛先候補を閲覧者にも出すためです。

`0003_views.sql` は先頭で全ビューを `drop view ... cascade` してから作り直します。公開スクリプトは毎回すべてのマイグレーションを順番に再適用するため、あとのマイグレーション（`0008` / `0009`）で列が増えたビューに `create or replace view` を実行すると「cannot drop columns from view」で失敗するためです。`npm run test:sql` はマイグレーションを 2 回適用して、この再適用の安全性を確認します。

| ビュー | 内容 |
|---|---|
| `v_work_entry_calc` | 稼働行 + bill/pay/margin/royalty/entry_profit + ドライバー名・案件名・内容名・区分 |
| `v_driver_month_summary` | driver_months ∪ work_entries を基点に、稼働合計・調整・mgmt_fee（計上条件適用）・payout・driver_profit・is_closed |
| `v_month_summary` | 会社 × 月（driver_count, entry_count, bill, pay, margin, royalty, mgmt_fee, adj_*, payout, profit, profit_rate, status, closed_at, backup_path） |
| `v_project_summary` | 案件内容 × 月（entry_count, driver_count, qty_total, bill, pay, margin, royalty, entry_profit, profit_rate） |
| `v_month_list` | データがある月の一覧（月セレクタ・月締め画面用） |
| `v_expense_list` | 経費 ＋ カテゴリ名・区分・ドライバー名・案件名・is_closed（`0009`） |
| `v_expense_summary` | 経費 × 月 × カテゴリ（件数・金額・課税分の金額）（`0009`） |
| `v_recurring_expense_list` | 毎月かかる経費 ＋ カテゴリ名・ドライバー名・案件名（`0009`） |
| `v_month_pl` | 会社 × 月の損益：`v_month_summary` ＋ 経費（固定／変動／合計）＋ `operating_profit = profit − expense_total` ＋ `operating_margin` ＋ 月次目標（`0009`） |
| `v_client_month_summary` | 取引先 × 月の売上（取引先を設定した案件のみ）（`0009`） |
| `v_invoice_list` | 請求書 ＋ 取引先名・明細数（`0009`） |
| `v_project_pl` | 案件 × 月の損益：稼働の利益 − 案件に直課した経費 ＝ 案件利益、利益率、目標利益率との判定（`0010`） |
| `v_staff` | スタッフ一覧（id, display_name, email, role, is_active, line_linked）。**security_invoker ではなくビュー内で会社とロールを絞り込む**（`0011`） |
| `v_chat_channel_list` | ルーム ＋ 発言数・最終発言・自分の未読件数・自分宛のメンション件数（`0011`） |
| `v_chat_message_list` | 発言 ＋ 発言者名・ロール・is_mine・is_mentioned（`0011`） |
| `v_ai_conversation_list` | AI 相談の会話 ＋ 最後の発言（`0011`） |
| `v_alert_summary` | 会社 × 月の未対応件数（重さ別）と最終検査時刻（`0011`） |
| `v_bank_transaction_list` | 銀行明細 ＋ 消込先の請求書番号・取引先名・取り込み元ファイル名（`0011`） |
| `v_vehicle_list` | 車両 ＋ 割当ドライバー名・次に来る期限・期限切れ件数（`0012`） |
| `v_document_list` | 書類 ＋ 対象名（ドライバー／車両）・残り日数・expiry_status（expired/soon/valid/none）（`0012`） |
| `v_daily_report_list` | 日報 ＋ ドライバー名・車両番号・点呼の済み未済・その日の稼働合計（`0012`） |
| `v_work_day_entry_list` | 日別の稼働 ＋ ドライバー名・案件名・内容名・単位（`0012`） |
| `v_day_status` | 会社 × 月の承認待ち件数・承認済み件数・稼働日数・点呼が無い日数（`0012`） |
| `v_applicant_list` | 応募者 ＋ ドライバー名・やりとり件数・最終のやりとり日・応募からの日数（`0013`） |
| `v_contract_list` | 契約 ＋ ドライバー名・残り日数・period_status（active/renewal/expired/open/ended）（`0013`） |
| `v_import_profile_list` | 取り込み定義 ＋ 取引先名・案件名・実行回数（`0013`） |

消費税（`0008`）：`v_driver_month_summary` は `tax_mode`（driver_months に固定値があればそれ、無ければ drivers）、`tax_rate` / `tax_rounding`（同じく companies）、`tax_base = pay − royalty − mgmt_fee`、`tax = round_by_mode(tax_base × tax_rate, tax_rounding)`（exempt は 0）、`payout_incl = payout + tax` を返す。`v_month_summary` は `tax` と `payout_incl` の合計を持つ。調整（adj_pay）は税込の金額として消費税の対象外。

経費と営業利益（`0009`）：経費の金額はすべて税抜。`v_month_pl` は `profit`（会社利益）から `expense_total`（その月の経費合計）を引いた `operating_profit`（営業利益）を返す。ダッシュボードの KPI・年次レポート・AI 月次分析はこのビューを使う。

### RPC（`0004_rpc.sql`、`0005_portal_seed.sql`、`0007_driver_rates.sql`、`0009_expenses_invoices.sql`、`0010`、`0011`）

| 関数 | 権限 | 内容 |
|---|---|---|
| `entry_defaults(driver_id, project_item_id)` | staff | §2.5 の自動入力値（受注・支払ともドライバー別単価を優先） |
| `rate_diffs(month)` | staff | その月の稼働行のうち、単価・率・端数処理のいずれかが現在のマスタと異なる行（スナップショットとマスタ値の両方を返す） |
| `apply_master_rates(month, driver_id?, project_item_id?, entry_ids?)` | admin+ | 未締め月の該当行の単価・率・端数処理を現在のマスタの値に更新し、更新行数を返す（締め済みは MONTH_CLOSED） |
| `copy_previous_month(month)` | admin+ | 前月の稼働行を数量 0 で複製（現在のマスタから単価を再取得。停止中は除外。冪等） |
| `bulk_set_entries(month, project_item_id, rows)` | admin+ | 一括入力（既存は数量更新、0 は削除、新規はマスタから作成） |
| `month_snapshot(month)` | staff | 締め時スナップショット JSON（summary / drivers / entries / adjustments / projects） |
| `close_month(month, note)` | admin+ | その月の driver_months に消費税の設定（税率・端数処理・課税区分）を固定 → month_closings を closed に upsert しスナップショット保存。監査記録 |
| `set_month_backup_path(month, path)` | admin+ | Storage へ保存したバックアップのパスを記録 |
| `reopen_month(month)` | owner | closed → open、固定した消費税の設定を外す。監査記録 |
| `export_backup()` | admin+ | 全テーブルのバックアップ JSON（§8.4） |
| `import_backup(jsonb)` | owner | 復元・取り込み。ID 一致は上書き、他社 ID と衝突すれば拒否。締めガード・行単位監査を一時回避し、まとめて 1 件の監査を記録 |
| `reset_company_data(会社名)` | owner | データ全削除（会社設定・ユーザー・招待は残す。driver ユーザーは無効な viewer に） |
| `seed_initial_data(with_entries)` | admin+ | §8.6 の初期データ（ドライバーが 0 件の会社のみ） |
| `create_invitation(email, role, driver_id, display_name)` | owner | 招待作成（同メールの未受諾招待は取消） |
| `apply_invitation(user_id, email)` | security definer | 招待を照合して profiles を作成／更新（auth トリガーと招待リンクログインの両方から使用） |
| `driver_portal_months()` / `driver_portal_statement(month)` | driver | 本人の締め済み月一覧・明細（会社売上・利益は含めない。率の表示は会社設定に従う。税込支払額・消費税・支払日の個別設定・ロゴの有無を含む） |
| `round_by_mode(value, mode)` | 全員 | SQL 側の端数処理（`lib/calc` の applyRounding と同じ規則） |
| `chat_post(channel_id, body, mentions uuid[])` | staff | 社内チャットに発言し、自分の既読も進める（閲覧者も可。空文字は EMPTY_BODY） |
| `chat_mark_read(channel_id)` / `chat_unread_total()` | staff | 既読の更新／未読の合計（ナビのバッジ） |
| `detect_anomalies(month)` | admin+ | 11 種類の異常を検知して `alerts` に記録。`fingerprint` で二重に作らず、検知しなくなったものは `resolved` に。`{detected, open, auto_resolved}` を返す |
| `set_alert_status(alert_id, status, note)` | admin+ | アラートを対応済み／対象外／未対応に変える |
| `bank_auto_match(import_id?)` | admin+ | 未消込の入金と、金額が一致する未入金の請求書を突き合わせる（候補が 1 件のときだけ消し込み、請求書を入金済みに） |
| `bank_match_invoice(txn_id, invoice_id)` / `bank_set_status(txn_id, status)` | admin+ | 手動の消込／消込を外す・対象外にする（外すと請求書は発行済みに戻る） |
| `line_issue_code()` | ログイン中の本人 | LINE 連携の 8 桁の合言葉を発行（30 分有効。ドライバーは自分の分） |
| `line_consume_code(code, line_user_id)` | service_role | Webhook から呼び、合言葉を本人に結びつける |
| `line_unlink(driver_id?)` | 本人 / admin+ | LINE 連携を外す |
| `default_chat_channels(company_id)` | 内部 | 会社作成時に「全体」「経営」を作る |
| `submit_day_entries(work_date, item_ids[], qtys[], driver_id?, memo?)` | ドライバー本人 / admin+ | 日別の稼働をまとめて提出（数量 0 は削除）。ドライバーは自分の分だけ |
| `approve_day_entries(ids[], approve, reason?)` | admin+ | 承認・差戻し。承認するとトリガーが月次の稼働に反映する |
| `apply_day_entries(month)` | admin+ | その月の承認済みを月次の稼働へ反映し直す |
| `sync_work_entry_from_days(company_id, month, driver_id, project_item_id)` | 内部 | 日別 → 月次の集計本体（トリガーから呼ぶ） |
| `driver_day_items()` | ドライバー本人 | 「今日の報告」で選べる案件内容（直近 60 日に使ったものが先） |
| `month_day_date(month, offset, day)` | 全員 | 稼動月からの支払日・入金予定日（0 = 末日。月末を超える日は月末に丸める）（`0009`） |
| `apply_recurring_expenses(month)` | admin+ | 毎月かかる経費をその月に計上し、作成件数を返す（未締め月のみ・二重計上しない）（`0009`） |
| `build_invoice(client_id, month)` | admin+ | その月・その取引先の稼働から請求書と明細を作り直す（番号は `YYYYMM-NN`。発行済みは hint `INVOICE_ISSUED`）（`0009`） |
| `set_invoice_status(invoice_id, status, paid_on)` | admin+ | 請求書の状態変更（paid 以外にすると入金日を消す）（`0009`） |
| `recalc_invoice(invoice_id)` | admin+ | 請求書の小計・消費税・合計を計算し直す（通常はトリガーが自動で行う）（`0009`） |
| `cash_forecast(from, to)` | staff | 入金予定（未入金の請求書）・入金実績・ドライバーへの支払予定（税込）・経費（実績と未計上の固定費）を日付順に返す。入金は ＋、支払は −（`0010`） |
| `driver_portal_current()` | driver | 本人の最新の未締め月の暫定額（速報）。会社設定 `driver_portal_show_open_month` が off なら null（`0009`） |
| `default_expense_categories(company_id)` | 内部 | 既定の経費カテゴリ 12 件を投入（会社作成トリガーから使用）（`0009`） |
| `request_approval(kind, title, detail, amount, ref_table, ref_id, href, due_on)` | admin+ | 代表に決裁をお願いする（`0019`） |
| `decide_approval(id, approve, note)` | 代表 / 委任された admin | 承認・却下。代理のときは `on_behalf_of` に代表が入る（`0019` / `0020`） |
| `withdraw_approval(id, note)` | 申請者本人 / 代表 | 申請の取り下げ（`0019`） |
| `approval_required(kind, amount)` | staff | その操作に代表の決裁が要るか（しきい値は `approval_rules`）（`0020`） |
| `can_decide_approval(kind, amount)` | staff | 自分がその申請を決裁できるか（代表、または有効な委任を持つ admin）（`0020`） |
| `can_see_confidential(key)` | staff | 借入・現金・振込口座を見てよいか（`companies.confidential_scope`）（`0020`） |
| `decision_from_approval(approval_id)` | 代表 | 承認した申請から意思決定ログの下書きを作る（二度は作らない）（`0020`） |
| `ensure_plan_years(plan_id)` | 代表 | 中期計画の期間ぶんの年を用意する（`0019`） |
| `spread_plan_year(plan_id, year, 'even' \| 'actual')` | 代表 | 年間目標を 12 か月の `month_targets` へ配分（端数は 12 月。手入力済みの月は変えない）（`0020`） |
| `record_login_event(profile_id, kind, ip, user_agent)` | **サービスロール専用** | ログイン・ログアウトの記録。1 年より古い記録は消える（`0019`） |
| `record_export(profile_id, kind, label, month, rows, ip, user_agent)` | **サービスロール専用** | 出力（持ち出し）の記録。1 年より古い記録は消える（`0020`） |
| `default_approval_rules(company_id)` | 内部 | 既定の決裁ルール 6 件を投入（会社作成トリガーから使用）（`0020`） |
| `current_company_id()` / `current_app_role()` / `current_driver_id()` / `is_owner()` / `is_admin()` / `is_staff()` / `is_driver_user()` / `is_month_closed()` | ヘルパー | security definer で profiles を参照（is_active 必須） |

### トリガー（`0001` / `0002` / `0009`）

| トリガー | 対象 | 内容 |
|---|---|---|
| `t00_set_updated_at` | 主要テーブル | updated_at 自動更新 |
| `t01_fill_company_id` | 子テーブル | 親から company_id を補完し、不一致なら拒否 |
| `t02_check_driver_company` | profiles / invitations | driver_id が同じ会社か |
| `t03_set_entry_actor` | work_entries | created_by / updated_by = auth.uid() |
| `t05_guard_month_closed` | work_entries / driver_months / adjustments / expenses | 対象月が closed なら INSERT/UPDATE/DELETE を拒否（hint `MONTH_CLOSED`。`app.bypass_closing` で復元時のみ回避） |
| `t10_protect_profile` | profiles | role / company_id / is_active / driver_id / email は owner のみ。自分自身のロール変更・無効化は不可 |
| `t10_protect_month_closings` | month_closings | closed → open と削除は owner のみ |
| `t20_ensure_driver_month` | work_entries | driver_months が無ければ作成（mgmt_fee = drivers.mgmt_fee）し、有効な固定控除を adjustments に複写 |
| `t04_sync_project_client` | projects / clients | `client_id` から `client_name` を同期。`client_name` だけ入力された場合は取引先を自動作成。取引先の改名も案件に反映（`0009`） |
| `t06_invoice_item_amount` / `t07_recalc_invoice` | invoice_items / invoices | 明細の金額 = 数量 × 単価、請求書の小計・消費税・合計を自動再計算（`0009`） |
| `t20_company_seed_defaults` | companies | 会社を作ったときに既定の経費カテゴリを投入（`0009`） |
| `t20_default_approval_rules` | companies | 会社を作ったときに既定の決裁ルール 6 件を投入（`0020`） |
| `t01_approval_names` / `t01_decision_name` / `t01_delegation_name` | approvals / decisions / approval_delegations | 申請者・決裁者・委任先の名前を行に写す（閲覧者は他人の `profiles` を読めないため）（`0019` / `0020`） |
| `t02_approval_guard` | approvals | 決裁できるのは `can_decide_approval` が真の人だけ、取り下げは申請者本人か代表だけ、決裁済みは代表以外が触れない（hint `FORBIDDEN`）（`0019` / `0020`） |
| `t01_plan_year_company` | plan_years | 計画から company_id を補完し、計画の期間の外の年を拒否（`0019`） |
| `t90_audit` | 主要 19 テーブル | INSERT/UPDATE/DELETE を audit_logs に記録（差分の無い UPDATE は除外。invitations.token と month_closings.snapshot は除外） |
| `on_auth_user_created` | auth.users | 招待を照合して profiles を作成。招待が無ければ例外（hint `INVITATION_REQUIRED`）で登録自体を拒否 |

---

## 4. 権限

### 4-1. ロール × 操作

| 操作 | owner | admin | viewer | driver |
|---|:-:|:-:|:-:|:-:|
| ダッシュボード・稼働・支払・案件の閲覧 | ○ | ○ | ○ | × |
| 稼働の追加・編集・削除、前月複製、一括入力 | ○ | ○ | × | × |
| 管理費・調整の編集 | ○ | ○ | × | × |
| ドライバー・案件・単価のマスタ編集 | ○ | ○ | × | × |
| 月締め | ○ | ○ | × | × |
| 締め解除 | ○ | × | × | × |
| CSV / 弥生 CSV / PDF 出力 | ○ | ○ | ○（CSV） | 自分の明細のみ |
| バックアップ出力 | ○ | ○ | × | × |
| 復元・取り込み・データ全削除 | ○ | × | × | × |
| 会社設定 | ○ | × | × | × |
| ユーザー招待・ロール変更・無効化 | ○ | × | × | × |
| 監査ログ閲覧 | ○ | ○ | × | × |
| 自分の締め済み月の明細・PDF | — | — | — | ○ |
| 表示名・パスワードの変更（本人） | ○ | ○ | ○ | ○ |
| **代表への申請（`request_approval`）** | ○ | ○ | × | × |
| **決裁（承認・却下）** | ○ | 委任があるときだけ | × | × |
| **意思決定ログ・会社の台帳・中期計画・ログインと持ち出しの記録** | ○ | × | × | × |
| **決裁のルール・委任・機密の見せ方の変更** | ○ | × | × | × |
| **借入・納税・現金残高の閲覧** | ○ | 既定で ○ | 既定で × | × |
| **ドライバーの振込口座の閲覧** | ○ | 既定で ○ | × | × |
| **事務（`/office`：その場での承認・催促・月締めのチェック）** | ○ | ○ | × | × |
| **最初に開く画面を「事務」にする** | ○ | ○ | × | × |

### 4-2. 二重チェックの考え方

1. **UI**：viewer・締め済み月・driver には編集 UI を表示しない（`canEdit()` / `isMonthClosed()`）。
2. **Server Action / Route Handler**：`requireAdminAction()` などでセッション + ロールを確認 → zod 検証 → DB 操作。例外は `translateError()` で日本語へ。
3. **DB（RLS + トリガー + RPC 内の権限チェック）**：全テーブル `company_id = current_company_id()`。書き込みは `is_admin()`、companies / invitations の更新は `is_owner()`。driver は work_entries / driver_months / adjustments を「自分かつ締め済み月」のみ SELECT、drivers・projects・project_items は自分に関係する行のみ。audit_logs は admin+ のみ SELECT、書き込みはトリガー（security definer）のみ。anon には一切の権限を与えない（`0006_storage_grants.sql` で revoke）。
4. 無効化されたユーザー（`profiles.is_active = false`）はヘルパー関数が null を返すため、すべての RLS で不一致となり何も見えません。

### 4-2b. 代表（owner）だけの領域（0019・0020）

`/executive` 配下は `requirePageRole(["owner"])` で入口を閉じ、DB 側でも
`decisions` / `company_profile` / `officers` / `shareholders` / `insurance_policies` / `advisors` /
`guarantees` / `plans` / `plan_years` / `login_events` / `export_logs` の RLS が
`public.is_owner()` を必須にしています。代表以外にはビュー越しでも 1 行も見えません。

- **`approvals` だけはスタッフ全員が読めます**（自分が出した申請の行方が分かるように）。
  追加は `is_admin()`、状態を `approved` / `rejected` に変えられるのは
  `can_decide_approval(kind, amount)` が真の人だけで、RLS・トリガー・RPC の 3 か所すべてで確認します。
- **代表だけの気づきは `alerts` に載せません。** `alerts` の SELECT は `is_staff()` なので、
  保険・役員・意思決定などを載せると管理者・閲覧者に漏れます。代わりに
  `v_executive_tasks` / `v_executive_summary`（どちらも `security_invoker`）で代表にだけ出します。
- **バックアップも RLS が効きます。** `export_backup` は `security invoker` なので、
  管理者が書き出すと代表専用のぶんは空の配列になります。`import_backup` はもともと owner 専用です。

#### 機密の隔離（`confidential_scope` と `can_see_confidential`）

`companies.confidential_scope`（jsonb）の 3 つのキーを owner / admin / staff の 3 段階で持ちます。

| キー | 対象 | 既定 |
|---|---|:-:|
| `loans` | `loans` / `loan_payments` / `tax_tasks` | admin |
| `cash` | `cash_snapshots`（と資金繰り） | admin |
| `bank_account` | `driver_bank_accounts`（振込口座） | admin |

判定は DB の `can_see_confidential(key)` の 1 本だけで、ポリシーもビューも画面もここを見ます
（アプリ側の同じ判定は `effectiveAccess()` の結果 `ctx.access`。0029 から人ごとの上書きが先に効きます → 4-14）。

**落とし穴**：`*_write` のポリシーは `for all` で作られており、`FOR ALL` は SELECT も含みます。
select 側だけを閉じても write 側のポリシーで読めてしまうため、両方に判定を入れています。

**ドライバーの振込口座**：PostgreSQL の RLS は行単位で、列単位では閉じられません。
`drivers` は閲覧者も読む（名前・案件の紐づけ）ため、口座の列を同じ行に置いたままでは隠せませんでした。
0020 で `driver_bank_accounts`（主キー `driver_id`）へ分離し、読み取りは `v_driver_bank` に統一しています。

#### 代理決裁（`approval_delegations`）

代表が 1 人なので、不在のあいだ決裁が止まると会社が止まります。かといって owner へ昇格させる経路は
乗っ取られたときに最も危ないので作りません。**期間・上限金額・種別を切った一時的な委任**だけを許し、
代理で決めたときは `approvals.on_behalf_of` に本来の決裁者（代表）を必ず残します。

### 4-3. サービスロール（`lib/supabase/admin.ts`）

`SUPABASE_SERVICE_ROLE_KEY` は RLS を無視できるため、**サーバー専用**で用途を次に限定しています。

- 招待リンクの表示・受諾（`invitations` の参照、`auth.admin.createUser` / `generateLink`、`apply_invitation`）
- ユーザー管理（`auth.admin.listUsers` / `updateUserById`、無効化）
- 月締め時のバックアップ JSON を Storage へ保存、署名付き URL の発行
- ログインの記録（`record_login_event`）と持ち出しの記録（`record_export`）。
  どちらも `authenticated` から `execute` を剥奪済みで、**失敗してもログインや出力を止めません**

ブラウザへ渡す `NEXT_PUBLIC_*` には含めません。`next.config.ts` の `serverExternalPackages` と `server-only` で誤ってクライアントへ混入しない構成です。

### 4-4. その他の防御（レビューで追加した対策）

| 対策 | 実装 |
|---|---|
| **内部関数は RPC で呼べない** | `apply_invitation` / `write_audit` / `ensure_driver_month` / `import_has_id_conflict` / `handle_new_auth_user` は `0006_storage_grants.sql` で `authenticated` / `anon` / `public` から `execute` を剥奪。さらに `apply_invitation` は関数内で「JWT なし（auth トリガー）またはサービスロール」以外を例外で拒否（権限剥奪＋ガードの二重） |
| **締めスナップショットはスタッフのみ** | `month_closings`（`snapshot` 列に会社売上・利益を含む）の SELECT ポリシーは `is_staff()`。driver ロールは `is_month_closed()`（security definer）経由で締め状態だけを知る |
| **監査を書く RPC は security definer** | `close_month` / `reopen_month` / `import_backup` / `reset_company_data` / `set_month_backup_path` は監査ログ書き込みのため security definer。会社は必ず `current_company_id()` で限定し、関数冒頭で `is_admin()` / `is_owner()` を確認するので、他社のデータには触れない |
| **招待リンクは同時使用不可** | `acceptInviteAction` は「`link_used_at is null` の行だけを使用済みに UPDATE（RETURNING）」してからログイン処理へ進む。同じリンクを同時に 2 回開いても 1 回しか通らない（失敗時は使用済みを解除） |
| **ログアウトは CSRF 対策** | `app/auth/signout/route.ts` は POST のみで、`Origin`（無ければ `Referer`）のホストが自サイトと一致しないと 403 |
| **リダイレクト先はサイト内のみ** | `?next=` は「`/` で始まり `//` や `\` を含まないパス」だけ許可（`safeNext` / ログイン画面）。メールリンクの `next={{ .RedirectTo }}` は `app/auth/confirm/route.ts` の `resolveNext()` が「サイト内パス、または同一ホストの絶対 URL」のみ受け付け、それ以外はトップへ |
| **anon は何もできない** | `public` スキーマの全テーブル・関数・シーケンスから `anon` の権限を剥奪（既定権限も含む）。未ログインで API を叩いても RLS 以前に拒否される |

---

## 4-5. 声で稼働を入力（`lib/voice`）

運転席や倉庫で、片手で数量を入れるための入口（`/entries` の「声で入力」）。

```
話す ──▶ Web Speech API（端末側で文字にする。ja-JP）
          │  lib/voice/speech.ts：使えるかの判定・エラーの日本語化。音声データは扱わない
          ▼
        文字 ──▶ lib/voice/parse.ts（純関数）
                   splitPhrases  「、」「あと」で複数行に割る
                   extractQty    数量を 1 つ取り出す（漢数字は独立した語 or 単位が続くときだけ）
                   matchDriver   ドライバー名・かな・敬称のゆらぎを吸収
                   matchItem     案件名 × 内容名。かな → ローマ字で「アマゾン」＝「Amazon」
                   ▼
                 画面で確認・修正（ドライバー／案件／数量のプルダウンと入力）
                   ▼
                 quickSetEntriesAction → 案件内容ごとに RPC bulk_set_entries
                   単価・率・端数処理は DB が現在のマスタから決める（§2-5）
                   既にある行は数量だけ変わる（単価のスナップショットは維持）
```

守っていること。

- **音声は保存も送信もしない**。アプリが受け取るのは端末が文字にした結果だけ
- **解析は純関数**（`lib/voice/parse.ts`）。DB にも React にも依存せず、`tests/voice-parse.test.ts` で固めている
- **保存前に必ず人が確認する**。読み取れなかった項目は空のまま出し、そろっていない行は保存しない
- **単価をアプリ側で組み立てない**（§7）。数量だけを送り、単価は DB 側の `entry_defaults` が決める
- **マイクが使えない端末でも同じことができる**（同じダイアログの文字入力）。E2E はこの経路で検証する

## 4-6. いま動いている版（`/api/version`）

端末（とくにホーム画面に追加した PWA）は古い版を握ったままになることがある。
「更新したのに変わらない」を利用者自身が確かめて直せるようにしている。

- `buildId()`（`VERCEL_GIT_COMMIT_SHA` の先頭 7 桁。ローカルは `dev`）をユーザーメニューに出す
- 画面は 5 分おき・タブに戻るたびに `/api/version`（`no-store`）と比べ、違えば帯を出す
- 「更新する」は `updateToLatest()`：Cache Storage を全部消し、Service Worker を解除してから再読み込み
- Service Worker は **`/sw.js?v=<版>`** で登録する。URL が版ごとに変わるのでブラウザが必ず入れ直し、
  `activate` で前の版のキャッシュ（`rootive-<版>-static` / `-pages`）を捨てる

---

## 4-7. 通知（`lib/push`・0022）

「チャットの通知が来ない」の原因は、**通知の仕組みが無かった**こと（未読バッジだけで、
端末にも LINE にも何も送っていなかった）。3 つの経路で届ける。

```
発言（chat_post）／承認・差戻し（approve_day_entries）
        │  Server Action は保存まで。返事を返したあとに after() で送る
        ▼
  lib/push/notify-chat.ts ／ notify-daily.ts（サービスロール。company_id で必ず絞る）
        ├─▶ 端末への通知    push_subscriptions → web-push → ブラウザの push イベント
        │                    404 / 410 が返った購読はその場で消す
        ├─▶ LINE            自分あて（メンション）と、承認・差戻しの結果だけ
        └─▶ アプリ内        ベルが /api/nav-badges を 60 秒ごと・タブ復帰で見て、増えたらトースト
```

決めごと。

- **誰に送るかは純関数**（`lib/push/targets.ts` の `shouldNotifyChat` / `shouldNotifyLine`）。
  画面にも DB にも条件を書かない。テストは `tests/push-targets.test.ts`
- **鍵がそろっているときだけ機能を出す**（`NEXT_PUBLIC_VAPID_PUBLIC_KEY` と `VAPID_PRIVATE_KEY`）。
  未設定の環境では設定画面にその旨だけを出し、LINE とアプリ内は使える
- **VAPID の鍵は作り直さない**。作り直すと、すでに購読しているすべての端末に届かなくなる。
  `scripts/deploy-vercel.sh` は Vercel 側に鍵が無いときだけ作る
- **購読は本人のものだけ**（RLS。管理者にも他人の端末は見えない）。送信はサービスロールが読む
- **バックアップに含めない**（端末の資格情報であり、戻しても別の端末では使えない）
- 送信の失敗で業務を止めない。`after()` の中で握りつぶし、LINE の失敗だけ `integration_logs` に残す
- Service Worker の `push` は**必ず通知を表示する**。受け取って何も出さないと iOS が購読を止める

## 4-8. iPhone で通知を受け取るための条件

iOS は、**ホーム画面に追加した PWA からしか** Web Push を購読できない（Safari のタブでは不可）。
設定画面はこれを検出して、追加の手順を先に案内する（`isIos` かつ `isStandalone()` が false のとき）。

---

## 4-9. 配車・シフト（`lib/dispatch`・0023）

ここまでのアプリは「終わったことの記録と集計」だけで、予定を扱えなかった。
**予定と実績は分けたまま**にする（実績は日別の稼働 `work_day_entries` が正で、配車から実績は作らない。
作ってしまうと「予定していたのに報告が無い」を検知できなくなる）。

```
必要人数                    割り当て                  ドライバー
project_demands（曜日）      dispatch_assignments      driver_day_offs（休み希望）
project_demand_days（特定日） ├ planned                drivers.weekly_off（定休日）
   ↓ 特定日 > 曜日            └ confirmed → 前日の夕方に通知
   needFor()                     ↑ confirm_dispatch
   ↓
buildDispatchBoard()  →  過不足（shortage）→  autoAssign() が提案（保存はしない）
```

| もの | 置き場所 | 役割 |
|---|---|---|
| 純関数 | `lib/dispatch/board.ts` | 週のボード・必要人数の解決・自動割り当ての提案・見込み・`summarizeOutlook` |
| 読み取り | `lib/dispatch/queries.ts` | 配車表は 8 往復、ダッシュボードは `v_dispatch_outlook` で 2 往復 |
| Server Action | `lib/actions/dispatch.ts` | すべて RPC 経由（`set_dispatch_bulk` / `copy_dispatch_week` / `confirm_dispatch` ほか）|
| 画面 | `app/(app)/dispatch`・`app/driver/schedule` | 配車表・必要人数・休み希望／ドライバー本人の予定 |
| 通知 | `lib/push/notify-dispatch.ts`・`/api/cron/dispatch` | 確定した翌日ぶんを前日 18:00（JST）に知らせる |

- **自動割り当ては必ず同じ結果になる**（承認済みの休みと定休日を外す → その案件の経験が多い人 → 割り当ての少ない人 → 名前の順）。
  提案は画面に出すだけで、保存するまで DB は変わらない
- ダッシュボードの「これからの配車」はビュー **`v_dispatch_outlook`**（今日から 14 日ぶん・日ごとに 1 行）を
  `summarizeOutlook` でまとめる。画面側で必要人数を組み立て直さない
- 異常の検知は 3 つ増えて 29 ルール（人が足りない日・予定はあるのに報告が無い・休み希望が決まっていない）
- バックアップは **version 8**（必要人数・特定日・休み希望・割り当てまで入る）

### 新しいテーブルには権限を出す

`0020` の末尾にある `grant ... on all tables in schema public to authenticated` は、
**そのあとの番号で作ったテーブルには届かない**（0022 の `push_subscriptions`、0023 の 4 つが該当した）。
`security invoker` の RPC はログイン中のユーザーの権限で動くので、テーブル権限が無いと
RLS の手前で `permission denied` になる。`0023` の末尾で出し直し、
`tests/sql/run.sh` が**マイグレーションの 1 回目の適用直後に**抜けが無いか確かめる
（2 回目の適用では前の周回のテーブルにも grant が届いてしまい、気づけないため）。

---

## 4-10. 法定帳票と監査（`lib/compliance`・0024）

0012 で点呼・業務記録・車両・書類までは取れるようになったが、**監査で「出してください」と言われる帳票**が
そろっていなかった。`/compliance` の 1 画面と `audit-pack.zip` の 1 ファイルで答えられるようにする。

```
運転者台帳                        記録
drivers（台帳の項目）             driver_instructions  指導・監督
  ＋ documents(kind='license')    aptitude_tests       適性診断（0024 で新設）
  ＋ documents(kind='health_check') incidents          事故・違反
        ↓                          daily_reports       運転日報・点呼
   v_driver_roster  ←────────────┘
        ↓
   v_compliance_gaps（足りないもの）   v_record_retention（いつまで保存するか）
        ↓                                   ↓
                     /compliance · audit-pack.zip
```

| もの | 置き場所 | 役割 |
|---|---|---|
| 純関数 | `lib/compliance/helpers.ts` | 不足の並べ替え・種類ごとのまとめ・台帳の記入率 |
| 読み取り | `lib/compliance/queries.ts` | 画面は 3 往復、台帳 PDF は 4 往復 |
| 画面 | `app/(app)/compliance` | 足りないもの・運転者台帳・保存期間の 3 タブ ＋ 一式の出力 |
| 帳票 | `lib/exports/compliance-csv.ts`・`lib/pdf/roster.tsx`・`lib/exports/audit-pack.ts` | CSV・PDF（1 人 1 ページ）・ZIP の中身 |

- **免許証と健康診断は `documents` が正**。台帳は `v_driver_roster` が引いてくるだけで、二重に持たない
- 保存期間は `companies.retention_*`（会社ごとに延ばせる）。**期限が過ぎた記録は自動で消さない**。
  `v_record_retention.expired_count` は「消してよい候補の件数」を示すだけ
- 不足の判定はすべて DB のビュー（`v_compliance_gaps`）に置く。画面側で条件を書かない。
  **期限切れの書類と点呼の漏れは 0012 の異常検知（`alerts`）が拾う**ので、このビューには入れない（同じことを 2 か所に出さない）
- 適齢診断の年齢と間隔、健康診断の間隔も会社設定（`aptitude_age_from` / `aptitude_age_years` / `health_check_months`）

---

## 4-11. 使ってみて気づいた直し（0025）

### 個人情報を含む出力は「機密」の種別で記録する

`export_logs` の `is_sensitive` は `record_export` の中のリストで決まり、
代表の「出力の急増」アラートも**機密の出力しか数えない**。
0024 の運転者台帳は `kind='other'` のままだったため、生年月日・住所・免許証番号を含むのに
支払明細 PDF より緩い扱いになっていた。`roster` / `compliance` を足して直した。

> **出力を足すときは種別も足す。** 個人情報が入るなら `record_export` のリストへ。
> ここに入れ忘れると、記録は残るが「急増」には出ない。

### 会社設定はオーナーだけ

`companies` の UPDATE は RLS で `is_owner()` を求める。入口を `requireAdminAction` にすると
管理者には**編集できる見た目だけ出て、保存すると必ず失敗する**。
会社設定を触る Server Action は `requireOwnerAction`、画面も `isOwner` で閉じる（§2 の二重チェックを両側でそろえる）。

### ダッシュボードは 1 往復にまとめる

カード 6 つぶん（書類・応募者・契約・日報の状況・アラートの件数と上位 3 件）は RPC **`dashboard_cards(month)`**。

```
以前： 6 往復（v_document_list / v_applicant_list / v_contract_list / v_day_status / v_alert_summary / alerts）
いま： dashboard_cards() 1 往復 → 返ってきた行を今までと同じ純関数へ
```

**RPC は行を返すだけで、件数・期限・採用の判定はしない**（`toFleetDocument` / `hrCounts` / `countExpiry` はそのまま）。
SQL 側に判断を移すと純関数と食い違い、どちらが正か分からなくなるため。

### サイドナビの見出しを畳める

23 項目は一度に見るには多い。見出し（入力・経営・管理・相談）を畳めるようにした。

- 既定はすべて開いたまま（今までと同じ見た目）
- 畳んだ見出しは端末ごとに覚える（`localStorage`。読めない端末では全部開く）
- **いま開いている画面が入っている見出しは、畳んでいても開く**（自分の居場所を見失わないため）
- 判定は純関数（`groupNavItems` / `isGroupOpen` / `toggleNavGroup`）

## 4-12. 事務（`lib/office`・0026）

事務の仕事は 10 画面以上に散らばっていた（稼働報告の承認は日報・点呼、休み希望は配車、消込は入金、月締めは設定 → 月締め …）。
しかも月締めには手順の案内が無く、「締める」ボタンの付いた表しかなかった。`/office` に 1 画面でまとめる。

```
office_desk(month, today)  ── 1 往復（security invoker・admin 以上）。行と数だけ
        │
        ├─ todayReporters()    今日報告が要る人・まだの人・催促できる人
        ├─ buildInbox()        今日やること（急ぎ → 今日中 → 近いうちに、の順。同じなら種類の順）
        └─ buildClosingSteps() 月締めの手順（done / todo / warn / skip）→ closingProgress()
```

| まとまり | 中身 | その場でできること（既存の Action をそのまま呼ぶ） |
|---|---|---|
| 今日やること | 稼働報告の承認待ち・今日の報告がまだ・休み希望・明日の人不足／未確定・期日を過ぎた未入金・重要な気になること・締めていない過去の月・消し込めていない入金 | 承認／差戻し（`approveDayEntriesAction`）・休みの返事（`decideDayOffAction`）・催促・明日の確定（`confirmDispatchAction`）・自動消込（`autoMatchBankAction`） |
| 今日の報告 | 報告が要る人ごとの 済み／まだ／催促済み／連絡手段なし | まとめて催促（`remindReportsAction`）・代わりに入力（/daily） |
| 月締めの手順 | 承認 → 稼働 → 点呼と報告 → 単価 → 毎月の経費 → 支払通知 → 請求書 → **締める → 支払明細の送付 → 振込**（0028 で順番を直した） | 経費の計上（`applyRecurringExpensesAction`）・締める（`closeMonthAction`）・明細を LINE で送る（`sendStatementsAction`）・手作業のチェック（`setCloseCheckAction`） |

- **todo は「締めても良いが、ほぼやり直しになる」、warn は「確かめたほうが良い」**。締めるボタンは todo が残っていても押せる（確認のダイアログに残りを並べる）
- 今月・先の月は「月が終わってから締めます」（skip）
- 今日の報告が要る人：配車が 1 件でもあれば配車に入っている人、無ければ定休日でない全員。承認済みの休みは外す
- 催促は `report_reminders` の一意制約（会社 × ドライバー × 日）で **1 人 1 日 1 回**。RPC は今回初めて記録した人だけを返し、その人にだけ送る
- 手作業の手順（`month_close_checks`）は、0026 では締めた月に付け外しできなかった（`guard_month_closed` を付けていた）。
  明細の送付と振込は**締めてから**行うので、この番人は矛盾していた。0028 で外し、手順も「締める → 送付 → 振込」の順に直した
- 最初に開く画面（`profiles.start_page`）：`/` とログイン後の既定の行き先（`next` を省いたとき）が振り分ける。事務の人は下タブの先頭とロゴも事務

---

## 5. 認証フロー

```
① 招待（owner）
   設定 → ユーザー管理 → 招待  ──▶ create_invitation() ──▶ invitations（token, 7 日）
                                 ├─▶ Supabase 招待メール（任意・SMTP 設定時に実用）
                                 └─▶ 招待リンク https://<app>/invite/<token> を画面に表示（LINE で送付可）

② 招待リンクでログイン（メール不要）  app/(auth)/invite/[token] → acceptInviteAction
   token を service_role で照合（未取消・未使用・期限内）
   → auth.admin.createUser({ email_confirm: true })   ※既存ユーザーならスキップ
     └ auth.users INSERT トリガー on_auth_user_created → apply_invitation → profiles 作成
   → auth.admin.generateLink({ type: "magiclink" }) で hashed_token を発行
   → サーバー側で supabase.auth.verifyOtp({ token_hash, type: "magiclink" }) → Cookie セッション発行
   → invitations.link_used_at を記録（1 回限り）→ /dashboard または /driver へ

③ メールでログイン（マジックリンク）   ログイン画面 → signInWithOtp({ shouldCreateUser: false, emailRedirectTo: <本番URL>+next })
   メールのリンク = {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next={{ .RedirectTo }}
   → app/auth/confirm/route.ts が verifyOtp({ type, token_hash }) → セッション → next へ
   ※ token_hash 方式のため、受信した端末と別の端末で開いても検証できる
   ※ {{ .RedirectTo }} = アプリが指定した遷移先（emailRedirectTo / redirectTo）。resolveNext() でサイト内に限定。
     driver ロールはどこを指定されても /driver（アカウント系なら /driver/account）へ

④ パスワード           signInWithPassword。設定は「アカウント」画面（updateUser）。
                       再設定メールは type=recovery、redirectTo = /settings/account?reset=1（パスワード欄にフォーカス。driver は /driver/account）

⑤ PKCE                 app/auth/callback/route.ts（code → exchangeCodeForSession）。Supabase ダッシュボードからの操作や将来の OAuth 用に併設

⑥ 自由登録の禁止        Supabase 側 disable_signup + shouldCreateUser: false + auth.users トリガーで招待の無い登録を例外で拒否（三重）

⑦ ログアウト           app/auth/signout/route.ts（POST のみ・Origin / Referer が自サイトのときだけ signOut → /login）
```

セッションは `@supabase/ssr` の Cookie。`middleware.ts` が毎リクエストでトークンを更新し、未ログインなら `/login?next=…` へリダイレクト（`/login` `/invite` `/auth` `/api/cron` `/manifest.webmanifest` `/icons` などは公開。`/api/cron` は Cookie を持たない Vercel Cron から呼ばれるため公開扱いにし、認可は Route Handler 側の `CRON_SECRET` で行う）。ロールに応じた入口は `app/page.tsx`（driver → `/driver`、それ以外 → `/dashboard`）。2 段階認証（Supabase TOTP）は将来ダッシュボードで有効化できる構成（UI は未実装）。

---

## 6. 月締め・バックアップ・監査

- **月締め**：`close_month()` が `month_snapshot()`（集計ビューの JSON）を `month_closings.snapshot` に保存し `status = 'closed'`。以後 `t05_guard_month_closed` が 3 テーブルへの書き込みを拒否。画面は `isMonthClosed()` で編集 UI を隠し、Server Action も拒否。
- **締め時バックアップ**：Server Action が `export_backup()` の JSON を service_role で Storage `backups/<company_id>/<YYYY-MM>_<timestamp>.json` にアップロードし、`set_month_backup_path()` で記録。ダウンロードは `/api/export/month-backup?m=` が署名付き URL（60 秒）へリダイレクト。
- **締め解除**：`reopen_month()`（owner）。監査ログに `reopen_month` を記録。
- **監査**：`t90_audit` が before / after の JSON 差分を保存。復元・全削除は行単位ではなく 1 件の集約記録（`import_backup` / `reset_company_data`）。画面は 設定 → 監査ログ（テーブル別フィルタ・差分表示・ページング）。

---

## 7. 出力

| 出力 | 実装 | 形式 |
|---|---|---|
| 稼働明細 CSV / 支払一覧 CSV / 個人明細 CSV | `app/api/export/{entries,payouts,statement}.csv` + `lib/exports/*` | UTF-8 BOM、Excel でそのまま開ける。数値は生の値（`rawNumber()`） |
| 単価表 CSV | `app/api/export/rates.csv` + `lib/exports/rates-csv.ts` | 稼働中ドライバー × 稼働中案件内容の実効単価（受注・支払・差額・出所「個別／標準」・個別値） |
| 全ドライバー明細 PDF（ZIP） | `app/api/export/statements.zip` + `lib/exports/zip.ts` | その月に明細があるドライバー全員の PDF を無圧縮 ZIP にまとめる（依存なしの自前 ZIP 生成）。`vercel.json` で maxDuration 60 秒 |
| 弥生仕訳 CSV | `app/api/export/yayoi.csv` + `lib/yayoi/{accounts,build}.ts` | Shift_JIS（iconv-lite）、25 列、ヘッダー無し。売上：売掛金／売上高、外注費：外注費／未払金、ロイヤリティ・管理費・利益計上の調整：未払金／雑収入（補助科目）、利益計上なしの調整：立替金。科目・税区分・ドライバー分割・伝票日付は `companies.yayoi_accounts` で変更可 |
| PDF 支払明細 | `app/api/export/statement.pdf` + `lib/pdf/statement.tsx` | A4 縦、Noto Sans JP（`public/fonts`）、日本語の禁則処理付き折り返し。会社利益は載せない。税抜小計・消費税・お支払額（税込）、ロゴ・認印（`lib/company-assets.ts` の `loadStatementAssets`）を印字。`vercel.json` で maxDuration 30 秒 |
| 会社のロゴ・認印 | `app/api/company-asset/[kind]` + `lib/company-assets.ts` + `lib/actions/company-assets.ts` | Storage 非公開バケット `company-assets/<company_id>/<kind>-<timestamp>.<ext>`。書き込みはサービスロール（owner の Server Action、PNG/JPEG 2MB まで、先頭バイトで判定）、読み出しはログイン中の自社ユーザー。印刷用ページ・ポータルは `<img src="/api/company-asset/logo">` |
| 印刷用ページ | `/payouts/[driverId]/print` | ブラウザ印刷 |
| LINE 用テキスト | `lib/statement/statementToText()` | 会社利益を含まない |
| 経費 CSV | `app/api/export/expenses.csv` + `lib/exports/expenses-csv.ts` | その月（または全月）の経費明細（カテゴリ・区分・金額・課税区分・発生日・ドライバー・案件・支払先） |
| 請求書 PDF | `app/api/export/invoice.pdf` + `lib/pdf/invoice.tsx` + `lib/invoice/index.ts` | A4 縦、Noto Sans JP。取引先名＋敬称、請求書番号、ご請求金額（税込）、明細、小計・消費税・合計、自社情報＋ロゴ・認印 |
| 請求書一覧 CSV | `app/api/export/invoices.csv` + `lib/exports/invoices-csv.ts` | 請求書番号・取引先・状態・発行日・入金予定日・小計・消費税・合計・入金日 |
| 資金繰り CSV | `app/api/export/cashflow.csv` + `lib/exports/cashflow-csv.ts` | 期間内の入金予定・支払予定・経費と、その日の残高 |
| 案件別採算 CSV | `app/api/export/projects.csv` + `lib/exports/projects-csv.ts` | 案件ごとの売上・直課経費・案件利益・利益率・目標判定（当月／全期間） |
| ドライバー別採算 CSV | `app/api/export/drivers-pl.csv` + `lib/exports/drivers-pl-csv.ts` | ドライバーごとの売上・支払・会社利益・利益率・税込支払額（合計行つき） |
| 年次レポート CSV | `app/api/export/report.csv` + `lib/exports/report-csv.ts` | 月次推移（売上・会社利益・経費・営業利益・営業利益率・消費税・税込支払額・状態）＋合計行 |
| 月次パック ZIP | `app/api/export/month-pack.zip` + `lib/exports/month-pack.ts` | その月の明細 PDF・請求書 PDF・CSV・振込データ・経営レポートを 1 つに。`?parts=` で選択。失敗したファイルは README.txt にエラーとして記録して処理を続ける |
| 月次の経営レポート PDF | `app/api/export/month-report.pdf` + `lib/pdf/month-report.tsx` | A4 縦 3 ページ。損益サマリー（前月比・前年同月比）、目標の進捗、経営指標（説明つき）、12 か月の推移グラフ、ドライバー別・案件別の採算、気になること |
| 書類の索引簿 CSV | `app/api/export/records.csv` + `lib/exports/records-csv.ts` | レシート・請求書・支払通知・契約書の一覧（取引年月日・取引金額・取引先で絞り込んだ結果をそのまま出す）|
| 労務 CSV / Excel | `app/api/export/labor.csv` `.xlsx` + `lib/exports/labor-csv.ts` | 日ごと（拘束・実働・休息・連続勤務と判定）と月ごと（合計・平均・超過日数）|
| 支払通知の突合 CSV | `app/api/export/notice-diff.csv` + `lib/exports/notice-csv.ts` | 元請の支払通知の明細と自社の売上の差（数量・単価・金額）|
| 配車予定 CSV | `app/api/export/dispatch.csv` + `lib/exports/dispatch-csv.ts` | 期間の配車（日・曜日・ドライバー・案件・予定数量・予定売上）。既定は今日から 2 週間 |
| 法定帳票 CSV | `app/api/export/compliance.csv` + `lib/exports/compliance-csv.ts` | 運転者台帳・指導・事故・適性診断（`?kind=`）|
| 運転者台帳 PDF | `app/api/export/roster.pdf` + `lib/pdf/roster.tsx` | 監査の様式に合わせた台帳（1 人 1 ページ）|
| 監査一式 ZIP | `app/api/export/audit-pack.zip` + `lib/exports/audit-pack.ts` | 台帳・日報・指導・事故・診断・車両・労務を 1 つに（README つき）|
| Excel（.xlsx）| `app/api/export/*.xlsx` + `lib/exports/xlsx.ts` | 依存なしの自前 xlsx ライター（`zip.ts` で OOXML を包む）。金額・率・数量・日付の書式、見出しの太字と固定行、オートフィルタ、列幅の自動調整。CSV と同じ 15 種類（稼働・支払・経費・請求書・案件・ドライバー別採算・資金繰り・年次レポート・単価表・個人明細・気になること・銀行明細・車両と書類・採用と契約・日報）|
| 全銀 総合振込データ | `app/api/export/transfer.txt` + `lib/exports/zengin.ts` | Shift_JIS・固定長 120 バイト・CRLF。ヘッダ／データ／トレーラ／エンドの 4 レコード。半角カナ変換（濁点の分解・法人格の略号）。口座情報を含むため owner/admin のみ。画面は `/payouts/transfer` |
| 振込一覧 CSV | `app/api/export/transfer.csv` | 全銀データの目視確認用（銀行・支店・預金種目・口座番号・カナ名義・税込支払額・振込予定日）|
| バックアップ JSON | `app/api/export/backup.json` → `export_backup()` | **version 4**（0015）。マスタ・稼働・支払・経費・請求書に加えて、車両・書類・日報・日別の稼働・安全管理者・指導・事故・取り込み定義・応募者・契約・税務の期限・借入と返済予定まで含む。外部連携のトークン・社内チャット・AI の履歴・監査ログ・アラート、Storage の画像は含まない |

明細のデータ組み立ては `lib/statement/index.ts` に集約し、画面・PDF・CSV・テキスト・ドライバーポータルで共用しています。請求書は `lib/invoice/index.ts` に同じ形で集約しています。

---

## 8. 移行（試作アプリ JSON）

- `lib/migrate/convert.ts`：試作アプリ（Claude 上の「ROOTIVE 利益管理」）のバックアップ JSON（§8.5）を本システムのバックアップ形式へ変換。
- **ID は uuid v5**（固定名前空間 `MIGRATION_NAMESPACE` + `種別:試作ID`）で決定的に生成。同じファイルを何度取り込んでも重複せず、`import_backup()` の「ID 一致は上書き」で再取り込み＝更新になります。名前空間は変更禁止（変えると既存 ID と一致しなくなる）。
- `previewBackup()` が `lib/calc` で件数と月別集計（売上／利益／支払）を算出し、画面（設定 → データ）と CLI（`scripts/migrate-prototype.ts`）で検算できます。
- 対応：drivers → drivers、projects/items → projects/project_items、rateOverrides → driver_pay_overrides、entries → work_entries（month は月初日、rounding は会社設定を複写）、driverMonths → driver_months + adjustments、months → month_closings、settings.app → companies。

---

## 9. テスト戦略

| 種類 | コマンド | 内容 |
|---|---|---|
| 単体（Vitest） | `npm test` | `lib/calc`（§2.6 の全ケース、誤差 0.01 円以内、端数処理 4 種、恒等式）、zod スキーマ、`lib/migrate` の変換と決定的 ID、`lib/voice` の解析、`lib/push` の宛先と文面。**プッシュの送信（`tests/push-send.test.ts`）は使い捨ての自己署名証明書で HTTPS のテストサーバーを立て、暗号化された本文と VAPID の署名が届くこと・410 なら購読を消すことまで確かめる**（openssl が無い環境では飛ばす） |
| SQL 結合（psql） | `npm run test:sql` | ローカル PostgreSQL に `tests/sql/auth_stub.sql`（auth.uid() 等のスタブ）+ 全マイグレーションを適用し `tests/sql/test.sql` を実行。ビューの計算が §2.6 と一致、RLS（viewer / driver の拒否）、締めガード、招待制、復元・全削除、経費と営業利益（`v_month_pl`）、取引先と請求書（`build_invoice` / 合計の自動計算 / 状態）、ポータルの速報、代表と機密の隔離、通知の購読と設定、配車（必要人数・割り当て・休み希望・写しと確定・見通し）、法定帳票（運転者台帳・適性診断・保存期間・監査で足りないもの）、出力の機密判定と LINE 連携の復元とダッシュボードの 1 往復、事務（月締めのチェック・催促・最初に開く画面・office_desk）、事務員と明細の送付、ユーザーごとの見せる範囲と代表を譲る、期（設立日の同期と復元）。36 節。**1 回目の適用直後にテーブル権限の抜けも確かめる** |
| E2E（Playwright） | `npm run test:e2e` | Supabase 互換のテストサーバー（`supabase-lite`：PostgreSQL + GoTrue 相当 + PostgREST 相当の軽量実装）を自動起動し、iPhone 13 と Desktop Chrome の 2 プロジェクトで主要導線（招待ログイン → ダッシュボード → 稼働追加・複製・一括入力 → 支払明細・PDF → 設定 → 月締め・解除 → 経費と営業利益 → 取引先と請求書（PDF・入金） → 年次レポートと月次目標 → ナビとコマンドパレット・ポータルの速報 → 閲覧者／ドライバーの権限 → 移行 JSON の取り込み）をブラウザで確認。29 spec・157 シナリオ × 2 プロジェクト = **314 件**。スクリーンショットを `docs/screenshots/` に保存。詳細は [docs/E2E.md](E2E.md) |
| 静的 | `npm run typecheck` / `npm run lint` / `npm run build` | 型・Lint・本番ビルド |
| まとめ | `npm run check` | typecheck + lint + test + build:sql |

supabase-js の使い方は、E2E 用の互換サーバーが対応する範囲（埋め込みリソースを使わない、単純なフィルタ、`rpc`、限られた auth / storage API）に限定しています（[CLAUDE.md](../CLAUDE.md) 参照）。

## 4-13. 事務員・支払明細の送付・請求書のメール（0027・0028）

### 事務員（clerk）

`user_role` に `clerk` を足した（enum の値は同じトランザクションで使えないので 0027 に分けた）。線は 3 本：

| 判定 | 入るロール | 使うところ |
|---|---|---|
| `is_admin()` / `ADMIN_ROLES` / `canEdit` | owner・admin・clerk | 登録・編集・月締め・出力の多く（今までの「管理者以上」） |
| `is_manager()` / `MANAGER_ROLES` / `canManage` | owner・admin | 監査ログ・外部連携・AI の分析・月次目標・バックアップ・チャットのルーム以外の経営の設定 |
| `can_see_management()` / `MANAGEMENT_VIEW_ROLES` / `ctx.access.management` | owner・admin・viewer（0029 から人ごとに変えられる） | ホーム・資金繰り・案件別・採算・財務・レポート・AI と、画面の会社利益の列 |

- ナビの `RoleVisibility` に `managerOnly` と `noClerk` を足した（`lib/nav/visibility.ts`。0029 で `noClerk` は `management` に改めた）
- 行ごとの売上・支払は請求と支払の仕事に要るので、事務員にも見える。会社利益は**画面で出さないだけ**（既知の制限）
- 経営のアラート 8 種類（利益の急減・ドライバーの赤字・目標未達・資金不足・税務・決裁の滞留・出力の急増）は `is_management_alert(code)` で RLS から外す
- `cash_forecast` は 0017 まで `is_staff` だけを見ていたため、借入を見られない閲覧者にも返済の行が返っていた。0028 で `can_see_management()` を必須にし、返済の行は `can_see_confidential('loans')` の人にだけ返す
- 締め時バックアップ（Storage）の読み取りは `is_manager()`。事務員が締めたときのバックアップは本人の権限で書き出すので、事務員に見えないもの（月次目標・振込口座・借入・納税・現金）は入らない

### 支払明細の送付

```
sendStatementsAction / notifyStatementsAction（月締めの自動送信）
        │
        └─ lib/statements/send.ts  sendStatements()
              ├─ 本人の権限：v_driver_month_summary（締めた月か・税込額）・statement_deliveries・drivers
              ├─ サービスロール（会社で絞る）：integrations.is_enabled・profiles・push_subscriptions
              ├─ planStatementSend()（純関数）… 送信済みは飛ばす／金額が変わった人は送る／連絡手段が無い人は数える
              ├─ LINE（pushLineMessages）＋ 端末への通知（sendPush）
              └─ record_statement_deliveries(month, 届いた人, 'line' | 'push')
```

- 事務の「月締めの手順」は `office_desk` の `statement_targets` / `statement_sent` / `statement_line_ready`（LINE が届くのにまだ送っていない人）で判定する。全員に送った記録があれば自動で済み
- `office_desk` の `after_close` に、直近に締めた月（45 日以内）の送付と振込の状況を返し、残っていれば「今日やること」に出す

### 請求書のメール

- `clients.email`（カンマ区切り 5 件まで）。`sendInvoiceMailAction`：下書きなら発行 → `renderInvoicePdf` → Resend（`lib/mail/send.ts`）→ `record_invoice_send`（失敗も残す）
- `RESEND_API_KEY` と `MAIL_FROM` がそろったときだけ画面に出す。キーはサーバーだけで読む

### 使い方ガイド

- `lib/guide/pages.ts`（各ページ）・`overview.ts`（全体の流れ・よくある質問）。`guideForPath(guides, path, role)` がいちばん長く当たる画面を選び、見られない画面のガイドは返さない
- 右上の「？」（`components/guide/help-button.tsx`）。スマホのスタッフはヘッダーの幅が足りないので、メニューの「この画面の使い方」から同じダイアログを開く（`openHelp()`）

---

## 4-14. ユーザーごとの見せる範囲・代表を譲る（0029）

### 見える範囲の決まり方

```
ロール（owner / admin / clerk / viewer / driver）
  └─ 会社の機密の見せ方（companies.confidential_scope：借入・現金・振込口座）
        └─ その人だけの上書き（profiles.access_overrides：allow / deny）   ← 0029
```

| キー | 中身 | ロールの既定 |
|---|---|---|
| `management` | 経営の数字（ホーム・資金繰り・案件別・採算・財務・レポート・AI・会社利益・経営のアラート） | owner・admin・viewer |
| `loans` / `cash` / `bank_account` | 借入と納税／現金と資金繰り／ドライバーの振込口座 | 会社の機密の見せ方（既定は管理者まで） |
| `export` | 出力（CSV・Excel・PDF・ZIP・バックアップのダウンロード） | スタッフ全員 |

- **代表（常にすべて）とドライバー（会社の数字は見ない）には上書きが効かない**
- DB は `can_see_management()` / `can_see_confidential(key)` / `can_export()`、アプリは `lib/auth/access.ts` の `effectiveAccess()`。
  `getSessionContext()` が 1 回計算して `SessionContext.access` に入れ、画面・Server Action・出力の口はこれを見る（ロールだけで判定を書かない）
- `access_overrides` は**ロールの既定と違うものだけ**を持つ（画面の「ロールのとおり」はキーを消す。`buildAccessOverrides`）。形は `valid_access_overrides()` の check 制約で守る
- 経営のアラートの出し分けは `is_clerk()` から `can_see_management()` に変えた（事務員に見せる設定にすれば経営のアラートも見える）
- `export` は RLS では止めない：画面に出せるデータを一覧で持ち出すかどうかの話で、読めるものを DB で止めると画面ごと止まるため。
  **出力の口（`requireExportRole`）が 403** を返し、画面は `AppShell` の `data-export-off` と CSS で出力のリンク（`/api/export/…`）・出力のボタン群（`[data-export-menu]`）・出力センターを隠す。
  締め時のバックアップ（`export_backup`）は月締めの一部なので止めない
- 経営の数字を見せない人はホームに入れないので、行き先は `staffHome()`（編集できる人は事務、閲覧者は稼働）。`/` の振り分け・`requirePageRole` の戻し先・ロゴ・下タブが同じ判定
- 変えられるのは代表だけで、**自分自身のものは変えられない**（`protect_profile_columns` に `access_overrides` を足した）
- RLS が効かないサービスロールの経路（週次サマリー・重大なアラートの LINE・LINE の返事）は `seesManagement()` / `effectiveAccess()` で宛先と返事を絞る

### 代表を譲る

RPC `transfer_ownership(p_to, p_my_role)`（security definer）。

1. 呼んだ人が有効な owner か（`OWNER_ONLY`）、相手が同じ会社の有効なスタッフか（ドライバー・無効・自分は `INVALID`、ほかの会社は `NOT_FOUND`）
2. `app.bypass_profile_guard` をこの処理の中だけ立てて、相手を owner、自分を admin / clerk / viewer に**続けて**更新する（代表が 0 人になる瞬間が無い）
3. 両方の `access_overrides` を外す（代表には効かず、新しいロールでは意味が変わるため）
4. 変更の記録は profiles の監査トリガーが残す（アプリで二重に書かない）

画面は `/settings/users/[id]` の「代表を譲る…」。成功すると自分はもう代表ではないので、`/` から開き直してナビと権限を読み直す。
一時的に任せるだけなら 0020 の「決裁の委任」を使う（権限そのものは動かさない）。

## 4-15. 期（事業年度。0030）

```
決算月（companies.fiscal_month）── 期の区切り（9 月決算なら 10月〜翌9月）
設立日（companies.established_on）── 第N期の番号（第1期は設立の月から最初の決算月まで）
        │
        └─ lib/fiscal.ts（純関数）
              fiscalPeriodOfMonth(month) … その月が入る期（label：「第3期」／設立日が無ければ「2026年9月期」）
              fiscalPeriod(決算の年)     … 期の月・範囲の表示
              periodOptions()            … 選べる期（設立前はデータがあるときだけ）
```

- 期は「決算の年」（その期が終わる年）で識別する。URL は `?fy=2026`
- 設立日は代表の台帳（`company_profile`・0019）にもある。台帳は代表だけが読めるので、期を数えるために companies にも持ち、
  トリガー（`t20_sync_established`）で相互に写す（同じ値なら何もしないので行き来しない）。`import_backup` も設立日を戻す
- 月の切り替え：`MonthSelector` のダイアログで期ごとの 12 か月を並べる（`v_month_list` の締め・件数・売上を表示。期の合計は `summarizePeriod`）
- 年次レポート：`ReportRange`（`view`・`from`〜`to`・`months`・`label`・`prevName`）に一本化。`?fy=` が期、`?y=` が暦年、
  無ければ稼動月の期。月次推移・前期比（前年比）・ランキング・経費・経営指標（`toKpiTrendRowsForMonths`）・出力が同じ範囲を読む
- 予算（`/finance` の予実）と中期計画の配分（`spread_plan_year`）は暦年のまま（既知の制限）

## 10. 既知の制限

1. **driver ロールが自分の稼働行の `bill_rate`（受注単価）を API 経由で読める**：`work_entries` の driver 用 SELECT ポリシーは行単位で列を制限できないため、supabase-js を直接叩けば自分の締め済み月の行の受注単価・会社側の値が取得できます。画面・PDF・ポータル RPC（`driver_portal_statement`）では出していません。厳密に隠す場合は列を分離したビューだけを driver に許可する変更が必要です。
2. **複数会社の UI は未対応**：データ構造（`company_id` + RLS）は多社対応ですが、ユーザーは 1 社にのみ所属し、会社の切替 UI はありません。
3. **事務員（clerk）に会社利益を DB では隠していない**：事務員は請求（受注単価）と支払（支払単価）を扱うので稼働行の売上・支払は読め、`bill − pay` で利益は出せます。画面では会社利益・行の利益を出していませんが、API を直接叩けば集計ビューも読めます。経営の数字を厳密に隠すなら、事務員に売上か支払のどちらかを任せない運用にしてください。
4. **メール送信は Supabase 標準では 1 時間 2 通**：本番でマジックリンクを常用するにはカスタム SMTP が必要（[docs/SETUP.md](SETUP.md) 手順 12）。招待リンク＋パスワード運用なら不要。
5. **Supabase 無料プランの休止**：7 日間 API アクセスが無いとプロジェクトが一時停止します（ダッシュボードの「Restore project」で再開可）。`vercel.json` の `crons` が毎日（UTC 21:00 = 日本時間 6:00）`/api/cron/keepalive`（service_role で `companies` を 1 件数えるだけ）を呼び出して防止します。**`CRON_SECRET` は必須**で、未設定だと Route Handler が 503 を返して定期アクセスは無効になります（設定済みなら Vercel が付与する `Authorization: Bearer <CRON_SECRET>` を照合）。`scripts/deploy-vercel.sh` と GitHub Actions は未指定時に自動生成します。念のため月 1 回の手動バックアップを推奨。
6. **PDF のフォント**：`public/fonts/NotoSansJP-*.ttf` を実行時にファイルとして読み込みます。`next.config.ts` の `outputFileTracingIncludes` で `/api/export/statement.pdf` に `public/fonts/**` を同梱する設定済みです。フォントが見つからないエラーが出た場合は、この設定と `public/fonts/` の中身を確認してください。
7. **2 段階認証の UI なし**（Supabase 側で有効化できる構成のみ）。
8. **出力を止めても画面の内容は読める**（0029）：「出力（ダウンロード）」を止めた人でも、画面に出ている数字は見られ、supabase-js を直接叩けば同じ行も読めます。止めているのは一覧のダウンロード（出力の口）と画面の出力ボタンだけです。見せたくない数字そのものは「経営の数字」「借入と納税」「現金」「振込口座」の見せる範囲で止めてください（こちらは RLS で止まります）。
9. **予算と中期計画は暦年**（0030）：月の切り替えと年次レポートは期（事業年度）で見られますが、財務の予算・予実と中期計画の年間目標の配分（`spread_plan_year`）は 1〜12 月の暦年のままです。

---

## 11. 将来拡張の方針

| 項目 | 方針 |
|---|---|
| 2 段階認証（TOTP） | Supabase の MFA を有効化し、`lib/auth/session.ts` で AAL2 を要求する画面（設定・ユーザー管理）を追加 |
| LINE 通知 | LINE Messaging API（Push）を Server Action から呼び出し、月締め時に明細テキストを自動送信。drivers に LINE ユーザー ID 列を追加 |
| Google Drive 自動保存 | 月締め時のバックアップ JSON / PDF を Drive API でアップロード（サービスアカウントまたは OAuth）。`set_month_backup_path` に Drive の URL も記録 |
| 複数会社 UI | profiles を（user, company）の多対多にし、会社切替をヘッダーへ。RLS ヘルパーは「現在選択中の会社」を JWT クレームか Cookie から解決 |
| 通知・リマインド | Vercel Cron で「未締め月」「数量 0 の行」をメール／LINE で通知 |
| ドライバー → 会社の請求書 | インボイス制度で必要になった場合、支払明細の逆方向（ドライバーが会社へ出す請求書）を `lib/invoice` から生成 |
| 弥生仕訳に経費を含める | `expense_categories` に勘定科目を持たせ、経費を仕訳（借方＝科目／貸方＝未払金）として出力 |

---

## 12. 環境変数

| 変数 | 用途 | 公開範囲 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase の URL | ブラウザにも渡る |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon（publishable）キー。RLS 前提 | ブラウザにも渡る |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role（secret）キー | **サーバー専用** |
| `NEXT_PUBLIC_APP_URL` | 本番 URL（招待リンク・メールのリダイレクト先）。未設定時は `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → localhost | ブラウザにも渡る |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | 任意。AI 月次分析 | サーバー専用 |
| `RESEND_API_KEY` / `MAIL_FROM` | 任意。請求書のメール送付（両方そろったときだけ画面に出る）。`MAIL_FROM` は Resend で認証したドメインの差出人 | サーバー専用 |
| `LINE_API_BASE` / `RESEND_API_BASE` | E2E 専用。テストサーバーのモックへ向ける（本番では設定しない） | サーバー専用 |
| `CRON_SECRET` | **必須**（本番）。Vercel Cron → `/api/cron/keepalive` と `/api/cron/daily`（毎朝の異常検知と LINE 通知）の Bearer 検証。未設定だと 503 を返し定期アクセスは無効。32 文字以上のランダム文字列（deploy スクリプト／GitHub Actions が自動生成） | サーバー専用 |

---

## 13. 公開の仕組み

| 方法 | 実装 | 内容 |
|---|---|---|
| GitHub Actions（推奨・実績あり） | `.github/workflows/deploy.yml`（`workflow_dispatch`） | Secrets `SUPABASE_ACCESS_TOKEN` / `VERCEL_TOKEN`（任意で `SUPABASE_ORG_ID` / `ANTHROPIC_API_KEY`）を使い、下の 2 スクリプトを順に実行。入力 `app_url` / `owner_email` / `company_name` / `skip_supabase`。DB パスワードと service_role キーはログにマスクし、`.env.production.local` は最後に削除。ジョブサマリーに本番 URL・Supabase プロジェクト・招待リンクを出力 |
| `scripts/setup-supabase.sh` | Supabase Management API（curl + jq） | プロジェクト作成（東京・Free、同名は再利用）→ `supabase/migrations/*.sql` を順に適用 → 会社とオーナー招待（有効な招待は再利用）→ 認証設定（`disable_signup`、Site URL / Redirect URLs）→ メールテンプレート（無料プラン＋標準メールでは HTTP 400 になるため警告して続行）→ API キー取得（`--write-env` で `.env.production.local`） |
| `scripts/deploy-vercel.sh` | Vercel CLI + Vercel REST API | `vercel link` → 環境変数を REST API（`/v10/projects/:id/env?upsert=true`）で登録（CLI の対話プロンプトを避ける。API 不可時のみ CLI）→ `CRON_SECRET` を未指定なら生成 → `vercel deploy --prod` → 本番 URL（エイリアス `https://rootive-profit.vercel.app`）を `NEXT_PUBLIC_APP_URL` に設定（未確定なら再デプロイ）→ `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` があれば Supabase の Site URL / Redirect URLs を更新。トークンの前後の空白・改行は自動で除去 |

実際の本番：Vercel `rootive-profit`（`https://rootive-profit.vercel.app`、東京 `hnd1`）＋ Supabase `rmchixgmeqtszqsdvxrj`（東京 `ap-northeast-1`）。

公開手順は [docs/SETUP.md](SETUP.md)、自動化は [docs/QUICKSTART.md](QUICKSTART.md)、日々の運用は [docs/OPERATIONS.md](OPERATIONS.md)、E2E テストは [docs/E2E.md](E2E.md) を参照してください。
