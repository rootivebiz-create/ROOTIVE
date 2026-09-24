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

## ロールの扱い（代表 ＝ owner を含む）

| ロール | ログインの仕方（E2E） | ナビ・通知 |
|---|---|---|
| owner | `loginViaMagicLink(page, E2E.users.owner.email)` | サイドナビの先頭に「代表」（スマホは「メニュー」シートの中。下タブの 4 項目は変わらない）。ベルに「気になること」「未読のチャット」「決裁待ち」 |
| admin | `createInvitation({ role: "admin" })` ＋ `loginViaInvite` | 「代表」は出ない。ベルは「気になること」「未読のチャット」だけ |
| viewer | `createInvitation({ role: "viewer" })` ＋ `loginViaInvite` | 同上（編集 UI も出ない） |
| clerk（事務員） | `loginViaMagicLink(page, E2E.users.clerk.email, "/")`（global-setup が招待を入れておく） | ログインすると `/office`。ホーム・資金繰り・案件・財務・レポート・AI が出ず、開いても `/office` に戻される |
| driver | `createInvitation({ role: "driver", driverId })` ＋ `loginViaInvite` | ドライバーポータルの 3 項目のみ（ベルは出ない） |

- 出し分けの判定は純関数 `lib/nav/visibility.ts` の `visibleForRole(items, role)` 1 本で、ナビ（`components/layout/nav.tsx`）・コマンドパレット（`app/(app)/layout.tsx`）・設定の一覧（`app/(app)/settings/page.tsx`）が共用します（単体テストは `tests/nav.test.ts`）
- 画面を隠すだけでは足りないので、`/executive` 配下は `requirePageRole(["owner"])` でも閉じています。E2E では **admin・viewer が直接 URL を開いて `/dashboard` に戻される**ことまで確認します
- ヘッダーのベルは `AppShell` が受け取っている `badges`（href をキーにした件数）だけを材料にします。決裁待ちは `/executive` の件数として渡り、行き先は `/executive/approvals` です。0 件の行は出さず、全部 0 ならバッジも出しません

## 各 spec の内容

| ファイル | 内容 | 前提 |
|---|---|---|
| `auth.spec.ts` | 招待リンクでログイン／使用済みリンクは再利用不可／マジックリンク → ログアウト／不正トークン／未ログインは `/login?next=` へ | 会社と招待（global-setup） |
| `10-dashboard.spec.ts` | `/dashboard?m=2026-09` の KPI（会社売上 ¥2,559,573／会社利益 ¥652,490／支払合計 ¥1,907,083／利益率 25.5%）、ドライバー別表 8 名と合計、警告（相曽慧の管理費 ¥14,999 ≠ ¥15,000、稼働ゼロ 吉田雅一・高森豪介）、推移グラフ（`svg.recharts-surface`）、行タップで支払明細へ。未来月は「予定」 | `resetToSeed()` |
| `20-entries.spec.ts` | 一覧 10 行と合計 → 「＋ 稼働を追加」（吉田雅一・三郷Amazon・20 日：個別単価 21,960 が自動入力され「自動」表示、プレビュー会社売上 ¥460,500）→ 保存 → 11 行。**追加の所要時間が 30 秒未満**（§0。実測は 2〜3 秒）→ 編集（20 → 21）→ 削除（確認ダイアログ）→ 2026-10 に「前月から複製」（数量 0・「未入力」バッジ 10 件、再実行しても重複しない）→ 一括入力（Temu：藤田裕介 22・高森豪介 3 → toast「追加 1 件／更新 1 件／削除 0 件」） | `resetToSeed()` |
| `21-voice.spec.ts` | **声で稼働を入力**（「吉田 三郷アマゾン 15、相曽 三郷アマゾン 22」と文字で入れる → 読み取り中に「吉田雅一」「相曽慧」が出る → 内容を確認 → 既にある行だけ「いまの数量 21 → 22」→ 2 件を保存 → 10 行が 11 行に）／⌘K で「こえ」と打つと、どの画面からでも開く／ドライバーや案件が足りない行は保存ボタンが押せない。**マイクは使えないため、画面が用意している文字入力の経路で確かめる**（本番でも対応していない端末はこの経路になる） | `resetToSeed()` |
| `22-notifications.spec.ts` | **通知の設定**（設定 → 通知：既定は「自分あてだけ」→「すべての発言」に変えて保存 → 開き直しても残る → LINE への転送を切り替え → 未連携の案内 → 鍵が無い環境では端末への通知を案内だけにする → ドライバーはアカウント画面に「この端末の通知」が出る → 閲覧者も自分の通知を設定できる）。**端末への通知そのものはブラウザとプッシュサービスが要るため E2E では動かせない**ので、設定と案内の出し分けを確かめる | `resetToSeed()` ＋ 通知の設定を既定へ戻す |
| `23-dispatch.spec.ts` | **配車・シフト**（必要人数を入れる → 配車表に「この週は 3 人足りません」→ マスを開いて相曽慧を入れる → 自動で埋める → この週を確定 → ドライバーがポータルから休みを申請 → 管理者が承認 → 閲覧者は編集ボタンが出ない）。**週は「今日から 4 週間先の月曜」から作る**ので、いつ実行しても未来の週になる | `resetToSeed()` ＋ 配車・必要人数・休み希望の削除 |
| `24-compliance.spec.ts` | **法令対応**（台帳が空だと「運転者台帳の記入漏れ」「運転免許証の記録なし」→ 設定 → ドライバーで生年月日・住所・雇入れ・選任を入れると不足から消える → 運転者台帳タブに並ぶ → 安全管理で適性診断（初任）を記録すると「初任診断なし」が消える → 保存期間タブ → 運転者台帳 PDF（`%PDF`・5KB 超）・監査一式 ZIP（`PK`）・台帳 CSV（BOM つき）→ 閲覧者も出力はできる） | `resetToSeed()` ＋ 台帳・適性診断・指導・書類の削除 |
| `25-office.spec.ts` | **事務**（管理者で `/office`：今日やることに承認待ち・休み希望・報告がまだの人 → 「確かめて承認」で 1 件を承認 → 休み希望に「承認」→ 今日の報告は 済み／まだ／連絡手段なし（代わりに入力）→ LINE 連携済みの 1 人に「まとめて催促」→ 催促済み・ボタンが消える（1 日 1 回）→ 2026年9月の締めの手順 10 件（締める → 明細の送付 → 振込の順）・手作業のチェックの付け外しと付けた人の名前 → 「最初に開く画面にする」で `/` が事務へ（スマホは下タブの先頭も事務）→ アカウントでホームに戻す → 閲覧者は `/office` を開けずナビにも出ない） | `resetToSeed()` ＋ 配車・休み・催促・チェックの削除、承認待ちと休み希望を SQL で用意。終わったら `resetToSeed()` |
| `26-clerk-send.spec.ts` | **事務員と、事務の送る仕事**（事務員で `/` → `/office`、`/dashboard`・`/cashflow` は `/office` へ、ナビに経営の画面が無い、稼働入力に「行の利益」・支払に「会社利益」「支払一覧 CSV」が無い、出力に経営レポート・全データ JSON が無く `month-report.pdf` は 403 → 取引先の送り先メールが入った状態で「発行してメールで送る」→ 発行済み・送信済み・添付の PDF（1KB 超）・`invoice_sends` → 宛先 `fail@…` は失敗の理由が残る → 設定 → 月締め で 2026年9月を締めると **LINE で 2 人に連絡**（モックに 2 通・明細のリンク）→ 事務の手順は 締める → 明細の送付（「○ 人中 2 人に送りました」・LINE で送れる人は残っていない）→ 振込 の順、今日やることに「締めのあと」→ 支払の「支払明細の送付」で 1 人ずつの状態 → 相曽慧を選んで送り直す → PDF を渡した人・振込をチェックすると「締めのあと」が消える）と **使い方ガイド**（PC はヘッダーの「？」、スマホはメニューの「この画面の使い方」→「使い方：稼働入力」→ `/guide#entries`、事務員のガイドにホーム・資金繰り・最初の設定が出ない、ドライバーは「？」→ `/driver/guide`） | `resetToSeed()` ＋ 送付・送信・チェック・請求書・取引先の削除、LINE 連携（モック）と 2 人の LINE ID を SQL で用意。終わったら LINE 連携を外して `resetToSeed()` |
| `27-user-access.spec.ts` | **ユーザーごとの設定と代表を譲る**（代表が 設定 → ユーザー管理 →「閲覧者 を詳しく設定」→ 経営の数字・出力を「見せない」→ 保存 → `access_overrides` が `{management: deny, export: deny}`・一覧に「個別の設定 2」→ 閲覧者で `/` は `/entries`、`/dashboard`・`/reports` も `/entries` へ、ナビに経営の画面と出力が無い、出力のリンクが出ず `entries.csv` は 403、出力センターは「止められています」、RPC `can_see_management` は false・`cash_forecast` はエラー、アカウントの「見られる範囲」→ 事務員に経営の数字を見せると `/dashboard` が開ける（監査ログは開けない）→ 代表が「管理者」に代表を譲る（チェックを入れるまで押せない）→ 役割が入れ替わり、元の代表はユーザー管理を開けない → 新しい代表が RPC で譲り返す・代表でない人は譲れない） | ロールと見せる範囲を SQL で元に戻してから始め、終わったら戻す |
| `28-fiscal.spec.ts` | **期（事業年度）**（9 月決算・2024-04-15 設立にして、稼働入力で月の切り替えを押す →「第3期」「2025年10月〜2026年9月」・12 か月・2026年9月が選択中で「255万」・期の売上合計 → 前の期で第2期・第1期は 6 か月 → 次の期で第4期 → 2026年3月をひと押しで開く → 年次レポートは「第3期（2025年10月〜2026年9月）」で開き「第3期の合計」「前期比」・CSV は `fy=2026` で 2025-10〜2026-09 → 暦年で見る（`y=2026`・前年比）→ 期で見る → 前の期（`fy=2025`・「第2期のデータはありません」）→ 財務の予算を `fy=2026` で開くと 2025年10月〜2026年9月の表・9 月の目標を保存して「第3期の合計」128.0%・かんたん入力は「前期実績」（第2期の実績なし）→ 借入の「今期の返済」→ 税務は「2026年に決算を迎えるのは第3期」「2026年（第3期の決算）」→ 中期計画（第3期〜第4期）の第3期の実績 ¥2,559,573・「第3期の目標を月へ配る」で 12 か月に 250,000 ずつ → 会社設定の設立日と今の期、設立日を消すと「YYYY年9月期」） | `resetToSeed()`、決算月と設立日を SQL で設定し、終わったら 3 月・なしに戻す |
| `30-payouts.spec.ts` | `/payouts?m=2026-09`（相曽慧 税抜 ¥396,643／税込 ¥436,307）→ 明細（小計（税抜）・消費税（10%）¥39,664・お支払額（税込）・振込予定日 2026年10月31日・会社側の内訳 会社利益 ¥86,882）→ 「管理費・調整を編集」（管理費 15,000、リース代 −30,000 利益計上 → 税抜 ¥366,642／税込 ¥406,306）→ 明細テキストをコピー（小計（税抜）・消費税・お支払額（税込）の行を検証）→ 個人明細 CSV（BOM・「小計（税抜）」「消費税（10%）」「支払額（税込）」行）／PDF（`%PDF`、10KB 超）／印刷用ページ → 全員分の PDF（ZIP：`PK` シグネチャ・終端レコードのエントリ数 8・ファイル名 UTF-8、存在しない月は 404）→ 案件別（当月／全期間） | `resetToSeed()`（終了後に相曽慧の管理費・調整を初期値へ戻す） |
| `40-settings.spec.ts` | ドライバー追加（テスト太郎・率 10%・管理費 15,000）→ 一覧 → 編集で停止中 → 案件追加（テスト案件：配送A 日給／配送B 個数）→ 会社設定（住所・電話を保存 → 再表示で保持、印刷用明細に反映）→ ユーザー管理で viewer を招待（招待リンク `/invite/…` を表示）→ 監査ログ（drivers の INSERT／UPDATE）→ **ドライバー別単価**（黒岩亜夢莉の三郷Amazon 受注 23,500 を保存 → 「個別」バッジ・当月反映バナー → ダッシュボード警告 → 稼働入力の「単価変更あり」バッジと「マスタの値に更新」ダイアログ（行を選んで更新）→ 単価表で 23,600 に変更 → 「2026年9月 の稼働に反映」→ 案件ごとの見方 → 単価表 CSV の実効単価と出所）→ **会社設定の消費税**（税率 8%・四捨五入 → 明細の消費税 ¥31,731・お支払額（税込）¥428,374 → 戻す）→ **ロゴのアップロード**（`public/icons/icon-192.png` → `/api/company-asset/logo` が image/png → 印刷用ページと PDF に反映 → 削除で 404）→ **ドライバー別の支払日**（黒岩亜夢莉を翌々月 15 日 → 明細の振込予定日 2026年11月15日、他のドライバーは翌月末のまま → 戻す） | `seedInitialData()`、同名マスタの削除 |
| `50-closing.spec.ts` | 2026-09 を締める → 締め済みバッジ・締め日時・メモ・「バックアップ」→ 稼働入力に「稼働を追加」が無く締め済みバッジ、一括入力も無効 → 明細に編集ボタンが無い → データ画面の締め時バックアップ一覧に 2026年9月 → `/api/export/month-backup` が Storage の JSON を返す（存在しない月は 404）→ 締めを解除（owner）→ 追加ボタンが戻る → 再度締める → 監査ログに月締め・締め解除 | `seedInitialData()`、`setMonthClosed("2026-09", false)` |
| `60-roles.spec.ts` | **viewer**：追加・編集・削除・複製・一括入力が無い、`/settings/users`・`/settings/company` は `/dashboard` へ、`backup.json` は 403・`entries.csv` は 200、supabase-js からの書き込みも拒否（トリガー／RLS）。**driver**（相曽慧）：`/driver` に 2026年9月 税込 ¥436,307 → 明細に「お支払額（税込）」「小計（税抜）」があり「会社利益」「会社売上」が無い → 自分の PDF は 200、他人・未締め月・スタッフ向け出力は 403 → `/dashboard` 等は `/driver` へ → 未締め月は「集計中」→ ログアウト。**owner（代表）**：ナビとコマンドパレットに「代表」（`/executive`）が出る／**admin・viewer には出ず、`/executive`・`/executive/approvals` は `/dashboard` へ戻される**（`requirePageRole(["owner"])`）／ヘッダーのベルは 0 件なら「いまは何もありません」・44px 角、決裁待ちを 1 件入れると代表のベルにだけ「決裁待ち」が出る | `resetToSeed()`、driver の前に `setMonthClosed("2026-09", true)`、代表のテストの前にアラート・チャット・決裁を削除 |
| `70-expenses.spec.ts` | `/expenses?m=2026-09`：経費を 2 件追加（燃料費 ¥50,000・車両リース ¥120,000）→ KPI（固定費／変動費／経費合計）とカテゴリ別小計 → ダッシュボードの「経費」「営業利益 ¥482,490」→ **設定 → 経費カテゴリ**で「毎月かかる経費」（保険料 ¥30,000）を登録 → 経費画面で「毎月かかる経費をこの月に計上」（1 件 → 2 回目は 0 件）→ 経費 CSV → 締め済み月は編集 UI なし・閲覧者も追加不可 | `resetToSeed()`、経費の削除 |
| `75-invoices.spec.ts` | **設定 → 取引先**で取引先を登録 → 案件「三郷Amazon」に紐づけ → `/invoices?m=2026-09` で売上 ¥1,151,250 → 「請求書を作成」→ 明細・小計 ¥1,151,250／消費税 ¥115,125／合計 ¥1,266,375・番号 `202609-01` → 「発行済みにする」（作り直しボタンが消える）→ 「入金済みにする」→ 一覧に「入金済み」→ 請求書一覧 CSV と請求書 PDF（`%PDF`・5KB 超）→ 閲覧者は作成不可 | `resetToSeed()`、取引先・請求書の削除 |
| `80-reports.spec.ts` | `/reports?y=2026`：年間サマリー（売上 ¥2,559,573／経費 ¥200,000／営業利益 ¥452,490）・月次の内訳・ドライバー別／案件別／経費カテゴリ別 → 年次レポート CSV → ダッシュボードで月次目標（売上 260 万・営業利益 40 万）を設定 → 達成率 98.4% / 113.1% → 閲覧者は編集不可 | `resetToSeed()`、経費 2 件の投入 |
| `85-nav-portal.spec.ts` | ナビ（PC は 23 項目・入力／経営／管理／相談の見出し、スマホは下タブ 5 つ＋「メニュー」シートから経費へ）→ コマンドパレット（⌘K：「けいひ」で経費へ、「相曽」でドライバー候補、Esc で閉じる）→ 設定サブナビに取引先・経費カテゴリ → **ドライバーポータルの速報**（未締め月が「集計中」・税込 ¥436,307・「締め前のため変わることがあります」・年間サマリー）→ 会社設定で速報を止められる | `resetToSeed()` |
| `78-visibility.spec.ts` | **案件別採算**（目標利益率 30% を設定 → 「目標利益率を下回っている案件が 1 件あります」と「目標未達」→ 案件に紐づけた経費 50,000 が直課経費に出る）→ **資金繰り**（残高 1,500,000 を登録 → 未登録の案内が消え、最低残高が出る → 期間 30 日に切り替え → CSV）→ **ドライバー別採算**（一覧と単価シミュレーションの入力）→ ダッシュボードは締め済み月に着地見込みを出さない → 閲覧者は残高を登録できない | `resetToSeed()`、残高・経費・目標の削除 |
| `86-chat-alerts.spec.ts` | **社内チャット**（既定のルーム「全体」「経営」→ オーナーが発言 → **閲覧者も発言できる** → オーナーに未読 1 件 → 開くと既読）→ **気になること**（数量 0 の稼働を入れて「今すぐ検査する」→ 検知 → 対応済みにすると未対応から消え、対応済みタブに出る → CSV → 閲覧者はボタンが出ない → ダッシュボードのカードから一覧へ） | `resetToSeed()`、チャット・アラートの削除、数量 0 の稼働を 1 件投入 |
| `87-bank-ai.spec.ts` | **銀行 CSV**（2 列型の CSV を取り込み → 2 件取り込み・1 件を自動で消し込み → 請求書が「入金済み」→ 同じ CSV を再取り込みしても増えない → 消込を外すと「発行済み」に戻る → 出金を対象外に → CSV → 閲覧者はボタンが出ない）→ **AI の画面**（API キーが無くても開き、案内が出る） | `resetToSeed()`、取引先と請求書を投入、銀行データの削除 |
| `88-daily-fleet.spec.ts` | **車両と書類**（車両を登録 → 車検を期限切れ・任意保険を期限間近にする → 一覧で警告 → 検査すると「気になること」に期限切れと安全管理者の未選任が出る → 閲覧者は追加できない）→ **日報・点呼**（ドライバーが「今日の報告」で数量を送信 → 承認待ち → 管理者が承認 → 月次の稼働が `qty_source='daily'` になる → 点呼が無い日を検知 → 閲覧者は承認できない） | `resetToSeed()`、車両・書類・日報・日別の稼働・アラートの削除 |
| `89-intake-hr.spec.ts` | **実績ファイルの取り込み**（元請の CSV を読み込み → プレビューに「相曽慧」→ 取り込むと日別の稼働が 2 件入る → 閲覧者は読み込めない）→ **採用と契約**（20 日前の応募者が「フォロー漏れ」に出る → あと 10 日で期限の契約が「更新時期」で警告 → 閲覧者は追加できない） | `resetToSeed()`、取り込み・採用・契約・日別の稼働の削除 |
| `93-labor-notices.spec.ts` | **労務**（日報に 14 時間／16 時間の拘束と休息 7 時間を入れて、`/daily?tab=labor` に判定とアドバイスが出る → 労務 CSV / Excel → 設定 → 安全管理 で基準を 15 時間に変更 → 閲覧者は見られるが設定は開けない）→ **支払通知の突合**（通知を登録 → 明細が空の状態 → 差額を作って「今すぐ検査する」→「支払通知との差」が出る → 閲覧者は登録できない）→ **見積シミュレーター**（受注単価・支払単価・数量を入れると逆算した単価が出る）→ **週次サマリー**（「今週ぶんを作る」で `ai_insights.kind='weekly'` が 1 件 → ダッシュボードの AI カードはそれを拾わない） | `resetToSeed()`、日報・支払通知・週次サマリーの削除 |
| `94-executive.spec.ts` | **代表（owner）専用の領域**（代表ホームに信号・決裁・現金・今月の着地・いま見るべきことが出る → 管理者が `/executive` を開くとダッシュボードへ戻る → 閲覧者が `/executive/security` を開いても戻る → 管理者の申請を代表の決裁画面と代表ホームで拾う → 役員の任期・保険の満了が「いま見るべきこと」に出る） | `resetToSeed()`、決裁・意思決定・役員・保険・記録の削除 |
| `92-records.spec.ts` | **書類の検索**（レシートあり／なしの経費を 2 件入れて `/records` → 取引先・金額の下限・取引年月日の範囲で絞り込み → 「ファイル未保存のみ」→ 索引簿 CSV に条件が効く → 閲覧者も検索できる） | `resetToSeed()`、経費の投入と削除 |
| `91-finance-exports.spec.ts` | **財務**（年間予算：9 月の売上目標 200 万を保存 → 年間合計に実績 ¥2,559,573 と達成率 128.0% → 借入「運転資金」300 万・年利 1.8%・60 回を登録 → 返済予定 60 回・元金合計 300 万 → 資金繰りに反映 → 2027 年の税務の期限を一括作成 → 閲覧者は編集できない）→ **出力センター**（支払・請求・会計・分析・記録・バックアップのカード → `payouts.xlsx` が ZIP で `xl/worksheets/sheet1.xml` を含む → 経営レポート PDF（`%PDF`・5KB 超）→ 月次パック ZIP に README.txt）→ **振込データ**（口座未登録の警告 → 口座を登録すると全銀データが 120 バイト ＋ CRLF の倍数で返る → 閲覧者は 403） | `resetToSeed()`、借入・税務の期限・月次目標の削除 |
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

### 外部サービスのモック（LINE・メール）

本物の LINE やメールには送れないので、テストサーバー（supabase-lite）が受け口を用意しています。アプリは global-setup が渡す
`LINE_API_BASE`（`<lite>/__mock/line`）と `RESEND_API_BASE`（`<lite>/__mock/resend`）に送ります（本番では設定しない）。

| 受け口 | 動き |
|---|---|
| `POST /__mock/line/v2/bot/message/push` | 宛先と本文を記録して 200。宛先が `Ufail` で始まるときは 400 |
| `POST /__mock/resend/emails` | 宛先・件名・添付（名前と大きさ）を記録して `{ id }`。宛先に `fail` を含むときは 422 |
| `GET /__test/outbox?kind=line\|mail` / `POST /__test/outbox/clear` | 届いたものを見る／片づける |

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
| `projects-pl-mobile.png` | 案件ごとの採算（目標未達の警告つき） |
| `cashflow-mobile.png` | 資金繰り（残高の推移と予定の一覧） |
| `drivers-pl-mobile.png` | ドライバー別の採算と単価シミュレーション |
| `menu-sheet-mobile.png` | スマホの「メニュー」シート（経費・案件・レポート・設定と設定のサブ項目） |
| `dispatch-mobile.png` | 配車表（週の案件 × 日のマスと、足りない日の警告） |
| `compliance-mobile.png` | 法令対応（足りないものと監査一式の出力） |

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

現在 `test.fixme` / `test.skip` で残しているテストはありません（166 件すべて通過）。

以前 `60-roles.spec.ts` の「driver：ポータルに締め済みの自分の月だけ表示され…」を fixme にしていた不具合（本番ビルドで `/driver` が「エラーが発生しました」になる。`app/driver/layout.tsx` が lucide のアイコン関数を `"use client"` の `nav.tsx` に渡していたため）は、レイアウトが `navVariant="driver"` を渡し、`nav.tsx` 側で `navItemsFor()` により項目を組み立てる形に変更して解消済みです。

## 失敗したときの見方

- `npx playwright show-report` で HTML レポートを開くと、失敗したテストのスクリーンショットとトレース（操作の再生）を確認できます
- `tests/e2e/.logs/next-start.log`（Next.js）、`tests/e2e/.logs/supabase-lite.log`（互換サーバー。`E2E_VERBOSE=1` で全リクエスト）
- DB の状態は `psql postgresql://postgres@127.0.0.1:54329/rootive_e2e` で直接確認できます（実行後も PostgreSQL は残ります。`KEEP_PG=1` で明示）
- テストがアプリの不具合を見つけた場合は `test.fixme()` で残し、再現手順・期待・実際・該当ファイルを Issue に記録してください
