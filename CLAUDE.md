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
- `lib/db/database.types.ts` supabase-js 用の型（自動生成）、`lib/db/types.ts` 型エイリアス、`lib/db/queries.ts` 共通クエリ
- `lib/auth/session.ts` セッション・ロール確認（`requireStaff` / `requirePageRole` / `requireAdminAction` など）
- `lib/actions/*.ts` Server Actions（`"use server"`）、`lib/actions/result.ts` 共通の `ActionResult` / `runAction` / エラー変換
- `lib/schemas/*.ts` zod スキーマ（サーバー・クライアント共用）
- `lib/month.ts` 稼動月ユーティリティ、`lib/format.ts` 表示書式（円・%・数量）
- `components/ui/*` UI 部品（shadcn/ui 相当）、`components/layout/*` シェル・ナビ・月セレクタ
- `app/(app)/*` スタッフ画面、`app/driver/*` ドライバーポータル、`app/(auth)/*` ログイン・招待、`app/api/export/*` 出力
- `supabase/migrations/*.sql` スキーマ（0001 テーブル、0002 認証・RLS、0003 ビュー、0004 RPC、0005 ポータル・初期データ、0006 Storage・権限、0007 ドライバー別単価（bill_rate 上書き・rate_diffs・apply_master_rates））
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
- 川島幹太はオーナー本人：支払単価 0・率 0%・管理費 0 が正常（警告を出さない）
- ロール：owner（すべて）／admin（登録・編集・月締め・出力）／viewer（閲覧・CSV のみ）／driver（自分の締め済み月の明細のみ）

## supabase-js の使い方の制約（E2E 用の互換テストサーバーが対応する範囲に限定する）
- `from(table|view).select("col, col2" | "*")` — **埋め込みリソース（`drivers(name)` など）は使わない**。名称が必要なら `v_*` ビューを使う
- フィルタ：`eq / neq / gt / gte / lt / lte / in / is / like / ilike / or（単純な eq の組み合わせのみ）`、`order / limit / range`、`single / maybeSingle`、`{ count: "exact" }`
- 書き込み：`insert / upsert({ onConflict }) / update().eq() / delete().eq()` と `.select()` で戻り値取得
- RPC：`rpc("name", { p_xxx })`。引数はスカラー・JSON（jsonb）・スカラーの配列（`uuid[]` など。`p_entry_ids: string[]`）まで
- Auth：`getUser / signInWithOtp / signInWithPassword / verifyOtp / exchangeCodeForSession / signOut / updateUser / resetPasswordForEmail`、admin：`createUser / listUsers / generateLink / getUserById / updateUserById`
- Storage：`from("backups").upload / createSignedUrl / list / download`
