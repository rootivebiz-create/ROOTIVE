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
- `lib/voice/` 声で入力（`parse.ts` 純関数の解析・`speech.ts` 音声認識の包み）
- `lib/dispatch/` 配車（`board.ts` 純関数の週のボード・過不足・自動割り当て・見通し・`queries.ts` サーバー専用の読み取り）
- `lib/compliance/` 法令対応（`helpers.ts` 純関数の不足のまとめ・台帳の記入率・`queries.ts` サーバー専用の読み取り）
- `lib/office/` 事務（`desk.ts` 純関数の今日やること・今日の報告・月締めの手順・`queries.ts` サーバー専用の読み取り）
- `lib/push/` 通知（`targets.ts` 純関数の宛先と文面・`config.ts` VAPID・`send.ts` 送信・`client.ts` ブラウザ側の購読・`notify-chat.ts` / `notify-daily.ts` 実際の通知）
- `lib/alerts/` `lib/chat/` `lib/bank/` `lib/integrations/` `lib/daily/` `lib/fleet/` `lib/intake/` `lib/hr/` `lib/executive/`（代表：読み取り `queries.ts`・信号 `cockpit.ts`・現金の残り日数 `runway.ts`・予実の分解 `variance.ts`・朝のひとこと `brief.ts`） 各機能の純関数とサーバー専用の処理
- `lib/db/database.types.ts` supabase-js 用の型（自動生成）、`lib/db/types.ts` 型エイリアス、`lib/db/queries.ts` 共通クエリ
- `lib/auth/session.ts` セッション・ロール確認（`requireStaff` / `requirePageRole` / `requireAdminAction` など）
- `lib/actions/*.ts` Server Actions（`"use server"`）、`lib/actions/result.ts` 共通の `ActionResult` / `runAction` / エラー変換
- `lib/schemas/*.ts` zod スキーマ（サーバー・クライアント共用）
- `lib/month.ts` 稼動月ユーティリティ、`lib/format.ts` 表示書式（円・%・数量）
- `components/ui/*` UI 部品（shadcn/ui 相当）、`components/layout/*` シェル・ナビ・月セレクタ
- `app/(app)/*` スタッフ画面（ホーム・稼働・支払・請求・経費・資金繰り・案件・レポート・ドライバー別の採算・設定）、`app/driver/*` ドライバーポータル、`app/(auth)/*` ログイン・招待、`app/api/export/*` 出力
- `supabase/migrations/*.sql` スキーマ（0001 テーブル、0002 認証・RLS、0003 ビュー、0004 RPC、0005 ポータル・初期データ、0006 Storage・権限、0007 ドライバー別単価（bill_rate 上書き・rate_diffs・apply_master_rates）、0008 消費税・ロゴと認印・ドライバーごとの支払日、0009 経費と営業利益・取引先と請求書・月次目標、0010 資金繰り・案件別採算、0011 AI チャット・社内チャット・異常検知・外部連携、0012 運行管理と法令対応（点呼・業務記録・日別の稼働・車両・書類）、0013 取り込みと採用・契約、0014 法人の経営管理（振込先口座・決算と税務カレンダー・借入金・経営指標・契約書の保管）、0015 バックアップと復元を全テーブルへ拡張、0016 異常の検知を毎日自動で回す、0017 会社を明示して集計する RPC、0018 労務（拘束時間・休息）と元請の支払通知との突合、0019 代表（決裁・意思決定ログ・会社の台帳・中期計画・ログインの記録）、0020 代表の守り（機密の隔離・決裁のルールと委任・持ち出しの記録・計画の配分・振込口座の分離）、0021 表示を速くする（me / nav_badges）、0022 通知（端末への通知の購読・受け取り方の設定）、0023 配車・シフト（必要人数・割り当て・休み希望・定休日）、0024 法定帳票（運転者台帳・適性診断・保存期間・監査で足りないもの）、0025 使ってみて気づいた直し（台帳の出力を機密に・LINE 連携の復元・ダッシュボードの 1 往復）、0026 事務（月締めの手順のチェック・今日の報告の催促・最初に開く画面・office_desk））
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
- **オフライン対応**：`public/sw.js`（自前の Service Worker）と `lib/offline/`。ナビゲーションは network first、静的アセットは cache first、**GET 以外・`/api/*`・別オリジン・RSC は素通し**（Server Action を触らない）。ドライバーの「今日の報告」は送信に失敗すると IndexedDB のキューに入り、オンライン復帰・30 秒間隔・タブ復帰で自動送信する。締め済み・権限・入力の誤りは再試行せず、セッション切れやサーバー不調は捨てずに残す。点呼の時刻は入力した瞬間の時刻を持たせる
- **週次の経営サマリー**：`lib/weekly/`（純関数）と `lib/ai/weekly.ts`。`ai_insights` に `kind='weekly'` で保存（週は `summary` の先頭に `[YYYY-MM-DD〜YYYY-MM-DD]` を付けて識別）。`/api/cron/weekly` が毎週月曜の朝に作って LINE へ送る。`ANTHROPIC_API_KEY` が無くても `weeklyHighlights` の数字だけで成立する。**ダッシュボードの AI カードは `kind='monthly'` で絞る**
- **見積シミュレーション**：`lib/calc/quote.ts`。既存の `calcDriverMonth` / `calcCompanyMonth` に通すだけで独自の丸めを書かない。営業利益 0 になる受注単価・目標利益率を満たす最低の受注単価・支払単価の上限を式で逆算する（二分探索を書かない）
- **書類の検索（電子帳簿保存法）**：`/records` と `lib/records`。レシート（`expenses.receipt_path`）・請求書・支払通知・契約書を 1 つにまとめ、**取引年月日・取引金額・取引先**で範囲と組み合わせの検索ができる。DB の追加は無く、既存のテーブルとビューから組み立てる（`lib/records/load.ts`）。索引簿は `/api/export/records.csv`
- **元請の支払通知との突合（0018）**：`payment_notices` / `payment_notice_items` に元請の支払通知書を取り込み、`v_payment_notice_diff` が自社の売上（`v_work_entry_calc`）と案件内容ごとに比べる。明細の `project_item_id` は RPC `match_notice_items(notice_id)` が名前の一致（`normalize_name` で空白と記号を無視）で埋める。金額が 0 の明細はトリガーが 数量 × 単価 で埋める
- 異常の検知は 24 ルール（0011 の 11 ＋ 0012 の 5 ＋ 0014 の 4 ＋ 0018 の 4：拘束時間が長い日・休息の不足・連続勤務の超過・支払通知との差）。**再発したアラートは「未対応」に戻る。「対象外」にしたものは戻らない**
- **代表（0019）**：`/executive` 配下は owner 専用（`requirePageRole(["owner"])`）。決裁（`approvals`。申請は admin 以上の RPC `request_approval`、決裁は `decide_approval`）、意思決定ログ（`decisions`）、会社の台帳（`company_profile` / `officers` / `shareholders` / `insurance_policies` / `advisors` / `guarantees`）、中期計画（`plans` / `plan_years`）、ログインの記録（`login_events`。書き込みは `record_login_event` のサービスロール専用、1 年で消える）。**代表専用のテーブルは RLS で `public.is_owner()` を必須にしており、代表以外には 1 行も見えない**（バックアップも RLS が効くので、管理者が書き出すとそのぶんは空になる）
- **代表だけの気づきは `alerts` に出さない（0019）**：`alerts` はスタッフ全員が読めるため、保険・役員・意思決定など代表だけの内容を載せると漏れる。代わりに `v_executive_tasks`（決裁待ち・見直し日・保険の満了・役員の任期・委任の期限）と `v_executive_summary` で代表にだけ出す。`alerts` に足してよいのは全員が見てよい「決裁待ちの滞留（`approval_pending`）」と「出力の急増（`export_burst`）」だけ
- **機密の隔離（0020）**：`companies.confidential_scope`（`loans` / `cash` / `bank_account` を owner / admin / staff の 3 段階。既定はすべて admin）で、借入・納税（`loans` / `loan_payments` / `tax_tasks`）、現金（`cash_snapshots`）、ドライバーの振込口座の見せ方を決める。判定は DB の `can_see_confidential(key)` 1 本（アプリ側は `canSeeConfidential(role, scope, key)`）。**書き込みポリシーが `for all`（＝ select も通す）なので、閉じるときは select と write の両方に判定を入れる**
- **ドライバーの振込口座（0020）**：列単位の RLS が無いため `drivers` から `driver_bank_accounts`（主キー `driver_id`）へ分離した。読み取りは必ずビュー `v_driver_bank` を使う（`drivers` に口座の列はもう無い）
- **決裁のルールと代理決裁（0020）**：しきい値は `approval_rules`（会社を作ると既定 6 件）。判定は RPC `approval_required(kind, amount)` で、**画面や Server Action に金額を手書きしない**。代表が不在のときは `approval_delegations`（期間・上限金額・種別を切った一時的な委任）で admin が決裁でき、`can_decide_approval` が RLS・トリガー・RPC の 3 か所すべてで使われる。代理のときは `approvals.on_behalf_of` に代表が入る。**権限そのものの昇格はしない**
- **持ち出しの記録（0020）**：`export_logs` に CSV・振込データ・バックアップ・明細 PDF の出力を残す（閲覧は代表のみ、書き込みは `record_export` のサービスロール専用、1 年で消える）。**記録に失敗しても出力自体は止めない**
- **中期計画 → 月次目標（0020）**：`spread_plan_year(plan_id, year, 'even' | 'actual')` が年間目標を 12 か月へ配分する（端数は 12 月。手で入れてある月は上書きしない）。承認した申請からは `decision_from_approval` で意思決定ログの下書きを作る（同じ申請から二度は作らない）
- 異常の検知は 29 ルール（0011 の 11 ＋ 0012 の 5 ＋ 0014 の 4 ＋ 0018 の 4 ＋ 0019 の 1（決裁の滞留）＋ 0020 の 1（出力の急増）＋ 0023 の 3（配車））。code は 30 種類
- バックアップは **version 9**。代表のテーブル（0019）・決裁のルール・委任・振込口座（0020）・配車（0023）・適性診断（0024）まで入る。0025 で LINE の連携（`drivers.line_user_id`）も戻すようにした。**外部連携のトークン・社内チャット・AI の履歴・監査ログ・アラート・ログインの記録・持ち出しの記録は含めない**。version 6 以前の `drivers` に入っていた口座も復元できる
- **表示の速さ（0021）**：画面を 1 つ開くたびの Supabase への往復を減らす。
  - `getSessionContext()` は RPC **`me()`** の 1 往復だけ（以前は `getUser()` → `profiles` → `companies` の 3 連続）。
    `me()` は security invoker で、**行が返ること自体が正しいセッションの証明**（PostgREST が JWT を検証する）
  - middleware は `getSession()`（トークンが生きていれば通信しない）。**認可はしない**。UX のための振り分けとトークンの更新だけ
  - ナビのバッジは RPC **`nav_badges()`** の 1 往復にまとめる
  - ⌘K のドライバー・案件・取引先は `/api/command-items` から**最初に開いたとき 1 回だけ**読む（レイアウトから外した）
  - **`app/(app)/loading.tsx` は消さないこと**。これが無いと Next.js が動的ルートをプリフェッチせず、タップしてから画面が固まる
  - `experimental.staleTimes` で一度開いた画面を手元に残す。押した瞬間の反応は `useLinkStatus`（ナビ）と `RouteProgress`（全リンク）
- **LINE で数字を聞ける（0021）**：連携済みのスタッフが公式アカウントに送った文を `lib/line/ask.ts`（純関数。判定と文面）と
  `lib/line/answer.ts`（読み取りと権限）が処理する。**Webhook はサービスロールで動く＝ RLS が効かない**ので、
  すべてのクエリを `company_id` で絞り、ロールと `confidential_scope` の判定をコードで行う。ドライバーには会社の数字を返さない
- **声で稼働を入力（0021）**：`/entries` の「声で入力」。`lib/voice/parse.ts`（**純関数**。言葉 → ドライバー × 案件内容 × 数量）と
  `lib/voice/speech.ts`（Web Speech API の包み。`ja-JP`・逐次結果）。**音声そのものは保存も送信もしない**（文字になった結果だけを扱う）。
  マイクが使えない端末では同じダイアログの文字入力で同じことができる（E2E もこの経路で確かめる）。
  かなはローマ字に直して比べるので「アマゾン」と話しても「Amazon」に当たる。漢数字は**独立した言葉か単位が続くときだけ**数量として読む（「三郷」の「三」を数量にしない）。
  保存は Server Action `quickSetEntriesAction` → 案件内容ごとに既存の RPC `bulk_set_entries`（単価・率・端数処理は DB が現在のマスタから決める。既存行は数量だけ変わる）。
  入口は稼働入力の「声で入力」と ⌘K の「声で稼働を入力」（`/entries?voice=1`）
- **いま動いている版が分かる（0021）**：`buildId()`（`VERCEL_GIT_COMMIT_SHA` の先頭 7 桁）をユーザーメニューに出し、`/api/version` と比べて
  違えば「新しい版があります」の帯を出す。「更新する」でキャッシュと Service Worker を捨てて読み直す（`updateToLatest`）。
  **Service Worker は `/sw.js?v=<版>` で登録する**（URL が変わると入れ直されるので、古いキャッシュが残らない）
- **通知（0022）**：これまで通知はナビの未読バッジだけで、端末には何も届かなかった。3 系統で届ける。
  - **端末への通知（Web Push）**：`push_subscriptions`（端末ごと。**本人しか読み書きできない**。バックアップに含めない）。
    鍵は `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`（**そろっているときだけ機能を出す**。作り直すと既存の購読が全部無効になるので、デプロイのスクリプトは一度作った鍵を作り直さない）。
    送信は `web-push`。404 / 410 が返った購読はその場で消す
  - **LINE への転送**：**自分あて（メンション）のときだけ**送る（全部流すと読まれないし通数も食う）。承認・差戻しの結果はドライバー本人へ必ず送る
  - **アプリ内**：ベルが `/api/nav-badges` を 60 秒ごと・タブ復帰で見に行き、未読が増えたらトーストで知らせる
  - 受け取り方は `profiles.notify_chat`（`all` / `mention`（既定） / `off`）と `profiles.notify_line`。判定は純関数 `shouldNotifyChat` / `shouldNotifyLine` に集約し、画面や DB に条件を散らさない
  - 送信は Server Action の中で待たない。**`after()`** で返事を返したあとに送り、失敗しても本来の操作（発言・承認）は成立させる
  - Service Worker の `push` は**必ず通知を出す**（黙って受け取ると iOS が購読を止める）。iPhone は「ホーム画面に追加」した状態でしか購読できないため、画面でそう案内する
- **配車・シフト（0023）**：これまで扱えなかった「これから先の予定」。**予定と実績は分けたまま**にし、配車から実績（`work_day_entries`）を作らない（作ると「予定していたのに報告が無い」を検知できなくなる）。
  - 必要人数は `project_demands`（曜日のパターン）と `project_demand_days`（特定の日。**曜日より優先**）。解決は純関数 `needFor`
  - 割り当ては `dispatch_assignments`（日 × ドライバー × 案件内容で一意）。書き込みは RPC `set_dispatch_bulk`（qty_plan が 0 以下なら外す。数量が変わると `notified_at` を外して知らせ直す）／`copy_dispatch_week`（承認済みの休みの日は写さない）／`confirm_dispatch`
  - 休みは `driver_day_offs`（本人が `request_day_off`、管理者が `decide_day_off`。過ぎた日は申請できない hint `PAST_DATE`）と `drivers.weekly_off`（定休日の曜日）
  - **自動割り当て（`autoAssign`）は提案だけで保存しない**。承認済みの休みと定休日を外す → その案件の経験 → 割り当ての少ない人 → 名前の順で、**同じ入力なら必ず同じ結果**になる
  - ダッシュボードは配車表と同じ読み方をしない。ビュー **`v_dispatch_outlook`**（今日から 14 日・日ごとに 1 行）を `summarizeOutlook` でまとめる（2 往復）
  - 確定した翌日ぶんは `/api/cron/dispatch`（毎日 18:00 JST）が本人へ通知・LINE で知らせる（`lib/push/notify-dispatch.ts`）
  - 異常の検知は 29 ルール（0023 の 3：人が足りない日・予定はあるのに報告が無い・休み希望が決まっていない）。バックアップは **version 8**
- **法定帳票と監査（0024）**：「監査で記録を出してください」に 1 画面（`/compliance`）と 1 つの ZIP で答えられるようにする。
  - 運転者台帳は `drivers` の項目（`roster_no` / `birth_date` / `address` / `hired_on` / `appointed_on` / `retired_on` / `license_kinds` / `license_conditions`）＋ ビュー **`v_driver_roster`**。
    **免許証の番号と有効期限は `documents`（`kind='license'`）から引く**（二重に持たない）
  - 適性診断は `aptitude_tests`（初任・適齢・特定・一般）。入力は 設定 → 安全管理
  - 保存期間は `companies.retention_*` と `aptitude_age_*` / `health_check_months`（会社ごとに変えられる）。まとめは **`v_record_retention`**。
    **期限が過ぎた記録を自動で消さない**（消してよいかは会社が決める）
  - 監査で足りないものは **`v_compliance_gaps`**（台帳の記入漏れ・免許なし・初任の指導／診断なし・指導が 1 年以上なし・健康診断・適齢診断）。
    **期限切れの書類と点呼の漏れは 0012 の `alerts` が拾うので、ここには入れない**（二重に出さない）
  - 出力は `/api/export/compliance.csv`（`kind=roster|instruction|incident|aptitude`）・`/api/export/roster.pdf`（1 人 1 ページ）・
    `/api/export/audit-pack.zip`（一式 ＋ README）。名前は `v_driver_instruction_list` / `v_incident_list` / `v_aptitude_list` から引く
  - バックアップは **version 9**（適性診断まで。台帳の項目は `drivers` の行に入る）。0023 で戻していなかった `weekly_off` もここで戻すようにした
- **使ってみて気づいた直し（0025）**
  - **持ち出しの記録は種別で決まる**：`record_export` の `sensitive` のリストに入っている種別だけが機密として数えられ、
    「出力の急増」のアラートもそれしか見ない。**個人情報を含む出力を足したら、必ずこのリストにも足す**
    （0024 の運転者台帳は `kind='other'` のままで、生年月日・住所・免許証番号が入っているのに機密ではなかった）。
    いまのリスト：`transfer` / `backup` / `statements` / `statement` / `drivers` / `month-pack` / `records` / `roster` / `compliance`
  - **会社設定（`companies`）の更新は RLS でオーナーのみ**。`requireAdminAction` で入口だけ通しても DB が 0 行で返すため、
    管理者には「保存できるのに必ず失敗する」画面になる。会社設定を触る Server Action は `requireOwnerAction`、画面も `isOwner` で閉じる
  - **ダッシュボードのカードは RPC `dashboard_cards(month)` の 1 往復**（書類・応募者・契約・日報の状況・アラートの件数と上位 3 件）。
    **返すのは行だけで、件数や期限の判定は今までどおりアプリの純関数**（`toFleetDocument` / `hrCounts` ほか）。SQL 側に判断を移さない
  - **サイドナビの見出しは畳める**（`groupNavItems` / `isGroupOpen` / `toggleNavGroup` は純関数）。
    既定はすべて開いたまま。畳んだ見出しは端末ごとに覚える（`localStorage`。読めなくても全部開くだけ）。
    **いま開いている画面が入っている見出しは、畳んでいても開く**
  - 日付まわり（`isDateString` / `emptyToNull` / `optionalDateSchema` / `optionalIdSchema`）は **`lib/schemas/common.ts` が正**。
    expenses / hr / finance は再輸出するだけ（請求書だけはメッセージを 2 種類に分けているため `dateSchema` を自前で組み立てる）
- **事務（0026）**：`/office`（owner / admin。`requirePageRole(["owner", "admin"])`）。散らばっていた事務の仕事を 1 画面にまとめる。
  - 読み取りは RPC **`office_desk(month, today)`** の 1 往復だけ（行と数だけを返す）。**並べ方と判定は `lib/office/desk.ts` の純関数**
    （`buildInbox` 今日やること／`todayReporters` 今日の報告／`buildClosingSteps` 月締めの手順）。月を省くと DB が「締めていない一番古い過去の月、無ければ今月」を選ぶ
  - その場での承認・休み希望・自動消込・毎月の経費の計上・配車の確定・月締めは**既存の Server Action をそのまま呼ぶ**（事務のために足さない）
  - 「今日の報告」が要る人：その日に配車があれば配車に入っている人、無ければ定休日でない全員（どちらも承認済みの休みを除く）。点呼か稼働があれば報告済み
  - 催促は `record_report_reminders`（`report_reminders`。**1 人 1 日 1 回まで**、返るのは今回初めて催促した人だけ）→ `after()` で端末への通知 ＋ LINE（`lib/push/notify-remind.ts`）
  - 月締めの手順のうちアプリが判定できないもの（支払明細の送付・振込）は `month_close_checks`（`set_close_check`。付けた人の名前が残る。**締めた月は番人が拒否**）。
    手の手順の名前は `MANUAL_CLOSE_STEPS` にだけ足す（Server Action は `isManualCloseKey` で弾く）
  - 最初に開く画面は `profiles.start_page`（`dashboard` / `office`。`set_start_page`。事務は admin 以上だけ）。`/` とログイン後の既定の行き先が振り分け、
    事務の人はスマホの下タブの先頭とロゴの行き先も事務になる（`bottomItemsFor(variant, role, startPage)`）
  - ナビのバッジ `nav_badges().office`＝承認待ちの稼働報告 ＋ 休み希望（admin 以上だけ）。ベルは増えたらトーストで知らせる
  - `month_close_checks` / `report_reminders` はバックアップに含めない（運用の記録。データ全削除では消す）
- **新しいテーブルには必ず権限を出す**：0020 の末尾にある `grant ... on all tables in schema public to authenticated` は**そのあとの番号で作ったテーブルには届かない**。`security invoker` の RPC は RLS の手前で `permission denied` になる。テーブルを足したマイグレーションの末尾で grant を出し直すこと（`tests/sql/run.sh` が 1 回目の適用直後に抜けを検出する）
- ロール：owner（すべて ＋ `/executive` の決裁・意思決定・会社の台帳・中期計画・守り）／admin（登録・編集・月締め・出力・代表への申請・`/office` の事務）／viewer（閲覧・CSV・チャット・AI 相談。借入・納税・現金・振込口座は既定で見えない）／driver（自分の締め済み月の明細、今日の報告（点呼・稼働）、自分の予定と休みの申請、自分の書類・車両・契約）

## supabase-js の使い方の制約（E2E 用の互換テストサーバーが対応する範囲に限定する）
- `from(table|view).select("col, col2" | "*")` — **埋め込みリソース（`drivers(name)` など）は使わない**。名称が必要なら `v_*` ビューを使う
- ビューは原則 `security_invoker = true`。例外は `v_staff` だけで、閲覧者が他人の `profiles` を読めないため invoker にせず、ビューの中で会社とロールを必ず絞り込んでいる
- フィルタ：`eq / neq / gt / gte / lt / lte / in / is / like / ilike / or（単純な eq の組み合わせのみ）`、`order / limit / range`、`single / maybeSingle`、`{ count: "exact" }`
- 書き込み：`insert / upsert({ onConflict }) / update().eq() / delete().eq()` と `.select()` で戻り値取得
- RPC：`rpc("name", { p_xxx })`。引数はスカラー・JSON（jsonb）・スカラーの配列（`uuid[]` など。`p_entry_ids: string[]`）まで。**JS の配列は Postgres の配列として渡るので、配列を受ける引数は `uuid[]` / `text[]` にする（jsonb にしない）**
- Auth：`getUser / signInWithOtp / signInWithPassword / verifyOtp / exchangeCodeForSession / signOut / updateUser / resetPasswordForEmail`、admin：`createUser / listUsers / generateLink / getUserById / updateUserById`
- Storage：`from("backups").upload / createSignedUrl / list / download`
