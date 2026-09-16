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
│  app/api/export/*                     CSV / 弥生 CSV / PDF / バックアップ JSON      │
│  app/api/cron/keepalive               Vercel Cron（毎日）→ Supabase 一時停止の防止     │
│  middleware.ts                        セッション Cookie 更新・未ログインを /login へ   │
│                                                                      │
│  lib/calc        計算（純関数・BigInt で誤差なし）  lib/actions  Server Actions        │
│  lib/auth        セッション・ロール確認          lib/schemas  zod スキーマ           │
│  lib/statement   明細データ組み立て            lib/pdf      @react-pdf/renderer     │
│  lib/yayoi       弥生仕訳 CSV                 lib/migrate  試作 JSON 変換（uuid v5） │
│  lib/supabase    server（RLS 適用）/ admin（service_role、サーバー専用）             │
└───────────────┬──────────────────────────────────────────────────────┘
                │ supabase-js（anon キー + ユーザー JWT → RLS 適用）
                │ service_role キー（招待・招待リンクログイン・バックアップ保存・ユーザー管理のみ）
┌───────────────▼──────────────────────────────────────────────────────┐
│ Supabase（東京 ap-northeast-1）                                            │
│  PostgreSQL  テーブル / 集計ビュー v_* / RPC / トリガー（締めガード・監査・招待制）     │
│  Auth        メール + マジックリンク / パスワード、招待制（auth.users INSERT トリガー）│
│  Storage     backups バケット（非公開）：締め時バックアップ JSON                     │
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
| 受注単価 | 案件内容.bill_rate |
| 支払単価 | driver_pay_overrides → 案件内容.pay_rate |
| ロイヤリティ率 | drivers.royalty_rate → companies.default_royalty_rate |
| 端数処理 | drivers.rounding_mode → companies.rounding_mode |
| 管理費 | driver_months.mgmt_fee（初回作成時に drivers.mgmt_fee を複写） |

保存後は稼働行の値（スナップショット）が正となり、マスタ変更の影響を受けません。

---

## 3. データモデル（`supabase/migrations/0001_schema.sql`）

主キー uuid、全テーブルに `company_id`（RLS で分離。将来の多社対応）。金額 numeric(12,2)、率 numeric(6,4)（0.1 = 10%）、時刻 timestamptz、稼動月は月初日の date。

| テーブル | 主要列 | 備考 |
|---|---|---|
| `companies` | name, rounding_mode, default_royalty_rate, default_mgmt_fee, payout_month_offset(0..3), payout_day(0=末日), statement_note, invoice_reg_no, address, tel, driver_portal_show_royalty, yayoi_accounts(jsonb) | 会社設定 |
| `profiles` | id(=auth.users.id), company_id, email, display_name, role, driver_id, is_active | auth.users と 1:1。driver ロールは driver_id 必須 |
| `invitations` | email, role, driver_id, display_name, token(unique), expires_at(既定 7 日), accepted_at, cancelled_at, link_used_at, invited_by | 招待。token は 24 バイト乱数 hex |
| `drivers` | name(会社内 unique), kana, is_active, royalty_rate(null=会社既定), mgmt_fee, rounding_mode(null=会社既定), phone, email, bank_info, memo, sort_order | |
| `projects` | name(unique), client_name, is_active, memo, sort_order | 案件 |
| `project_items` | project_id(restrict), name(既定「標準」, project 内 unique), unit(day/piece), bill_rate, pay_rate, is_active, sort_order | 内容（単価区分） |
| `driver_pay_overrides` | pk(driver_id, project_item_id), pay_rate | ドライバー個別支払単価 |
| `driver_recurring_adjustments` | driver_id, label, amount, count_as_profit, is_active, sort_order | 固定控除（毎月自動複写） |
| `work_entries` | month, driver_id(restrict), project_item_id(restrict), qty≥0, bill_rate, pay_rate, royalty_rate(0..1), rounding_mode, memo, created_by, updated_by | 稼働行。index (company_id,month) (driver_id,month) (project_item_id,month) |
| `driver_months` | month, driver_id, mgmt_fee, memo, unique(company_id,month,driver_id) | ドライバー × 月 |
| `adjustments` | driver_month_id(cascade), label, amount(符号付き), count_as_profit, recurring_id, sort_order | 調整 |
| `month_closings` | pk(company_id,month), status(open/closed), closed_at/by, reopened_at/by, snapshot(jsonb), backup_path, note | 月締め |
| `audit_logs` | actor_id, action, table_name, record_id, before, after, created_at | 監査。書き込みはトリガーのみ |
| `ai_insights` | month, model, findings(jsonb), created_by | AI 月次分析の保存 |

### ビュー（`0003_views.sql`、`security_invoker = true`：呼び出し元の RLS が適用）

| ビュー | 内容 |
|---|---|
| `v_work_entry_calc` | 稼働行 + bill/pay/margin/royalty/entry_profit + ドライバー名・案件名・内容名・区分 |
| `v_driver_month_summary` | driver_months ∪ work_entries を基点に、稼働合計・調整・mgmt_fee（計上条件適用）・payout・driver_profit・is_closed |
| `v_month_summary` | 会社 × 月（driver_count, entry_count, bill, pay, margin, royalty, mgmt_fee, adj_*, payout, profit, profit_rate, status, closed_at, backup_path） |
| `v_project_summary` | 案件内容 × 月（entry_count, driver_count, qty_total, bill, pay, margin, royalty, entry_profit, profit_rate） |
| `v_month_list` | データがある月の一覧（月セレクタ・月締め画面用） |

### RPC（`0004_rpc.sql`、`0005_portal_seed.sql`）

| 関数 | 権限 | 内容 |
|---|---|---|
| `entry_defaults(driver_id, project_item_id)` | staff | §2.5 の自動入力値 |
| `copy_previous_month(month)` | admin+ | 前月の稼働行を数量 0 で複製（現在のマスタから単価を再取得。停止中は除外。冪等） |
| `bulk_set_entries(month, project_item_id, rows)` | admin+ | 一括入力（既存は数量更新、0 は削除、新規はマスタから作成） |
| `month_snapshot(month)` | staff | 締め時スナップショット JSON（summary / drivers / entries / adjustments / projects） |
| `close_month(month, note)` | admin+ | month_closings を closed に upsert しスナップショット保存。監査記録 |
| `set_month_backup_path(month, path)` | admin+ | Storage へ保存したバックアップのパスを記録 |
| `reopen_month(month)` | owner | closed → open。監査記録 |
| `export_backup()` | admin+ | 全テーブルのバックアップ JSON（§8.4） |
| `import_backup(jsonb)` | owner | 復元・取り込み。ID 一致は上書き、他社 ID と衝突すれば拒否。締めガード・行単位監査を一時回避し、まとめて 1 件の監査を記録 |
| `reset_company_data(会社名)` | owner | データ全削除（会社設定・ユーザー・招待は残す。driver ユーザーは無効な viewer に） |
| `seed_initial_data(with_entries)` | admin+ | §8.6 の初期データ（ドライバーが 0 件の会社のみ） |
| `create_invitation(email, role, driver_id, display_name)` | owner | 招待作成（同メールの未受諾招待は取消） |
| `apply_invitation(user_id, email)` | security definer | 招待を照合して profiles を作成／更新（auth トリガーと招待リンクログインの両方から使用） |
| `driver_portal_months()` / `driver_portal_statement(month)` | driver | 本人の締め済み月一覧・明細（会社売上・利益は含めない。率の表示は会社設定に従う） |
| `current_company_id()` / `current_app_role()` / `current_driver_id()` / `is_owner()` / `is_admin()` / `is_staff()` / `is_driver_user()` / `is_month_closed()` | ヘルパー | security definer で profiles を参照（is_active 必須） |

### トリガー（`0001` / `0002`）

| トリガー | 対象 | 内容 |
|---|---|---|
| `t00_set_updated_at` | 主要テーブル | updated_at 自動更新 |
| `t01_fill_company_id` | 子テーブル | 親から company_id を補完し、不一致なら拒否 |
| `t02_check_driver_company` | profiles / invitations | driver_id が同じ会社か |
| `t03_set_entry_actor` | work_entries | created_by / updated_by = auth.uid() |
| `t05_guard_month_closed` | work_entries / driver_months / adjustments | 対象月が closed なら INSERT/UPDATE/DELETE を拒否（hint `MONTH_CLOSED`。`app.bypass_closing` で復元時のみ回避） |
| `t10_protect_profile` | profiles | role / company_id / is_active / driver_id / email は owner のみ。自分自身のロール変更・無効化は不可 |
| `t10_protect_month_closings` | month_closings | closed → open と削除は owner のみ |
| `t20_ensure_driver_month` | work_entries | driver_months が無ければ作成（mgmt_fee = drivers.mgmt_fee）し、有効な固定控除を adjustments に複写 |
| `t90_audit` | 主要 12 テーブル | INSERT/UPDATE/DELETE を audit_logs に記録（差分の無い UPDATE は除外。invitations.token と month_closings.snapshot は除外） |
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

### 4-2. 二重チェックの考え方

1. **UI**：viewer・締め済み月・driver には編集 UI を表示しない（`canEdit()` / `isMonthClosed()`）。
2. **Server Action / Route Handler**：`requireAdminAction()` などでセッション + ロールを確認 → zod 検証 → DB 操作。例外は `translateError()` で日本語へ。
3. **DB（RLS + トリガー + RPC 内の権限チェック）**：全テーブル `company_id = current_company_id()`。書き込みは `is_admin()`、companies / invitations の更新は `is_owner()`。driver は work_entries / driver_months / adjustments を「自分かつ締め済み月」のみ SELECT、drivers・projects・project_items は自分に関係する行のみ。audit_logs は admin+ のみ SELECT、書き込みはトリガー（security definer）のみ。anon には一切の権限を与えない（`0006_storage_grants.sql` で revoke）。
4. 無効化されたユーザー（`profiles.is_active = false`）はヘルパー関数が null を返すため、すべての RLS で不一致となり何も見えません。

### 4-3. サービスロール（`lib/supabase/admin.ts`）

`SUPABASE_SERVICE_ROLE_KEY` は RLS を無視できるため、**サーバー専用**で用途を次に限定しています。

- 招待リンクの表示・受諾（`invitations` の参照、`auth.admin.createUser` / `generateLink`、`apply_invitation`）
- ユーザー管理（`auth.admin.listUsers` / `updateUserById`、無効化）
- 月締め時のバックアップ JSON を Storage へ保存、署名付き URL の発行

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
| 弥生仕訳 CSV | `app/api/export/yayoi.csv` + `lib/yayoi/{accounts,build}.ts` | Shift_JIS（iconv-lite）、25 列、ヘッダー無し。売上：売掛金／売上高、外注費：外注費／未払金、ロイヤリティ・管理費・利益計上の調整：未払金／雑収入（補助科目）、利益計上なしの調整：立替金。科目・税区分・ドライバー分割・伝票日付は `companies.yayoi_accounts` で変更可 |
| PDF 支払明細 | `app/api/export/statement.pdf` + `lib/pdf/statement.tsx` | A4 縦、Noto Sans JP（`public/fonts`）、日本語の禁則処理付き折り返し。会社利益は載せない。`vercel.json` で maxDuration 30 秒 |
| 印刷用ページ | `/payouts/[driverId]/print` | ブラウザ印刷 |
| LINE 用テキスト | `lib/statement/statementToText()` | 会社利益を含まない |
| バックアップ JSON | `app/api/export/backup.json` → `export_backup()` | §8.4 の形式 |

明細のデータ組み立ては `lib/statement/index.ts` に集約し、画面・PDF・CSV・テキスト・ドライバーポータルで共用しています。

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
| 単体（Vitest） | `npm test` | `lib/calc`（§2.6 の全ケース、誤差 0.01 円以内、端数処理 4 種、恒等式）、zod スキーマ、`lib/migrate` の変換と決定的 ID |
| SQL 結合（psql） | `npm run test:sql` | ローカル PostgreSQL に `tests/sql/auth_stub.sql`（auth.uid() 等のスタブ）+ 全マイグレーションを適用し `tests/sql/test.sql` を実行。ビューの計算が §2.6 と一致、RLS（viewer / driver の拒否）、締めガード、招待制、復元・全削除 |
| E2E（Playwright） | `npm run test:e2e` | Supabase 互換のテストサーバー（`supabase-lite`：PostgreSQL + GoTrue 相当 + PostgREST 相当の軽量実装）を自動起動し、iPhone 13 と Desktop Chrome の 2 プロジェクトで主要導線（招待ログイン → ダッシュボード → 稼働追加・複製・一括入力 → 支払明細・PDF → 設定 → 月締め・解除 → 閲覧者／ドライバーの権限 → 移行 JSON の取り込み）をブラウザで確認。8 spec・30 シナリオ × 2 プロジェクト = **60 件**。スクリーンショットを `docs/screenshots/` に保存。詳細は [docs/E2E.md](E2E.md) |
| 静的 | `npm run typecheck` / `npm run lint` / `npm run build` | 型・Lint・本番ビルド |
| まとめ | `npm run check` | typecheck + lint + test + build:sql |

supabase-js の使い方は、E2E 用の互換サーバーが対応する範囲（埋め込みリソースを使わない、単純なフィルタ、`rpc`、限られた auth / storage API）に限定しています（[CLAUDE.md](../CLAUDE.md) 参照）。

---

## 10. 既知の制限

1. **driver ロールが自分の稼働行の `bill_rate`（受注単価）を API 経由で読める**：`work_entries` の driver 用 SELECT ポリシーは行単位で列を制限できないため、supabase-js を直接叩けば自分の締め済み月の行の受注単価・会社側の値が取得できます。画面・PDF・ポータル RPC（`driver_portal_statement`）では出していません。厳密に隠す場合は列を分離したビューだけを driver に許可する変更が必要です。
2. **複数会社の UI は未対応**：データ構造（`company_id` + RLS）は多社対応ですが、ユーザーは 1 社にのみ所属し、会社の切替 UI はありません。
3. **通知機能なし**：LINE / メールでの月締め通知・明細送付は手動（テキストコピー・PDF 送付）。
4. **メール送信は Supabase 標準では 1 時間 2 通**：本番でマジックリンクを常用するにはカスタム SMTP が必要（[docs/SETUP.md](SETUP.md) 手順 12）。招待リンク＋パスワード運用なら不要。
5. **Supabase 無料プランの休止**：7 日間 API アクセスが無いとプロジェクトが一時停止します（ダッシュボードの「Restore project」で再開可）。`vercel.json` の `crons` が毎日（UTC 21:00 = 日本時間 6:00）`/api/cron/keepalive`（service_role で `companies` を 1 件数えるだけ）を呼び出して防止します。**`CRON_SECRET` は必須**で、未設定だと Route Handler が 503 を返して定期アクセスは無効になります（設定済みなら Vercel が付与する `Authorization: Bearer <CRON_SECRET>` を照合）。`scripts/deploy-vercel.sh` と GitHub Actions は未指定時に自動生成します。念のため月 1 回の手動バックアップを推奨。
6. **PDF のフォント**：`public/fonts/NotoSansJP-*.ttf` を実行時にファイルとして読み込みます。`next.config.ts` の `outputFileTracingIncludes` で `/api/export/statement.pdf` に `public/fonts/**` を同梱する設定済みです。フォントが見つからないエラーが出た場合は、この設定と `public/fonts/` の中身を確認してください。
7. **2 段階認証の UI なし**（Supabase 側で有効化できる構成のみ）。

---

## 11. 将来拡張の方針

| 項目 | 方針 |
|---|---|
| 2 段階認証（TOTP） | Supabase の MFA を有効化し、`lib/auth/session.ts` で AAL2 を要求する画面（設定・ユーザー管理）を追加 |
| LINE 通知 | LINE Messaging API（Push）を Server Action から呼び出し、月締め時に明細テキストを自動送信。drivers に LINE ユーザー ID 列を追加 |
| Google Drive 自動保存 | 月締め時のバックアップ JSON / PDF を Drive API でアップロード（サービスアカウントまたは OAuth）。`set_month_backup_path` に Drive の URL も記録 |
| 複数会社 UI | profiles を（user, company）の多対多にし、会社切替をヘッダーへ。RLS ヘルパーは「現在選択中の会社」を JWT クレームか Cookie から解決 |
| 通知・リマインド | Vercel Cron で「未締め月」「数量 0 の行」をメール／LINE で通知 |
| 請求書（インボイス） | 明細 PDF の逆方向（ドライバー → 会社の請求書）を同じ `lib/statement` から生成 |

---

## 12. 環境変数

| 変数 | 用途 | 公開範囲 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase の URL | ブラウザにも渡る |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon（publishable）キー。RLS 前提 | ブラウザにも渡る |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role（secret）キー | **サーバー専用** |
| `NEXT_PUBLIC_APP_URL` | 本番 URL（招待リンク・メールのリダイレクト先）。未設定時は `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → localhost | ブラウザにも渡る |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | 任意。AI 月次分析 | サーバー専用 |
| `CRON_SECRET` | **必須**（本番）。Vercel Cron → `/api/cron/keepalive` の Bearer 検証。未設定だと 503 を返し定期アクセスは無効。32 文字以上のランダム文字列（deploy スクリプト／GitHub Actions が自動生成） | サーバー専用 |

---

## 13. 公開の仕組み

| 方法 | 実装 | 内容 |
|---|---|---|
| GitHub Actions（推奨・実績あり） | `.github/workflows/deploy.yml`（`workflow_dispatch`） | Secrets `SUPABASE_ACCESS_TOKEN` / `VERCEL_TOKEN`（任意で `SUPABASE_ORG_ID` / `ANTHROPIC_API_KEY`）を使い、下の 2 スクリプトを順に実行。入力 `app_url` / `owner_email` / `company_name` / `skip_supabase`。DB パスワードと service_role キーはログにマスクし、`.env.production.local` は最後に削除。ジョブサマリーに本番 URL・Supabase プロジェクト・招待リンクを出力 |
| `scripts/setup-supabase.sh` | Supabase Management API（curl + jq） | プロジェクト作成（東京・Free、同名は再利用）→ `supabase/migrations/*.sql` を順に適用 → 会社とオーナー招待（有効な招待は再利用）→ 認証設定（`disable_signup`、Site URL / Redirect URLs）→ メールテンプレート（無料プラン＋標準メールでは HTTP 400 になるため警告して続行）→ API キー取得（`--write-env` で `.env.production.local`） |
| `scripts/deploy-vercel.sh` | Vercel CLI + Vercel REST API | `vercel link` → 環境変数を REST API（`/v10/projects/:id/env?upsert=true`）で登録（CLI の対話プロンプトを避ける。API 不可時のみ CLI）→ `CRON_SECRET` を未指定なら生成 → `vercel deploy --prod` → 本番 URL（エイリアス `https://rootive-profit.vercel.app`）を `NEXT_PUBLIC_APP_URL` に設定（未確定なら再デプロイ）→ `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` があれば Supabase の Site URL / Redirect URLs を更新。トークンの前後の空白・改行は自動で除去 |

実際の本番：Vercel `rootive-profit`（`https://rootive-profit.vercel.app`、東京 `hnd1`）＋ Supabase `rmchixgmeqtszqsdvxrj`（東京 `ap-northeast-1`）。

公開手順は [docs/SETUP.md](SETUP.md)、自動化は [docs/QUICKSTART.md](QUICKSTART.md)、日々の運用は [docs/OPERATIONS.md](OPERATIONS.md)、E2E テストは [docs/E2E.md](E2E.md) を参照してください。
