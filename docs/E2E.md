# ブラウザ E2E テスト（Playwright）

主要導線をブラウザで通し、スマホ（iPhone 13 相当・幅 390px）と PC（Desktop Chrome）の両方で動作を確認します。
Supabase 本体は使わず、ローカル PostgreSQL ＋ `tests/e2e/supabase-lite`（Auth／PostgREST／Storage 互換サーバー）で動かします。
基盤の詳細（supabase-lite の対応 API・制限事項）は [tests/e2e/README.md](../tests/e2e/README.md) を参照してください。

## 実行方法

```bash
npm run test:e2e                          # next build → start → 全 spec（mobile / desktop の 2 プロジェクト）
E2E_SKIP_BUILD=1 npm run test:e2e         # 直前の next build を再利用（開発中の反復用）
npx playwright test --project=mobile      # スマホだけ
npx playwright test tests/e2e/20-entries.spec.ts --project=desktop   # 1 ファイルだけ
npx playwright show-report                # HTML レポート（playwright-report/）
```

- 前提：Node.js 20 以上、PostgreSQL 16 のバイナリ（`initdb` / `pg_ctl` / `psql`）、`npx playwright install chromium`
- global-setup が毎回 DB `rootive_e2e` を作り直し、会社「株式会社ROOTIVE」と owner／admin／viewer の招待を投入してから Next.js を起動します
- 実行時間の目安：build 済みなら両プロジェクトで約 2 分（build を含めて約 4〜5 分）
- 生成物：`tests/e2e/.state.json`・`tests/e2e/.logs/`・`tests/e2e/.storage/`（締め時バックアップの保存先）、`test-results/`（失敗時のスクリーンショット・トレース）、`playwright-report/`

## 設計方針

- **ファイル名の番号順に実行**（`workers: 1`、ファイルはアルファベット順）。まず mobile プロジェクトで `10 → 20 → … → 90 → auth` を実行し、続けて desktop で同じ順に実行します
- **各 spec は自分で前提を揃える**：`resetToSeed()`（データ全削除 → §8.6 の初期データ投入）や `setMonthClosed()`（RPC で月締め／解除）、`adminSql()` を `beforeAll` で使い、前の spec の結果に依存しません。desktop 側の 2 周目も同じ前提で始まります
- **ログイン**：オーナーはマジックリンク（`loginViaMagicLink`）、viewer／driver は都度 `createInvitation()` で発行した招待リンク（`loginViaInvite`。招待リンクは 1 回限り）
- **ラベル・ボタン名は実装のとおり**（`components/**`・`app/**` から取得）。セレクタは `getByRole` / `getByLabel` / `getByText` を優先し、一覧の行はスマホのカードと PC の表の両方に当たる `listRow()` で探します
- **金額は画面と同じ書式**で比較します（`helpers.yen()` ＝ `lib/format.yen`：`¥2,559,573`）

## 各 spec の内容

| ファイル | 内容 | 前提 |
|---|---|---|
| `auth.spec.ts` | 招待リンクでログイン／使用済みリンクは再利用不可／マジックリンク → ログアウト／不正トークン／未ログインは `/login?next=` へ | 会社と招待（global-setup） |
| `10-dashboard.spec.ts` | `/dashboard?m=2026-09` の KPI（会社売上 ¥2,559,573／会社利益 ¥652,490／支払合計 ¥1,907,083／利益率 25.5%）、ドライバー別表 8 名と合計、警告（相曽慧の管理費 ¥14,999 ≠ ¥15,000、稼働ゼロ 吉田雅一・高森豪介）、推移グラフ（`svg.recharts-surface`）、行タップで支払明細へ。未来月は「予定」 | `resetToSeed()` |
| `20-entries.spec.ts` | 一覧 10 行と合計 → 「＋ 稼働を追加」（吉田雅一・三郷Amazon・20 日：個別単価 21,960 が自動入力され「自動」表示、プレビュー会社売上 ¥460,500）→ 保存 → 11 行。**追加の所要時間が 30 秒未満**（§0。実測は 2〜3 秒）→ 編集（20 → 21）→ 削除（確認ダイアログ）→ 2026-10 に「前月から複製」（数量 0・「未入力」バッジ 10 件、再実行しても重複しない）→ 一括入力（Temu：藤田裕介 22・高森豪介 3 → toast「追加 1 件／更新 1 件／削除 0 件」） | `resetToSeed()` |
| `30-payouts.spec.ts` | `/payouts?m=2026-09`（相曽慧 税抜 ¥396,643／税込 ¥436,307）→ 明細（小計（税抜）・消費税（10%）¥39,664・お支払額（税込）・振込予定日 2026年10月31日・会社側の内訳 会社利益 ¥86,882）→ 「管理費・調整を編集」（管理費 15,000、リース代 −30,000 利益計上 → 税抜 ¥366,642／税込 ¥406,306）→ 明細テキストをコピー（小計（税抜）・消費税・お支払額（税込）の行を検証）→ 個人明細 CSV（BOM・「小計（税抜）」「消費税（10%）」「支払額（税込）」行）／PDF（`%PDF`、10KB 超）／印刷用ページ → 全員分の PDF（ZIP：`PK` シグネチャ・終端レコードのエントリ数 8・ファイル名 UTF-8、存在しない月は 404）→ 案件別（当月／全期間） | `resetToSeed()`（終了後に相曽慧の管理費・調整を初期値へ戻す） |
| `40-settings.spec.ts` | ドライバー追加（テスト太郎・率 10%・管理費 15,000）→ 一覧 → 編集で停止中 → 案件追加（テスト案件：配送A 日給／配送B 個数）→ 会社設定（住所・電話を保存 → 再表示で保持、印刷用明細に反映）→ ユーザー管理で viewer を招待（招待リンク `/invite/…` を表示）→ 監査ログ（drivers の INSERT／UPDATE）→ **ドライバー別単価**（黒岩亜夢莉の三郷Amazon 受注 23,500 を保存 → 「個別」バッジ・当月反映バナー → ダッシュボード警告 → 稼働入力の「単価変更あり」バッジと「マスタの値に更新」ダイアログ（行を選んで更新）→ 単価表で 23,600 に変更 → 「2026年9月 の稼働に反映」→ 案件ごとの見方 → 単価表 CSV の実効単価と出所）→ **会社設定の消費税**（税率 8%・四捨五入 → 明細の消費税 ¥31,731・お支払額（税込）¥428,374 → 戻す）→ **ロゴのアップロード**（`public/icons/icon-192.png` → `/api/company-asset/logo` が image/png → 印刷用ページと PDF に反映 → 削除で 404）→ **ドライバー別の支払日**（黒岩亜夢莉を翌々月 15 日 → 明細の振込予定日 2026年11月15日、他のドライバーは翌月末のまま → 戻す） | `seedInitialData()`、同名マスタの削除 |
| `50-closing.spec.ts` | 2026-09 を締める → 締め済みバッジ・締め日時・メモ・「バックアップ」→ 稼働入力に「稼働を追加」が無く締め済みバッジ、一括入力も無効 → 明細に編集ボタンが無い → データ画面の締め時バックアップ一覧に 2026年9月 → `/api/export/month-backup` が Storage の JSON を返す（存在しない月は 404）→ 締めを解除（owner）→ 追加ボタンが戻る → 再度締める → 監査ログに月締め・締め解除 | `seedInitialData()`、`setMonthClosed("2026-09", false)` |
| `60-roles.spec.ts` | **viewer**：追加・編集・削除・複製・一括入力が無い、`/settings/users`・`/settings/company` は `/dashboard` へ、`backup.json` は 403・`entries.csv` は 200、supabase-js からの書き込みも拒否（トリガー／RLS）。**driver**（相曽慧）：`/driver` に 2026年9月 税込 ¥436,307 → 明細に「お支払額（税込）」「小計（税抜）」があり「会社利益」「会社売上」が無い → 自分の PDF は 200、他人・未締め月・スタッフ向け出力は 403 → `/dashboard` 等は `/driver` へ → 未締め月は「集計中」→ ログアウト | `resetToSeed()`、driver の前に `setMonthClosed("2026-09", true)` |
| `70-expenses.spec.ts` | `/expenses?m=2026-09`：経費を 2 件追加（燃料費 ¥50,000・車両リース ¥120,000）→ KPI（固定費／変動費／経費合計）とカテゴリ別小計 → ダッシュボードの「経費」「営業利益 ¥482,490」→ **設定 → 経費カテゴリ**で「毎月かかる経費」（保険料 ¥30,000）を登録 → 経費画面で「毎月かかる経費をこの月に計上」（1 件 → 2 回目は 0 件）→ 経費 CSV → 締め済み月は編集 UI なし・閲覧者も追加不可 | `resetToSeed()`、経費の削除 |
| `75-invoices.spec.ts` | **設定 → 取引先**で取引先を登録 → 案件「三郷Amazon」に紐づけ → `/invoices?m=2026-09` で売上 ¥1,151,250 → 「請求書を作成」→ 明細・小計 ¥1,151,250／消費税 ¥115,125／合計 ¥1,266,375・番号 `202609-01` → 「発行済みにする」（作り直しボタンが消える）→ 「入金済みにする」→ 一覧に「入金済み」→ 請求書一覧 CSV と請求書 PDF（`%PDF`・5KB 超）→ 閲覧者は作成不可 | `resetToSeed()`、取引先・請求書の削除 |
| `80-reports.spec.ts` | `/reports?y=2026`：年間サマリー（売上 ¥2,559,573／経費 ¥200,000／営業利益 ¥452,490）・月次の内訳・ドライバー別／案件別／経費カテゴリ別 → 年次レポート CSV → ダッシュボードで月次目標（売上 260 万・営業利益 40 万）を設定 → 達成率 98.4% / 113.1% → 閲覧者は編集不可 | `resetToSeed()`、経費 2 件の投入 |
| `85-nav-portal.spec.ts` | ナビ（PC は 8 項目、スマホは下タブ 5 つ＋「メニュー」シートから経費へ）→ コマンドパレット（⌘K：「けいひ」で経費へ、「相曽」でドライバー候補、Esc で閉じる）→ 設定サブナビに取引先・経費カテゴリ → **ドライバーポータルの速報**（未締め月が「集計中」・税込 ¥436,307・「締め前のため変わることがあります」・年間サマリー）→ 会社設定で速報を止められる | `resetToSeed()` |
| `90-migrate.spec.ts` | データ全削除（会社名の入力で有効化）→ `tests/fixtures/prototype-sample.json` を選択 → プレビュー（試作アプリ JSON、2026-09 売上 ¥2,559,573／利益 ¥652,490／支払 ¥1,907,083）→ 取り込み → `/dashboard?m=2026-09` の KPI が一致 → 同じファイルを再取り込みしても稼働行 10 件のまま（冪等）→ 監査ログに全削除・取り込み | `seedInitialData()` |

### helpers.ts に追加した関数

| 関数 | 用途 |
|---|---|
| `resetToSeed()` | owner の RPC で `reset_company_data` → `seed_initial_data`。締め済み月やドライバー利用者があっても実行できる |
| `setMonthClosed(month, closed)` / `monthIsClosed(month)` | RPC（`close_month` / `reopen_month`）で月締めの状態を揃える／DB の状態を読む |
| `driverIdByName(name)` / `projectItemIdByName(project, item)` / `countEntries(month)` | psql で ID・件数を引く |
| `listRow(page, text)` | 一覧の 1 行。PC は `<tr>`、スマホは最も内側の Card（`div.rounded-lg`）を、表示中の要素だけから探す |
| `kpiCard(page, label)` | ダッシュボードの KPI カード |
| `toast(page, text)` | sonner のトースト |
| `saveScreenshot(page, name, { fullPage })` | `docs/screenshots/` に保存（fullPage では下タブナビを非表示にして撮る） |
| `yen(n)` | 画面と同じ金額書式（`lib/format` の再エクスポート） |

## スクリーンショット（docs/screenshots/）

幅 390px（iPhone 13）を中心に、テスト実行時に自動保存されます（fullPage）。PC 版はダッシュボードのみ。

| ファイル | 画面 |
|---|---|
| `dashboard-mobile.png` | ダッシュボード（KPI・警告・推移・ドライバー別） |
| `dashboard-desktop.png` | ダッシュボード（PC：表とサイドナビ） |
| `entries-mobile.png` | 稼働入力の一覧（カード表示・合計） |
| `entry-dialog-mobile.png` | 「稼働を追加」ダイアログ（下から全幅シート、単価の自動入力） |
| `statement-mobile.png` | 支払明細（管理費・調整の編集後、会社側の内訳） |
| `settings-drivers-mobile.png` | 設定 › ドライバー一覧（テスト太郎を追加した直後） |
| `closing-months-mobile.png` | 設定 › 月締め（2026年9月 を締めた直後） |
| `import-preview-mobile.png` | 設定 › データの取り込みプレビュー（試作アプリ JSON） |
| `driver-portal-mobile.png` | ドライバーポータルの支払明細（driver ロールで見える範囲だけ。会社側の数字は出ない） |
| `rates-mobile.png` | 設定 › ドライバー別単価（黒岩亜夢莉の三郷Amazon 受注を個別に設定した直後。当月反映バナー付き） |
| `expenses-mobile.png` | 経費（固定費／変動費／経費合計とカテゴリ別小計） |
| `invoice-mobile.png` | 請求書の詳細（明細・小計・消費税・合計） |
| `reports-mobile.png` | 年次レポート（年間サマリー・推移グラフ・ランキング） |
| `menu-sheet-mobile.png` | スマホの「メニュー」シート（経費・案件・レポート・設定と設定のサブ項目） |

### ダッシュボード（スマホ／PC）

![dashboard-mobile](screenshots/dashboard-mobile.png)

![dashboard-desktop](screenshots/dashboard-desktop.png)

### 稼働入力（一覧・追加ダイアログ）

![entries-mobile](screenshots/entries-mobile.png)

![entry-dialog-mobile](screenshots/entry-dialog-mobile.png)

### 支払明細

![statement-mobile](screenshots/statement-mobile.png)

### 設定（ドライバー・月締め）

![settings-drivers-mobile](screenshots/settings-drivers-mobile.png)

![closing-months-mobile](screenshots/closing-months-mobile.png)

### データ取り込みプレビュー

![import-preview-mobile](screenshots/import-preview-mobile.png)

### ドライバーポータル（スマホ）

![driver-portal-mobile](screenshots/driver-portal-mobile.png)

### ドライバー別単価（スマホ）

![rates-mobile](screenshots/rates-mobile.png)

## 既知の不具合

現在 `test.fixme` / `test.skip` で残しているテストはありません（108 件すべて通過）。

以前 `60-roles.spec.ts` の「driver：ポータルに締め済みの自分の月だけ表示され…」を fixme にしていた不具合（本番ビルドで `/driver` が「エラーが発生しました」になる。`app/driver/layout.tsx` が lucide のアイコン関数を `"use client"` の `nav.tsx` に渡していたため）は、レイアウトが `navVariant="driver"` を渡し、`nav.tsx` 側で `navItemsFor()` により項目を組み立てる形に変更して解消済みです。

## 失敗したときの見方

- `npx playwright show-report` で HTML レポートを開くと、失敗したテストのスクリーンショットとトレース（操作の再生）を確認できます
- `tests/e2e/.logs/next-start.log`（Next.js）、`tests/e2e/.logs/supabase-lite.log`（互換サーバー。`E2E_VERBOSE=1` で全リクエスト）
- DB の状態は `psql postgresql://postgres@127.0.0.1:54329/rootive_e2e` で直接確認できます（実行後も PostgreSQL は残ります。`KEEP_PG=1` で明示）
- テストがアプリの不具合を見つけた場合は `test.fixme()` で残し、再現手順・期待・実際・該当ファイルを Issue に記録してください
