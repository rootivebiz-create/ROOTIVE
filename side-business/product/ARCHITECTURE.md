# しめ日ラボ（製品）の作り — 機能を足す人向け

## 置き場所と共有
- この `product/` は独立した Next.js 15 アプリ。**計算の部品はサイトの `side-business/lib` を共有する**（コピーしない）。
  - `@/lib/...` → `../lib/...`（例：`@/lib/payroll/zengin`、`@/lib/engine/withholding`、`@/lib/tools/torihiki-joken`、`@/lib/format`）
  - `@/components/ui` → サイトの UI 部品（Button, buttonClass, Card, Field, Input, NumberInput, Select, Money, TableWrap）
  - `~/...` → この `product/` の中
- 共有の部品（`../lib`・`../components/ui.tsx`）は **react のほかに npm のパッケージを読まない**。Vercel は `product/` にだけ install するため（react の型は `tsconfig.json` の `paths` で `product/node_modules/@types/react` を読む）。`tests/standalone-build.test.ts` が確かめる
- 色の変数・印刷の指定は `app/globals.css`（サイトと同じ）。スマホ 375px（できれば 320px）で崩れないこと。表は `<TableWrap>`。押せる所は 44px 以上。
  - 本文は `overflow-wrap: break-word`。横並び（flex）の中に長いファイル名・メールを置くときは `min-w-0 [overflow-wrap:anywhere]` を付ける
  - 会社の画面は上のメニューが貼り付くので、ページの中のリンク（#…）の飛び先は `globals.css` の `scroll-padding-top` でずらす（`scroll-mt-*` を足さない。/s・/t だけは貼り付くメニューが無いので `scroll-mt-4`）

## データ
- `db/schema.ts`（Drizzle）。**全テーブルに tenant_id**。読むときは必ず `eq(table.tenantId, user.tenantId)` で絞る（`server/repo.ts` に共通の読み出し）。
- 表を変えたら `npx drizzle-kit generate --name <名前>` でマイグレーションを作る（手で SQL を書くときは `--custom`）。
- 本番の DB へのマイグレーションは、Vercel の本番のビルドのときだけ（`scripts/migrate.ts` と `scripts/migrate-guard.ts`。プレビューのビルドでは当てない）。お客様の DB・秘密の値は本番だけに入れる（`scripts/provision-plan.ts`）
- 締めた月（`month_closes.status='closed'`）の `work_entries`・`adjustments`・`statements` は DB の引き金が止める（`MONTH_CLOSED`）。`audit_log` は消せない。
- 手元・テスト・デモは PGlite（`PGLITE_DIR`、`memory` で揮発）。本番は `DATABASE_URL=postgres://…`。

## サーバーの処理の決まり
1. 画面：`requirePageUser(role)`（ログインと役割。足りなければ /login か /forbidden）
2. 書き込み（Server Action）：**最初に `requireUser(role)`** → zod で検証 → DB（tenant で絞る）→ `audit()` → `revalidatePath` → `runAction()` で包んで `ActionResult` を返す
3. ロジックは `server/features/<機能>.ts` に **(db, tenantId, 入力) を受け取る関数** として書く（Server Action は薄い包みだけ）。こうすると PGlite でテストできる
4. エラーは日本語（`UserError` はそのまま画面へ、DB のエラーは `friendlyDbError`）。zod の誤りは、入力欄のあるものは `fieldErrors`、入力欄の決まらないもの（1 つの値だけを parse したとき）は日本語の文をそのまま `error` に（`runAction`）。思わぬエラーは 1 行の JSON（`"event":"action failed"`）でログに出る
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
| `server/tokens.ts` | 明細リンクの署名 `signStatementLink`・`verifyStatementLink`。鍵つきハッシュ `keyedHash(用途, 値)`（APP_SECRET から用途ごとに作った鍵 `derivedKey`。IP・口座番号など取りうる値の少ないものの目印は、鍵なしの sha256 にしない）・接続元の目印 `ipFingerprint`・画面に出す 8 文字 `ipMarker` |
| `server/rate-limit.ts` | 回数の制限 `tooMany`（長いキーは要約し、覚える数に上限がある） |
| `server/password.ts` | パスワード（scrypt N=2^14・r=8・p=5）。前の強さのハッシュはログインが通ったときに作り直す（`needsRehash`）。利用者がいないときの時間合わせは `DUMMY_PASSWORD_HASH` |

## 機能の置き場所（server/features）と、ほかの機能から使ってよい入口
ほかの機能のファイルを直接直さない。下の入口（export された関数）を呼ぶ。足りなければ、その機能に入口を足す。

| 機能 | 場所 | 入口（例） |
|---|---|---|
| 取り込み（稼働・口座） | `import/`（`service.ts`・`detect.ts`・`parse.ts`・`resolve.ts`・`work.ts`・`adopt.ts`・`bank.ts`・`zengin-read.ts`・`formulas.ts`） | `createDraftFromFile`・`loadDraftView`・`applyBatch`・`undoBatch`（稼働の束 kind='work' は必ずここ。`summary` は `DraftSummary` v1）・`adoptDeductionProposal`（控除の提案）・`createBankDraft`/`applyBankImport`（口座。kind='bank_accounts'）・`parseZengin`・`buildWorkExport`（Excel に戻す）。同じファイルは `fileHash` で止める。振込額の列は並行運用へ（`saveParallelChecks`）。表の形：1 人 1 枚（`mapping.fixedDriverId`。覚えた読み方には残さない）・シートごとに別の人（`mapping.sheetDrivers`）・人が横に並ぶ表（役目 `driverValue`）・印（`mapping.marks`）。金額の列をその月の調整に（`setAdjustColumn`・`adjust.ts`。反映で作り、取り消しで消す）・単価の列から人ごとの単価（`rates.ts`・`adoptRateProposals`）・調整の貼り付け（`bulkAddAdjustments`・`adjust-paste.ts`）・デモの置ける量（`demo-budget.ts`） |
| 支払明細・ドライバーのリンク | `statements.ts`・`statements/`・`portal.ts` | 明細の検索（`/records`）は `statements/records.ts` の `searchStatementRecords`（版の写しから探すので、作り直しで消えた明細も見つかる）・`recordsCsvRows`。`listMonthStatements`・`getStatementDetail`・`statementStatus`（純関数。みなし確認は 3 条件：送って◯日・未解決の質問なし・取引条件の条項 `deemedClause`）・`describeChanges`・`loadVersionHistory`・`loadQuestionInbox`/`unresolvedQuestions`・`companyCopy`（会社の控え。経過措置の内訳）・`compareMonths`・`findStatementByToken` |
| 取引条件の明示 | `terms.ts`・`terms/`・`terms-content.ts`（共通） | `loadTermsPortal`（古い版のリンクでは、最新の版を送ってあればそのリンク `latestToken` を返す）・`listTerms`・`loadTermsDriver`・`createTermsVersion`・`bulkCreateTerms`・`markTermsSent`・`recreateTermsLink`・`findTermsByToken`・`receiveTermsFromPortal`・`renderTermsPdf`。中身は `buildTermsContent`/`buildTermsContentMany`・`compareTermsContent`・`latestTermsByDriver`・`deemedClauseMap`。`drivers.terms_issued_on` は「初めて明示した日」 |
| 見張り番 | `watch.ts`・`watch/`（`rules.ts` に純関数のルール。`RULES` に code・重さ・根拠・出典・時点） | `runWatch`（指摘は重さ → 影響額の順。`impact`（円 or null）と `asOf` を持つ。影響額は重なるので足さない）・`ackWatchIssue`。ルールを足すときは陽性・陰性の単体テストを必ず書く。`tests/wording.test.ts`（言ってはいけない言い方）と `tests/no-hardcoded-rate.test.ts`（経過措置の率の直書き）が全ファイルを見る |
| 振込・締め・操作の記録 | `transfer.ts`・`close.ts` | `loadTransferPlan`・`createTransferBatch`・`reviewBankChanges`（前回の振込から口座が変わった人。口座の目印は APP_SECRET から作った鍵の HMAC で、前の作り方の目印とも比べる）・`loadPaidDifferences`/`settlePaidDifference`（振り込んだあとに明細が変わった人の差と、翌月の調整・別の方法での精算の記録）・`closeMonth`（赤が残るときはオーナーが理由を書けば締められる）・`reopenMonth`・`searchAuditLog`・`auditLabel`/`auditSummary`（新しい操作を足したら、ここに名前を足す。`tests/audit-log.test.ts` が見る） |
| 全データの書き出し・読み戻し | `export-all.ts`・`export-all/` | `buildTenantExport`（ZIP：表ごとの CSV・manifest・明細の全版）・`buildPdfArchive`（読むための PDF：明細と取引条件の全部の版を年ごとの ZIP に）・`readTenantExport`・`previewTenantImport`・`importTenantData`（`scripts/restore-tenant.ts` からも） |
| 元請との突合 | `reconcile.ts`・`reconcile/` | `importNotice`・`runReconcile`・`listMonth`・`loadReport`・`foundMoney`（確定と見込みを分ける。足さない）・`listWaiting`・`loadLetterSource`。元請の締め日の期間で比べる（`reconcile/period.ts`）。お支払通知は元請 × 月で 1 通だが、営業所ごとなど何通かのファイルを足せる（`importNotice` の `add`・`replaceFileId`、`removeNoticeFile`。どの行がどのファイルのものかは取り込みの記録の `summary.lineIds`、同じファイル・同じ中身は足さない。`reconcile/files.ts`）。PDF しか無い元請は表の貼り付け（`reconcile/paste.ts` で TSV にして同じ流れ） |
| 利益・会計 | `profit.ts`・`profit/`・`accounting.ts`・`accounting/journal.ts` | `monthProfit`・`profitTrend`・`loadCeoSheet`・`buildAccountingFile` |
| ホーム・最初の設定・並行運用 | `home.ts`・`onboarding.ts`・`onboarding/`・`parallel.ts` | `loadHomeStatus`・`unresolvedQuestionCount`・`createDrivers`・`saveParallelChecks`・`goLive`（差のある人すべてに説明が付くまで切り替えない） |
| 設定 | `settings/` | 会社・ドライバー・元請（無効にできる）・案件・単価・控除・利用者・自分のアカウント（`account.ts`）・ヘルプ。口座番号は操作の記録に下 3 桁だけ残す（会社の振込依頼人の口座も）。単価・控除を変えてまだ締めていない月の明細が変わるときは、`withOpenMonthCheck`（`settings/open-months.ts`）で変わる月と額を見せ、「反映する」を選んだときだけ保存する。オーナーが入れなくなったときの入り直しは `resetAccess`（`settings/reset-access.ts`。`scripts/reset-access.ts` から Next.js の外で動かすので `server-only` を読み込まない） |

## ドライバーの画面（ログインなし）
- 明細 `/s/<署名つきの値>`・取引条件 `/t/<署名つきの値>`。署名は `signLink(用途, id, nonce, 期限)`（用途が違うと通らない）。毎回 `verifyLink` と行の `link_nonce` を確かめる。Server Action も毎回確かめ直す（画面を信じない）
- `noindex`・キャッシュしない・リファラーを送らない。見られるのはその明細と、同じドライバーの明細だけ（取引条件は、同じドライバーの送ってある最新の版だけ）

## デモ（DEMO_MODE=1）
- 入口 `/demo/start` は画面だけ。架空の会社は「デモを始める」（Server Action `startDemoAction`）を押したときだけ作る（GET で作らない。ロボット・リンクのプレビューで増やさない）
- `server/demo.ts`：`cleanupDemoTenants` は 24 時間を過ぎたものだけ消す。多すぎるときは `demoBusyReason` で「混み合っています」にして作らない（使っている途中の人のデモを押しのけない）
- ファイルを置く入口はどれも `demoFileProblem`（1 件の大きさ）を、保存するものは `assertDemoUploadBudget`（数と量）を通す

## ダウンロード（`app/api/**/route.ts`）
- 最初に `requireUser(role)`（`AuthError` なら 403）。会社で絞る。持ち出したことを `audit()` に残す

## テスト
- 単体・結合：`tests/*.test.ts`（Vitest）。DB は `createTestDb()`（PGlite・メモリ）と `seedDemo(db)`（架空の会社）
- E2E：`e2e/*.spec.ts`（Playwright、`DEMO_MODE=1 PGLITE_DIR=memory` で `npm run build && next start -p 3310`。`E2E_SKIP_BUILD=1` でビルドを飛ばす・`E2E_DEV=1` なら `next dev`）。320px・375px・パソコンの 3 つ。`demo.spec.ts`（SPEC §3 の流れ・会社の側の操作の回数・画面と PDF の数字）・`layout.spec.ts`（スマホの幅で全画面のはみ出し・コンソールのエラー・h1・44px）・`security.spec.ts`（書き換えたリンク・別の会社の PDF・デモの入口の飛び先）・`mobile.spec.ts`（メニューの印）・`month.spec.ts`（締め → 振込 → 締めを外す）。画面を足したら `layout.spec.ts` の一覧にも足す

## 画面の部品
- `components/page.tsx`：`PageHeader`（月の切り替えつき）・`EmptyState`・`Badge`（red/yellow/green/gray）・`Notice`
- `components/form-field.tsx`：フォームの共通の部品。`F`（入力欄。誤りは赤で下に出し、aria-invalid・aria-describedby を付ける）・`ResultLine`（結果の帯。入力の誤りを箇条書き）・`useFormAction`（onSubmit から送るので、断られても入力・選んだファイル・チェックが消えない。送ったあと、誤りのある最初の欄へ移る。`resetOnSuccess` でうまくいったときだけ空に戻す）。入力の誤りを `Field` の `hint` に入れない。**`<form action={fn}>` に直接渡さない**（React が送ったあとに入力を空に戻すため。ボタンだけのフォームは除く）
- `components/app-shell.tsx`：メニュー（`components/nav.ts`。締めの流れの順：明細 → 締め → 振込）。いまの画面の項目に `aria-current="page"` と印を付ける（`components/nav-links.tsx`・`isCurrentNav`。スマホの横スクロールのメニューは、いまの項目が見える所まで送る）

## 言ってはいけないこと
税務・法律の判断をする／法令に完全対応／必ず合う／補助金が使える／ドライバーの報酬を下げるべき、など。見張り番は「おそれ」「確認をおすすめ」までで、判定はしない。
