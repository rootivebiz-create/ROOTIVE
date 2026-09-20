# ROOTIVE 利益管理システム — 開発ガイド（CLAUDE.md）

軽貨物運送・業務委託ドライバーの「ドライバー × 案件 × 月」の稼働から、会社売上・会社利益・支払額を自動確定する社内アプリ。
Next.js 15（App Router / Server Actions）＋ Supabase（PostgreSQL・Auth・RLS・Storage）。日本語 UI、スマホ最優先。

## コマンド
- `npm run dev` 開発サーバー / `npm run build` 本番ビルド
- `npm test` Vitest（計算ロジック §2.6 の全ケースを含む） / `npm run test:sql` SQL 結合テスト（ローカル PostgreSQL に自動でクラスタを作る）
- `npm run typecheck` / `npm run lint` / `npm run test:e2e`（Playwright。Supabase 互換のテストサーバーを自動起動）
- `npm run build:sql` → `supabase/setup_all.sql` を再生成（migrations を変更したら必ず実行）
- `node scripts/gen-db-types.mjs > lib/db/database.types.ts` DB 型の再生成（ローカル PostgreSQL にマイグレーション適用後）

## ディレクトリ
- `lib/calc/` 純関数の計算ロジック（正）。DB ビュー `v_*` と同じ結果を返すこと
- `lib/ai/` AI（`config.ts` 有効判定・`context.ts` データパック・`analysis.ts` 月次分析・`chat.ts` 相談・`draft.ts` 文章・`findings.ts` 応答の正規化）
- `lib/alerts/` `lib/chat/` `lib/bank/` `lib/integrations/` `lib/daily/` `lib/fleet/` `lib/intake/` `lib/hr/` 各機能の純関数とサーバー専用の処理
- `lib/db/database.types.ts` supabase-js 用の型（自動生成）、`lib/db/types.ts` 型エイリアス、`lib/db/queries.ts` 共通クエリ
- `lib/auth/session.ts` セッション・ロール確認（`requireStaff` / `requirePageRole` / `requireAdminAction` など）
- `lib/actions/*.ts` Server Actions（`"use server"`）、`lib/actions/result.ts` 共通の `ActionResult` / `runAction` / エラー変換
- `lib/schemas/*.ts` zod スキーマ（サーバー・クライアント共用）
- `lib/month.ts` 稼動月ユーティリティ、`lib/format.ts` 表示書式（円・%・数量）
- `components/ui/*` UI 部品（shadcn/ui 相当）、`components/layout/*` シェル・ナビ・月セレクタ
- `app/(app)/*` スタッフ画面（ホーム・稼働・支払・請求・経費・資金繰り・案件・レポート・ドライバー別の採算・設定）、`app/driver/*` ドライバーポータル、`app/(auth)/*` ログイン・招待、`app/api/export/*` 出力
- `supabase/migrations/*.sql` スキーマ（0001 テーブル、0002 認証・RLS、0003 ビュー、0004 RPC、0005 ポータル・初期データ、0006 Storage・権限、0007 ドライバー別単価（bill_rate 上書き・rate_diffs・apply_master_rates）、0008 消費税・ロゴと認印・ドライバーごとの支払日、0009 経費と営業利益・取引先と請求書・月次目標、0010 資金繰り・案件別採算、0011 AI チャット・社内チャット・異常検知・外部連携、0012 運行管理と法令対応（点呼・業務記録・日別の稼働・車両・書類）、0013 取り込みと採用・契約、0014 法人の経営管理（振込先口座・決算と税務カレンダー・借入金・経営指標・契約書の保管）、0015 バックアップと復元を全テーブルへ拡張、0016 異常の検知を毎日自動で回す、0017 会社を明示して集計する RPC、0018 労務（拘束時間・休息）と元請の支払通知との突合）
- `tests/` Vitest（`*.test.ts`）、`tests/sql/`（psql）、`tests/e2e/`（Playwright ＋ `supabase-lite` テストサーバー）

## 必ず守る規約
1. **Server Action の順序**：`requireXxxAction()` でセッション＋ロール確認 → zod 検証 → DB 操作（supabase-js、RLS 適用）→ `revalidatePath` → `ActionResult` を返す。`runAction(async () => {...}, "保存しました")` で包む。例外は日本語メッセージへ変換される（`translateError`）。
2. **権限は二重**：UI で編集 UI を出さない（viewer・締め済み月）だけでなく、Server Action と DB（RLS・トリガー）でも必ず拒否する。
3. **締め済み月**：`work_entries` / `driver_months` / `adjustments` への書き込みは DB トリガーが拒否する（hint `MONTH_CLOSED`）。画面側は `isMonthClosed()` で編集 UI を隠す。
4. **稼動月**：URL の `?m=YYYY-MM`（`monthFromParam(searchParams.m)`）。DB は月初日 `YYYY-MM-01`（`monthToDate` / `dateToMonth`）。ナビのリンクは `MonthLink` / `useMonth().href()` で `?m` を引き継ぐ。
5. **数値**：金額 numeric(12,2)、率 numeric(6,4)（0.1 = 10%）。表示は `yen()` / `pct()` / `qty()`（`components/ui/money.tsx` の `<Money>` は等幅・右寄せ・マイナス赤）。入力は全角・カンマ可（`parseNumberInput` / `parsePercentInput`、zod の `moneySchema` / `qtySchema` / `percentToRateSchema`）。CSV は `rawNumber()`（生の値）。
6. **計算**：画面のプレビューは `lib/calc`（`calcEntry` / `calcDriverMonth` / `calcCompanyMonth`）、集計表示は DB ビュー（`v_work_entry_calc` / `v_driver_month_summary` / `v_month_summary` / `v_project_summary` / `v_month_list`）を使う。手計算・独自の丸めを書かない。
7. **マスタからの自動入力**：`resolveEntryDefaults()`（§2.5。受注単価・支払単価は `driver_pay_overrides`（ドライバー別単価。null は標準）→ 案件内容の順）。保存後は稼働行のスナップショットが正。マスタ変更を未締め月へ追従させるのは RPC `rate_diffs` / `apply_master_rates`（`lib/actions/rates.ts`）だけで、画面側で行を書き換えない。
8. **サービスロール**（`lib/supabase/admin.ts`）はサーバー専用で、招待・招待リンクログイン・バックアップ保存・ユーザー管理のみに使う。
9. **表記**：日本語のみ。通貨 ¥、カンマ区切り、率は小数 1 桁 %。エラーも日本語。
10. **スマホ**：幅 375px で崩れないこと。表は `Table`（横スクロール）かカード表示。数値入力は `NumberInput`（テンキー）。ダイアログはスマホで下から全幅シート。
11. **監査**：主要テーブルの変更は DB トリガーが自動記録する。アプリ側で二重に書かない。
12. `lib/db/database.types.ts` は手で編集しない（スキーマ変更 → マイグレーション → 型再生成）。

## 業務ルールの要点（詳細は docs/ARCHITECTURE.md）
- 稼働行：bill = 受注単価 × 数量、pay = 支払単価 × 数量、margin = bill − pay、royalty = ROUND(pay × 率)、行の利益 = margin + royalty
- ドライバー × 月：管理費は「数量 > 0 の行が 1 件以上ある月」だけ計上。payout = Σpay − Σroyalty − 管理費 + Σ調整。driver_profit = Σmargin + Σroyalty + 管理費 + Σ(利益計上の調整の −amount)
- 端数処理の優先順：稼働行 ← ドライバー設定 ← 会社設定（既定「丸めない」）
- **消費税（0008）**：単価・管理費・ロイヤリティはすべて税抜で入力する。tax_base = Σpay − Σroyalty − 管理費（調整は税込のまま対象外）、tax = 端数処理(tax_base × companies.tax_rate)（companies.tax_rounding、既定 切り捨て）、payout_incl = payout + tax。drivers.tax_mode が exempt なら tax = 0。締めた月は driver_months.tax_* に固定（close_month が書き、reopen_month が外す）。明細の「お支払額」は payout_incl。ダッシュボード・会社利益は税抜のまま
- 振込予定日：drivers.payout_month_offset / payout_day（両方あり）→ companies の設定（`resolvePayoutDate`）
- 会社のロゴ・認印：Storage `company-assets/<company_id>/…`（非公開）。書き込みはサービスロール（`lib/actions/company-assets.ts`）、表示は `/api/company-asset/<kind>`、PDF は `loadStatementAssets()`
- **経費と営業利益（0009）**：経費（`expenses`）の金額はすべて税抜。カテゴリ（`expense_categories`）は固定費／変動費の 2 区分で、会社を作ると既定 12 件が入る。毎月かかる経費（`recurring_expenses`）は RPC `apply_recurring_expenses(month)` でその月に計上（二重計上しない）。締め済み月の経費は変更不可（`t05_guard_month_closed`）。**営業利益 = 会社利益 − 経費**（ビュー `v_month_pl`。ダッシュボード・レポート・AI 分析はこのビューを使う）
- **取引先と請求書（0009）**：案件に取引先（`projects.client_id`）を紐づけると、その月の稼働から RPC `build_invoice(client_id, month)` で請求書と明細を作る（案件内容 × 受注単価ごとに 1 行）。請求書の小計・消費税・合計はトリガーが自動計算（明細の金額 = 数量 × 単価）。状態は 下書き → 発行済み → 入金済み（RPC `set_invoice_status`）。発行済みの請求書は作り直せない（hint `INVOICE_ISSUED`）。`projects.client_name` はトリガーが取引先名と同期するのでアプリから書かない
- **月次目標（0009）**：`month_targets`（売上・営業利益）。ダッシュボードの進捗バーと `v_month_pl` で使う
- **資金繰り（0010）**：RPC `cash_forecast(from, to)` が入金予定（未入金の請求書）・入金実績・ドライバーへの支払予定（税込）・経費（実績と未計上の固定費）を日付順に返す（入金 ＋／支払 −）。起点の残高は `cash_snapshots`（手入力）。積み上げは `components/cashflow/helpers.ts` の純関数で行い、`sumMoney` を使う
- **案件別採算（0010）**：ビュー `v_project_pl`。案件利益 = 稼働の利益 − その案件に紐づけた経費（`expenses.project_id`）。管理費・調整はドライバー単位なので案件に配賦しない。`projects.target_margin` を下回ると `below_target`
- **着地見込み・単価シミュレーション（0010）**：`lib/calc/forecast.ts` と `lib/calc/simulate.ts`（ともに純関数）。シミュレーションは既存の `calcEntry` / `calcDriverMonth` / `calcCompanyMonth` を呼ぶだけで、独自の計算を書かない。着地見込みは管理費と固定費を按分しない
- 川島幹太はオーナー本人：支払単価 0・率 0%・管理費 0 が正常（警告を出さない）
- **AI（0011）**：`ANTHROPIC_API_KEY` があるときだけ有効（`isAiInsightsEnabled()`）。渡すのは `lib/ai/context.ts` が作る集計 JSON だけ（個人情報は入れない）。月次分析は `ai_insights`（`kind='monthly'`・`summary`・`findings`・`actions`）に保存、相談は `ai_conversations` / `ai_messages`。応答の取り出しは `lib/ai/findings.ts` の `extractInsight` / `normalizeInsight` を使う（独自パースを書かない）
- **社内チャット（0011）**：`chat_channels` / `chat_messages` / `chat_reads`。**閲覧者を含むスタッフ全員**が読み書きできる（ドライバーは不可）。発言は RPC `chat_post(p_channel_id, p_body, p_mentions uuid[])`、既読は `chat_mark_read`。発言者名は `chat_messages.author_name` にトリガーが写す（閲覧者は他人の `profiles` を読めないため）
- **異常の検知（0011）**：RPC `detect_anomalies(month)` が 11 種類の異常を `alerts` に記録する（`fingerprint` で二重に作らない。直った異常は自動で `resolved`）。状態変更は `set_alert_status`。検知のルールを足すときは DB 側に足す（画面側で判定を書かない）
- **外部連携（0011）**：`integrations`（設定）と `integration_secrets`（トークン等。**RLS ポリシー無し＝サービスロール専用**。`lib/integrations/secrets.ts` 経由でのみ触る）、`integration_logs`（実行記録）。LINE は `drivers.line_user_id` / `profiles.line_user_id` と 8 桁の `line_link_codes`（Webhook が `line_consume_code` で結びつける）
- **銀行 CSV（0011）**：`lib/bank/csv.ts` が文字コードと列を自動判定して `bank_transactions` に入れる（`fingerprint` で二重取り込みを防ぐ。入金 ＋／出金 −）。消込は RPC `bank_auto_match` / `bank_match_invoice` / `bank_set_status`（請求書の状態も合わせて変わる）
- **運行管理と法令対応（0012）**：2025 年 4 月施行の貨物軽自動車運送事業の安全対策に対応する。`daily_reports`（業務前点呼・業務後点呼・業務記録。1 日 1 件・1 年保存）、`work_day_entries`（日別の稼働。**status='approved' の合計がトリガーで月次の `work_entries.qty` になる**。日別由来の行は `work_entries.qty_source='daily'` で、画面から数量を直接変えない）、`vehicles` / `documents`（免許証・車検・自賠責・任意保険・健康診断の期限）、`safety_managers` / `driver_instructions` / `incidents`。締め済み月は日報も日別の稼働も DB トリガーが拒否する
- 日別 → 月次の反映は `sync_work_entry_from_days`（トリガー）と RPC `apply_day_entries(month)` だけで行う。提出は `submit_day_entries`、承認・差戻しは `approve_day_entries`
- **取り込みと採用・契約（0013）**：`import_profiles`（元請の実績ファイルの列と名前の対応を覚える）／`import_runs`、`expenses.receipt_path` と `expenses.ocr`（レシート画像と AI の読み取り結果。画像は Storage の `receipts` バケット）、`applicants` / `applicant_events`（段階が変わると履歴をトリガーが残す）、`contracts`（`period_status` が `renewal` / `expired` のものをアラートに出す）
- **法人の経営管理（0014）**：`drivers` の振込先口座（`bank_code` 4 桁・`branch_code` 3 桁・`account_type`・`account_number` 7 桁まで・`account_holder_kana` 半角カナ）と `companies` の `fiscal_month`（決算月）・`fb_*`（全銀の依頼人情報）。`tax_tasks`（決算・税務の期限。RPC `ensure_tax_tasks(年)` が `companies.fiscal_month` から 10 件を作る。`(company_id, kind, due_on)` が一意なので二重に作らない）。`loans` / `loan_payments`（RPC `generate_loan_schedule(loan_id)` が元利均等で作り直す。端数は最終回でまとめ、`paid_on` が入った回は残す）。`cash_forecast` は `status <> 'planned'` の借入の返済を `kind='loan'` として支払（マイナス）で返す
- **経営指標（0014）**：ビュー `v_month_kpi`。限界利益 ＝ 粗利 ＋ ロイヤリティ − 変動費、正味の固定費 ＝ 固定費 − 管理費 − 利益計上の調整、損益分岐点売上高 ＝ 正味の固定費 ÷ 限界利益率。ほかに支払比率・1 人当たり売上／利益・稼働 1 日当たり売上・予算達成率。`month_targets` に `expense_target` と `driver_target` を追加
- **バックアップと復元（0015・0018）**：`export_backup`（version 5）は 0012〜0014 のテーブル（車両・書類・日報・日別の稼働・安全管理者・指導・事故・取り込み定義・応募者・契約・税務の期限・借入と返済予定・元請の支払通知）も書き出す。**外部連携のトークン・社内チャット・AI の履歴・監査ログ・アラートは含めない**。`import_backup` は同じ順序で復元し、二度実行しても増えない。Storage のファイル（ロゴ・認印・レシート・契約書）は JSON に入らないためパスだけ戻る
- **契約書の保管（0014）**：Storage `contracts/<company_id>/…`（非公開）。締結済みの業務委託契約書を登録して保管する（新規作成はしない）。書き込みはサービスロール、表示は `/api/contract-file?id=<contract_id>`
- **会社を明示する RPC（0017）**：`cash_forecast` / `rate_diffs` は RLS 頼りで会社を絞っていたため、サービスロールの definer から呼ぶと全社が混ざった。実体を `cash_forecast_for(company_id, from, to)` / `rate_diffs_for(company_id, month)`（**サービスロール専用**）に移し、入口の 2 つは権限を確認して自社ぶんを返す
- **毎朝の自動チェック（0016）**：`detect_anomalies(p_month)` は権限を確認して `detect_anomalies_core(p_company_id, p_month)`（**サービスロール専用**。ログイン中のユーザーからは呼べない）を呼ぶだけになった。Vercel の Cron（`/api/cron/daily`）が会社ごとに当月を検知し、24 時間以内に出た重大な未対応を LINE 連携済みのスタッフへ知らせる（`CRON_SECRET` が必要）
- **労務・安全（0018）**：日報の `start_at` / `end_at` / `break_minutes` から `v_daily_labor` が 拘束時間（終了 − 開始）・実働（拘束 − 休憩）・休息期間（当日の開始 − 前回の終了）・連続勤務日数を出す。判定の基準は `companies.labor_*`（既定は改善基準告示に合わせた目安：拘束 13 時間／上限 15 時間、休息 11 時間／下限 9 時間、月 284 時間、連続 13 日）で会社ごとに変えられる。月のまとめは `v_driver_month_labor`
- **元請の支払通知との突合（0018）**：`payment_notices` / `payment_notice_items` に元請の支払通知書を取り込み、`v_payment_notice_diff` が自社の売上（`v_work_entry_calc`）と案件内容ごとに比べる。明細の `project_item_id` は RPC `match_notice_items(notice_id)` が名前の一致（`normalize_name` で空白と記号を無視）で埋める。金額が 0 の明細はトリガーが 数量 × 単価 で埋める
- 異常の検知は 24 ルール（0011 の 11 ＋ 0012 の 5 ＋ 0014 の 4 ＋ 0018 の 4：拘束時間が長い日・休息の不足・連続勤務の超過・支払通知との差）。**再発したアラートは「未対応」に戻る。「対象外」にしたものは戻らない**
- ロール：owner（すべて）／admin（登録・編集・月締め・出力）／viewer（閲覧・CSV・チャット・AI 相談）／driver（自分の締め済み月の明細、今日の報告（点呼・稼働）、自分の書類・車両・契約）

## supabase-js の使い方の制約（E2E 用の互換テストサーバーが対応する範囲に限定する）
- `from(table|view).select("col, col2" | "*")` — **埋め込みリソース（`drivers(name)` など）は使わない**。名称が必要なら `v_*` ビューを使う
- ビューは原則 `security_invoker = true`。例外は `v_staff` だけで、閲覧者が他人の `profiles` を読めないため invoker にせず、ビューの中で会社とロールを必ず絞り込んでいる
- フィルタ：`eq / neq / gt / gte / lt / lte / in / is / like / ilike / or（単純な eq の組み合わせのみ）`、`order / limit / range`、`single / maybeSingle`、`{ count: "exact" }`
- 書き込み：`insert / upsert({ onConflict }) / update().eq() / delete().eq()` と `.select()` で戻り値取得
- RPC：`rpc("name", { p_xxx })`。引数はスカラー・JSON（jsonb）・スカラーの配列（`uuid[]` など。`p_entry_ids: string[]`）まで。**JS の配列は Postgres の配列として渡るので、配列を受ける引数は `uuid[]` / `text[]` にする（jsonb にしない）**
- Auth：`getUser / signInWithOtp / signInWithPassword / verifyOtp / exchangeCodeForSession / signOut / updateUser / resetPasswordForEmail`、admin：`createUser / listUsers / generateLink / getUserById / updateUserById`
- Storage：`from("backups").upload / createSignedUrl / list / download`
