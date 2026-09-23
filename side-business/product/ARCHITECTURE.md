# しめ日ラボ（製品）の作り — 機能を足す人向け

## 置き場所と共有
- この `product/` は独立した Next.js 15 アプリ。**計算の部品はサイトの `side-business/lib` を共有する**（コピーしない）。
  - `@/lib/...` → `../lib/...`（例：`@/lib/payroll/zengin`、`@/lib/engine/withholding`、`@/lib/tools/torihiki-joken`、`@/lib/format`）
  - `@/components/ui` → サイトの UI 部品（Button, buttonClass, Card, Field, Input, NumberInput, Select, Money, TableWrap）
  - `~/...` → この `product/` の中
- 色の変数・印刷の指定は `app/globals.css`（サイトと同じ）。スマホ 375px で崩れないこと。表は `<TableWrap>`。押せる所は 44px 以上。

## データ
- `db/schema.ts`（Drizzle）。**全テーブルに tenant_id**。読むときは必ず `eq(table.tenantId, user.tenantId)` で絞る（`server/repo.ts` に共通の読み出し）。
- 表を変えたら `npx drizzle-kit generate --name <名前>` でマイグレーションを作る（手で SQL を書くときは `--custom`）。
- 締めた月（`month_closes.status='closed'`）の `work_entries`・`adjustments`・`statements` は DB の引き金が止める（`MONTH_CLOSED`）。`audit_log` は消せない。
- 手元・テスト・デモは PGlite（`PGLITE_DIR`、`memory` で揮発）。本番は `DATABASE_URL=postgres://…`。

## サーバーの処理の決まり
1. 画面：`requirePageUser(role)`（ログインと役割。足りなければ /login か /forbidden）
2. 書き込み（Server Action）：**最初に `requireUser(role)`** → zod で検証 → DB（tenant で絞る）→ `audit()` → `revalidatePath` → `runAction()` で包んで `ActionResult` を返す
3. ロジックは `server/features/<機能>.ts` に **(db, tenantId, 入力) を受け取る関数** として書く（Server Action は薄い包みだけ）。こうすると PGlite でテストできる
4. エラーは日本語（`UserError` はそのまま画面へ、DB のエラーは `friendlyDbError`）
5. 役割：viewer（見るだけ）・staff（登録・取り込み・明細・振込・締め）・owner（すべて＋利用者の管理・締めの解除）
6. 月は URL の `?m=YYYY-MM`（`monthFromParam`）、DB は `YYYY-MM-01`

## 計算
- 明細は `server/calc/statement.ts` の `buildStatementDrafts`（`loadBuildInput` で読む）。**画面で独自に計算しない**
- 端数・経過措置・源泉・全銀は `@/lib/...` の関数を使う

## テスト
- 単体・結合：`tests/*.test.ts`（Vitest）。DB は `createTestDb()`（PGlite・メモリ）と `seedDemo(db)`（架空の会社）
- E2E：`e2e/*.spec.ts`（Playwright、`DEMO_MODE=1 PGLITE_DIR=memory` で `next start`）

## 画面の部品
- `components/page.tsx`：`PageHeader`（月の切り替えつき）・`EmptyState`・`Badge`（red/yellow/green/gray）・`Notice`
- `components/app-shell.tsx`：メニュー（`components/nav.ts`）

## 言ってはいけないこと
税務・法律の判断をする／法令に完全対応／必ず合う／補助金が使える／ドライバーの報酬を下げるべき、など。見張り番は「おそれ」「確認をおすすめ」までで、判定はしない。
