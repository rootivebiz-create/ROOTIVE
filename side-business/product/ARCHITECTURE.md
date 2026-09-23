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
- 端数・経過措置・源泉・全銀は `@/lib/...` の関数を使う（経過措置の割合は `@/lib/payroll/tax` の日付つきの表。70% を直書きしない）
- 60 日・支払期日・銀行の休日は `@/lib/tools/torihiki-joken`（`sixtyDayLimit`・`adjustForBankHoliday` など）

## 共通の部品（機能から使う。形を変えない）
| 場所 | 役目 |
|---|---|
| `server/tabular.ts` | Excel・CSV を文字の表に（`readTable`・文字コードの自動判定・`detectHeaderRow`・`dataRows`・`parseNumberCell`・`parseDateCell`・`headerSignature`） |
| `server/names.ts` | 名前の照合（`matchName`・`rankCandidates`・`normalizeName`）。表記ゆれ・かな・会社の種類・括弧書きを吸収 |
| `server/statements-core.ts` | 明細の写しを作る入口 `generateStatements`（中身が変わったときだけ版を上げ、ハッシュを付ける）・`readSnapshot`・`snapshotHash` |
| `server/features/watch.ts` | 見張り番 `runWatch(db, tenantId, month)` → `WatchIssue[]`（形は `watch-types.ts`） |
| `server/pdf/fonts.ts` | PDF の日本語フォント `registerPdfFonts()`・`PDF_FONT` |
| `server/download.ts` | ダウンロード（`csvText`・`encodeSjis`・`utf8WithBom`・`fileResponse`） |
| `server/tokens.ts` | 明細リンクの署名 `signStatementLink`・`verifyStatementLink` |
| `server/rate-limit.ts` | 回数の制限 `tooMany` |

## 機能の置き場所（server/features）と、ほかの機能から使ってよい入口
ほかの機能のファイルを直接直さない。下の入口（export された関数）を呼ぶ。足りなければ、その機能に入口を足す。

| 機能 | 場所 | 入口（例） |
|---|---|---|
| 取り込み（稼働・口座） | `import/`（`service.ts`・`detect.ts`・`parse.ts`・`resolve.ts`・`work.ts`・`adopt.ts`・`bank.ts`・`zengin-read.ts`・`formulas.ts`） | `createDraftFromFile`・`loadDraftView`・`applyBatch`・`undoBatch`（稼働の束 kind='work' は必ずここ。`summary` は `DraftSummary` v1）・`adoptDeductionProposal`（控除の提案）・`createBankDraft`/`applyBankImport`（口座。kind='bank_accounts'）・`parseZengin`・`buildWorkExport`（Excel に戻す）。同じファイルは `fileHash` で止める。振込額の列は並行運用へ（`saveParallelChecks`） |
| 支払明細・ドライバーのリンク | `statements.ts`・`statements/`・`portal.ts` | `listMonthStatements`・`getStatementDetail`・`statementStatus`（純関数。みなし確認は 3 条件：送って◯日・未解決の質問なし・取引条件の条項 `deemedClause`）・`describeChanges`・`loadVersionHistory`・`loadQuestionInbox`/`unresolvedQuestions`・`companyCopy`（会社の控え。経過措置の内訳）・`compareMonths`・`findStatementByToken` |
| 取引条件の明示 | `terms.ts`・`terms/`・`terms-content.ts`（共通） | `listTerms`・`loadTermsDriver`・`createTermsVersion`・`bulkCreateTerms`・`markTermsSent`・`recreateTermsLink`・`findTermsByToken`・`receiveTermsFromPortal`・`renderTermsPdf`。中身は `buildTermsContent`/`buildTermsContentMany`・`compareTermsContent`・`latestTermsByDriver`・`deemedClauseMap`。`drivers.terms_issued_on` は「初めて明示した日」 |
| 見張り番 | `watch.ts`・`watch/`（`rules.ts` に純関数のルール。`RULES` に code・重さ・根拠・出典・時点） | `runWatch`（指摘は重さ → 影響額の順。`impact`（円 or null）と `asOf` を持つ。影響額は重なるので足さない）・`ackWatchIssue`。ルールを足すときは陽性・陰性の単体テストを必ず書く。`tests/wording.test.ts`（言ってはいけない言い方）と `tests/no-hardcoded-rate.test.ts`（経過措置の率の直書き）が全ファイルを見る |
| 振込・締め・操作の記録 | `transfer.ts`・`close.ts` | `loadTransferPlan`・`createTransferBatch`・`reviewBankChanges`（前回の振込から口座が変わった人）・`closeMonth`（赤が残るときはオーナーが理由を書けば締められる）・`reopenMonth`・`searchAuditLog`・`auditLabel`/`auditSummary`（新しい操作を足したら、ここに名前を足す。`tests/audit-log.test.ts` が見る） |
| 全データの書き出し・読み戻し | `export-all.ts`・`export-all/` | `buildTenantExport`（ZIP：表ごとの CSV・manifest・明細の全版）・`readTenantExport`・`previewTenantImport`・`importTenantData`（`scripts/restore-tenant.ts` からも） |
| 元請との突合 | `reconcile.ts`・`reconcile/` | `importNotice`・`runReconcile`・`listMonth`・`loadReport`・`foundMoney`（確定と見込みを分ける。足さない）・`listWaiting`・`loadLetterSource`。元請の締め日の期間で比べる（`reconcile/period.ts`） |
| 利益・会計 | `profit.ts`・`profit/`・`accounting.ts`・`accounting/journal.ts` | `monthProfit`・`profitTrend`・`loadCeoSheet`・`buildAccountingFile` |
| ホーム・最初の設定・並行運用 | `home.ts`・`onboarding.ts`・`onboarding/`・`parallel.ts` | `loadHomeStatus`・`unresolvedQuestionCount`・`createDrivers`・`saveParallelChecks`・`goLive`（差のある人すべてに説明が付くまで切り替えない） |
| 設定 | `settings/` | 会社・ドライバー・元請（無効にできる）・案件・単価・控除・利用者・自分のアカウント（`account.ts`）・ヘルプ。口座番号は操作の記録に下 3 桁だけ残す |

## ドライバーの画面（ログインなし）
- 明細 `/s/<署名つきの値>`・取引条件 `/t/<署名つきの値>`。署名は `signLink(用途, id, nonce, 期限)`（用途が違うと通らない）。毎回 `verifyLink` と行の `link_nonce` を確かめる。Server Action も毎回確かめ直す（画面を信じない）
- `noindex`・キャッシュしない・リファラーを送らない。見られるのはその明細と、同じドライバーの明細だけ

## ダウンロード（`app/api/**/route.ts`）
- 最初に `requireUser(role)`（`AuthError` なら 403）。会社で絞る。持ち出したことを `audit()` に残す

## テスト
- 単体・結合：`tests/*.test.ts`（Vitest）。DB は `createTestDb()`（PGlite・メモリ）と `seedDemo(db)`（架空の会社）
- E2E：`e2e/*.spec.ts`（Playwright、`DEMO_MODE=1 PGLITE_DIR=memory` で `next start`）

## 画面の部品
- `components/page.tsx`：`PageHeader`（月の切り替えつき）・`EmptyState`・`Badge`（red/yellow/green/gray）・`Notice`
- `components/app-shell.tsx`：メニュー（`components/nav.ts`）

## 言ってはいけないこと
税務・法律の判断をする／法令に完全対応／必ず合う／補助金が使える／ドライバーの報酬を下げるべき、など。見張り番は「おそれ」「確認をおすすめ」までで、判定はしない。
