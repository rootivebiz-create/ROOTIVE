# ROOTIVE 利益管理システム 要件定義（オーナー指示書・原文）

株式会社ROOTIVE（軽貨物運送・業務委託ドライバー）の社内システム。
本書は実装判断の根拠となる仕様書であり、記載された決定事項はそのまま実装する。

---

## 0. ゴール・進め方・完成の定義

- ゴール：月ごとに「ドライバー × 案件」の稼働を入力するだけで、会社売上・会社利益・各ドライバーへの支払額が自動で確定するアプリ。スマホ最優先。長く使う前提（データ移行・バックアップ・監査ログ・テストを備える）。
- 進め方：計算ロジック → DB（スキーマ・ビュー・RLS） → 認証 → 画面 → 出力 → 移行 → テスト → 本番公開 の順。各段階で自動テストを書き、すべて通してから次へ進む。型チェック・Lint・本番ビルドも通す。
- 完成の定義（受け入れ基準）：
  - §2.6 の全テストケースが単体テストで一致（誤差 0.01 円以内）。SQL 側の集計ビューも同じ値を返す。
  - 閲覧者ロールで編集系の処理を直接叩いても拒否される（RLS と Server Action の両方）。
  - 締め済み月への書き込みが DB レベルで拒否される。
  - スマホ（幅 375px）で崩れず、稼働 1 行の入力が 30 秒以内に完了する。
  - 本番 URL でオーナーがログインでき、試作アプリの JSON を取り込んで合計が一致する。
  - 日本語のセットアップ手順書・運用ガイドが付属する。

---

## 1. 目的と業務ルール

1. 月ごとに「ドライバー × 案件」の稼働（数量）を入力すると、会社売上・会社利益・各ドライバーへの支払額が自動で確定する。
2. ドライバーごと・案件ごとに異なる契約条件（受注単価・支払単価・ロイヤリティ率・管理費・端数処理）を設定で管理でき、手計算をなくす。
3. メールアドレスによるログインと権限（オーナー／管理者／閲覧者／ドライバー本人）を持つ。
4. 数字の改ざん・誤編集を防ぐ（月締め、監査ログ）。

会社の利益の構成：

| 要素 | 内容 | 単位 |
|---|---|---|
| 単価差額利益 | （受注単価 − 支払単価）× 数量 | 稼働行ごと |
| ロイヤリティ | ドライバー売上（支払単価 × 数量）× ロイヤリティ率 | 稼働行ごと（率はドライバーごと） |
| 管理費 | 月額固定。稼働があった月に 1 回計上 | ドライバー × 月 |
| 調整 | 控除・加算（リース代相殺、ペナルティ、立替精算等）。会社利益に計上するかは項目ごとに選択 | ドライバー × 月 |

- 案件は「日給型（数量＝稼働日数、単価＝日額）」と「個数型（数量＝個数、単価＝1 個あたり）」がある。
- 同じ案件でもドライバーによって支払単価が異なる（例：三郷Amazon 支払 21,780 の人と 21,960 の人）。
- 同じ案件でも内容によって単価が異なる（例：和光ヤマト 宅急便 180/162、ネコポス 50/50）。
- 契約条件は変わるため、**稼働行には入力時点の単価・率・端数処理を記録（スナップショット）** し、後からマスタを変えても過去月の数字が動かないようにする。

用語：稼動月（YYYY-MM、締め処理の単位）／ドライバー（業務委託の運転手・支払先）／案件（稼働先）／内容（案件の中の単価区分。1 案件に 1 つ以上）／稼働行（ドライバー × 稼動月 × 案件内容 × 数量の 1 レコード）／会社売上／ドライバー売上／支払額／会社利益／月締め（稼動月を確定しロックすること）。

---

## 2. 計算仕様（正）

すべて円。内部は小数を許容し、表示時に整数へ丸める（表示丸めは四捨五入、負数は 0 から遠い方向）。CSV は生の値を出す。

### 2.1 稼働行
```
qty          = 数量（日数 or 個数、0 以上、小数可）
bill         = bill_rate × qty                         // 会社売上
pay          = pay_rate  × qty                         // ドライバー売上
margin       = bill − pay                              // 単価差額利益
royalty      = ROUND_MODE(pay × royalty_rate)          // ロイヤリティ額
entry_profit = margin + royalty                        // 行の会社利益
ROUND_MODE: none（丸めない・既定）／floor／round（四捨五入）／ceil
```
端数処理は **会社の既定値をドライバーごとに上書きでき、稼働行に入力時点の値を記録** する（優先順：稼働行 ← ドライバー設定 ← 会社設定）。

### 2.2 ドライバー × 月
```
mgmt_fee      = driver_months.mgmt_fee（数量 > 0 の稼働行が 1 件以上ある場合のみ計上。無ければ 0）
adj_pay       = Σ adjustments.amount                  // 符号付き。控除はマイナス
adj_profit    = Σ ( count_as_profit ? −amount : 0 )   // 利益計上にチェックした分だけ会社利益へ
payout        = Σpay − Σroyalty − mgmt_fee + adj_pay   // 支払額
driver_profit = Σmargin + Σroyalty + mgmt_fee + adj_profit
恒等式（検算）：Σbill = payout + driver_profit  ※利益計上なしの調整がある場合のみその分だけ崩れる
```
※「前月から複製」直後の数量 0 の行だけの月では管理費を計上しない（未入力状態で支払額がマイナスにならないようにするための決定事項）。

### 2.3 会社 × 月
会社売上・会社利益・支払額 ＝ 全ドライバー×月の合計。利益率 ＝ 会社利益 ÷ 会社売上（売上 0 なら 0）。

### 2.4 案件別
稼働行の合計のみ（管理費・調整は含めない）。

### 2.5 マスタからの自動入力（稼働行の新規作成時）
| 項目 | 取得元（優先順） |
|---|---|
| 受注単価 | 案件内容.bill_rate |
| 支払単価 | ドライバー個別単価（driver_pay_overrides）→ 案件内容.pay_rate |
| ロイヤリティ率 | ドライバー.royalty_rate → 会社設定.default_royalty_rate |
| 端数処理 | ドライバー.rounding_mode → 会社設定.rounding_mode |
| 管理費 | driver_months.mgmt_fee（初回作成時にドライバー.mgmt_fee を複写） |
保存後は稼働行の値が正となり、マスタ変更の影響を受けない。行ごとに手で書き換え可（例外扱い）。「マスタの値に戻す」ボタンを用意する。

### 2.6 計算テストケース（端数処理＝丸めない。必ず単体テスト化）
| ドライバー | 案件（内容） | 区分 | 数量 | 受注 | 支払 | 率 | 管理費 | 期待：会社利益 | 期待：支払額 |
|---|---|---|---|---|---|---|---|---|---|
| 相曽慧 | 三郷Amazon | 日給 | 21 | 23,025 | 21,780 | 10% | 14,999 | 86,882 | 396,643 |
| 金島幸太 | にほんばし蔵前郵便局 | 個数 | 803 | 180 | 162 | 10% | 0 | 27,462.6 | 117,077.4 |
| 沼田基 | にほんばし蔵前郵便局 | 個数 | 803 | 180 | 162 | 10% | 15,000 | 42,462.6 | 102,077.4 |
| 今井皇輝 | 和光ヤマト：宅急便 1,398（180/162）＋ ネコポス 749（50/50） | 個数 | — | — | — | 10% | 15,000 | 66,556.6 | 222,533.4 |
| 藤田裕介 | Temu | 日給 | 21 | 23,025 | 21,960 | 10% | 0 | 68,481 | 415,044 |
| 石田泰典 | 川口領家Amazon | 日給 | 16 | 21,133 | 20,250 | 12.5% | 15,000 | 69,628 | 268,500 |
| 黒岩亜夢莉 | 三郷Amazon | 日給 | 21 | 23,025 | 21,780 | 12.5% | 15,000 | 98,317.5 | 385,207.5 |
| 川島幹太 | 三郷Amazon 8 日（23,025/0）＋ 辰巳屋興業 1 日（8,500/0） | 日給 | — | — | 0 | 0% | 0 | 192,700 | 0 |

この 10 行の合計：売上 2,559,573／利益 652,490.3／支払 1,907,082.7（対象 8 名）。
※ 2026 年 9 月の実データの合計は 売上 2,704,970／利益 621,506.8／支払 2,083,463.2 と伝えられているが、上記 10 行とは一致しない。実データは試作アプリの JSON（§8.5）を取り込んで検証する。

---

## 3. ユーザー・権限・認証

| ロール | できること |
|---|---|
| owner | すべて。ユーザー招待・権限変更・会社設定・月締め解除・復元・データ全削除 |
| admin | ドライバー／案件／稼働／管理費・調整の登録・編集、月締め、CSV 出力、バックアップ |
| viewer | 全画面の閲覧と CSV 出力のみ。編集 UI は表示せず、サーバー側でも拒否 |
| driver | 自分の稼働と支払明細のみ（締め済み月のみ）。会社利益・他人の情報は見えない |

- Supabase Auth。**招待制（自由登録は禁止）**。ログインはメール＋マジックリンクを標準、パスワード設定も可。
- 招待フロー：オーナーがメールとロール（driver の場合は対応するドライバー）を入力 → `invitations` に行を作成（トークン付き、有効期限 7 日）→ Supabase の招待メールを送信。同時に **招待リンク `/invite/<token>`** を発行し、メールが届かない人には LINE 等で直接送れるようにする。招待リンクを開くとサーバー側で auth ユーザーを作成し、マジックリンクのトークンを検証してその場でログインさせる（メール不要）。
- `auth.users` の INSERT トリガーで、招待（メール一致・未受諾・未取消・期限内）を照合して `profiles` を作成する。招待が無ければ例外を投げて登録自体を拒否し、画面には「招待が必要です」と表示する。
- メール内リンクは `token_hash` 方式（`/auth/confirm?token_hash=…&type=…`）にして別端末でも開けるようにする。PKCE の `/auth/callback` も併設。
- ユーザー管理は owner のみ。無効化されたユーザーはすべてのデータにアクセスできない（RLS ヘルパーで `profiles.is_active` を確認）。
- 権限チェックはサーバー（Server Action / Route Handler）と DB（RLS）の二重。サービスロールキーはサーバー専用（招待・招待リンクログイン・バックアップ保存のみ）。
- 2 段階認証（Supabase TOTP）は将来有効化できる構成にしておく（UI は不要）。

権限マトリクス：ダッシュボード閲覧＝owner/admin/viewer、稼働の追加・編集・削除＝owner/admin、管理費・調整＝owner/admin、マスタ編集＝owner/admin、月締め＝owner/admin、締め解除＝owner、会社設定＝owner、ユーザー招待・権限変更＝owner、CSV 出力＝owner/admin/viewer（driver は自分の明細のみ）、バックアップ／復元＝owner（バックアップ出力は admin も可）、自分の支払明細閲覧＝driver。

---

## 4. 画面仕様

共通：画面上部に **稼動月セレクタ（前月／翌月／一覧）** を常時表示し、全画面がその月に連動する（URL の `?m=YYYY-MM`）。スマホは下タブナビ（ホーム／稼働／支払／案件／設定）、PC はサイドナビ。数字は等幅・右寄せ、マイナスは赤。ダークモード対応。PWA（ホーム画面追加）対応。締め済み月はロックアイコンとバッジで示し、未来月は「予定」と表示。

### 4.1 ダッシュボード
- KPI 4 つ：会社売上／会社利益／ドライバー支払合計／利益率（前月比を併記）。
- 売上の内訳バー：会社売上 ＝ 支払 ＋ 単価差額利益 ＋ ロイヤリティ ＋ 管理費（＋調整）を 1 本の積み上げバーで（各区分の金額と凡例も表示）。
- 利益の推移：直近 12 か月の棒グラフ（当月を強調、マイナスは赤、ホバーで内訳）。
- ドライバー別サマリー表（件数／会社売上／利益／支払額／利益率、合計行）。行クリックで支払明細へ。
- 警告（該当時のみ）：支払単価 > 受注単価の行（赤字）、今月の管理費がドライバー標準と異なる、稼働中なのに今月稼働ゼロのドライバー、数量 0 のままの行、過去月で未締め。各警告から該当画面へ遷移。
- AI 月次分析（任意）：環境変数 `ANTHROPIC_API_KEY` がある場合のみ表示。当月の集計 JSON を Claude に渡し 5 項目以内の所見を表示・保存。

### 4.2 稼働入力
- 当月の稼働行一覧（ドライバー絞り込み、検索、ドライバー順 → 登録順）。列：ドライバー／案件（内容）／数量／受注単価／支払単価／会社売上／ドライバー売上／単価差額利益／ロイヤリティ（率）／行の利益／備考。合計行。スマホはカード表示。
- 「＋ 稼働を追加」ダイアログ：①ドライバー（稼働中のみ）、稼動月（既定＝表示中の月）②案件 → 内容（内容が 1 つの案件は内容欄を非表示）③数量（ラベルは区分により「稼働日数」／「個数」。スマホはテンキー）④受注単価・支払単価・ロイヤリティ率・端数処理：自動入力（§2.5）。手で書き換え可、「自動／手入力」の表示、「マスタの値に戻す」⑤プレビュー：会社売上／ドライバー売上／単価差額利益／ロイヤリティ／行の利益をリアルタイム表示。「保存」「保存して続けて追加」。支払単価 > 受注単価は保存可だが赤字警告。
- 保存時にそのドライバー×月の `driver_months` が無ければ自動作成（管理費＝ドライバー標準、固定控除を複写）。
- 「前月から複製」：前月の稼働行を数量 0 で当月に複製（単価・率・端数処理は現在のマスタから再取得。停止中ドライバー・案件・内容は除外。既にある組み合わせはスキップ。冪等）。
- 「一括入力」：案件内容を 1 つ選び、稼働中ドライバー全員の数量をグリッドでまとめて入力・保存（既存行は更新、数量 0 は削除、単価は既存行のスナップショットを維持）。
- 締め済み月・viewer は編集 UI を出さない。

### 4.3 支払明細
- 当月のドライバー一覧：ドライバー売上／ロイヤリティ／管理費／調整／支払額／会社利益、合計行。
- 選択ドライバーの明細：稼働行ごとの「数量 × 支払単価 ＝ ドライバー売上」、ロイヤリティ行（率）、管理費行、調整行、支払額、振込予定日（会社設定：翌月末など）、会社側の内訳（会社売上・単価差額・会社利益・利益率）。
- 「管理費・調整を編集」ダイアログ：当月の管理費（標準値表示・標準に戻す）、メモ、調整の追加（項目名／金額（控除はマイナス）／会社利益に計上するか）。固定控除はワンタップで追加。支払額のプレビュー。
- 出力：支払一覧 CSV、個人明細 CSV、明細テキストコピー（LINE 送付用）、PDF 明細、印刷用ページ、弥生仕訳 CSV。

### 4.4 案件別
当月／全期間の切替。案件（内容）ごとに 件数／ドライバー数／数量／会社売上／ドライバー売上／単価差額利益／ロイヤリティ／利益（行）／利益率。注記：管理費・調整はドライバー単位のため含めない。

### 4.5 設定
1. ドライバー：一覧（名前／ロイヤリティ率／管理費／端数処理／個別単価の有無／固定控除／備考／稼働中・停止中／並び替え）。追加・編集：名前、かな、状態、ロイヤリティ率、管理費（月額）、端数処理（会社設定に従う／個別）、電話・メール・振込先メモ・メモ、案件内容ごとの個別支払単価（空欄＝標準）、固定控除（項目名／金額／利益計上／有効）。稼働行がある場合は削除不可（停止中にする）。
2. 案件・単価：一覧（案件／荷主・元請／内容／区分／受注単価／支払単価／差額／並び替え）。追加・編集：案件名、荷主・元請、状態、備考、内容の行（内容名／区分 日給・個数／受注単価／支払単価／有効）を複数。稼働行がある案件・内容は削除不可（停止中にする）。
3. 月締め：データがある月の一覧（件数／売上／利益／支払／状態／締め日時）。「この月を締める」（締め時点の集計スナップショットを保存し、バックアップ JSON を Storage へ自動保存）「締めを解除（owner のみ）」「締め時バックアップのダウンロード」。
4. 会社設定（owner）：会社名、ロイヤリティ額の端数処理の既定、新規ドライバーの標準ロイヤリティ率・標準管理費、振込予定日のルール（翌月末など）、明細の備考定型文、住所・電話・適格請求書登録番号、ドライバーポータルでロイヤリティ率を見せるか、弥生会計の勘定科目マッピング。
5. ユーザー管理（owner）：メール／表示名／ロール／状態／最終ログイン、招待の送信（メール ＋ 招待リンク表示）、ロール変更（driver は対応ドライバー選択）、無効化／有効化、招待の再送・取消、未ログインユーザーへの招待リンク再案内。
6. データ：当月・全期間の稼働 CSV、支払 CSV、弥生 CSV、バックアップ JSON 出力、締め時バックアップ一覧、JSON 取り込み・復元（owner。取り込み前に件数と月別集計のプレビューを表示して検算できること）、試作アプリ JSON からの移行取り込み（同じ画面）、データ全削除（owner、会社名の入力で確認）。
7. 監査ログ（owner/admin）：誰が・いつ・何を変更したか（テーブル別フィルタ、変更前後の差分、ページング）。
8. アカウント：表示名、パスワード設定・変更。

### 4.6 ドライバーポータル（driver ロール）
ログイン後、自分の月別支払明細だけを閲覧（締め済み月のみ。未締めは「集計中」）。明細詳細・PDF ダウンロード。会社利益・他ドライバーは非表示。

---

## 5. データモデル（Supabase / PostgreSQL）

主キー uuid、全テーブルに `company_id`（RLS で分離。将来の多社対応）。金額 numeric(12,2)、率 numeric(6,4)、時刻 timestamptz。

```
companies(id, name, rounding_mode none|floor|round|ceil, default_royalty_rate, default_mgmt_fee,
          payout_month_offset 0..3, payout_day 0=末日, statement_note, invoice_reg_no, address, tel,
          driver_portal_show_royalty bool, yayoi_accounts jsonb, created_at, updated_at)
profiles(id = auth.users.id, company_id, email, display_name, role owner|admin|viewer|driver, driver_id, is_active, …)
invitations(id, company_id, email, role, driver_id, display_name, token unique, expires_at, accepted_at, cancelled_at, invited_by, created_at)
drivers(id, company_id, name unique/company, kana, is_active, royalty_rate, mgmt_fee, rounding_mode null=会社設定,
        phone, email, bank_info, memo, sort_order, …)
projects(id, company_id, name unique/company, client_name, is_active, memo, sort_order, …)
project_items(id, company_id, project_id restrict, name default '標準', unit day|piece, bill_rate, pay_rate, is_active, sort_order, …, unique(project_id,name))
driver_pay_overrides(company_id, driver_id, project_item_id, pay_rate, pk(driver_id, project_item_id))
driver_recurring_adjustments(id, company_id, driver_id, label, amount, count_as_profit, is_active, sort_order)  -- 固定控除
work_entries(id, company_id, month date=月初日, driver_id restrict, project_item_id restrict, qty>=0,
             bill_rate, pay_rate, royalty_rate 0..1, rounding_mode, memo, created_by, updated_by, …)
             index(company_id,month) (driver_id,month) (project_item_id,month)
driver_months(id, company_id, month, driver_id, mgmt_fee, memo, unique(company_id,month,driver_id))
adjustments(id, company_id, driver_month_id cascade, label, amount 符号付き, count_as_profit, recurring_id, sort_order)
month_closings(company_id, month, status open|closed, closed_at, closed_by, reopened_at, reopened_by, snapshot jsonb, backup_path, note, pk(company_id,month))
audit_logs(id, company_id, actor_id, action, table_name, record_id, before jsonb, after jsonb, created_at)
ai_insights(id, company_id, month, model, findings jsonb, created_by, created_at)
```

ビュー（集計は SQL 側で持ち、画面とテストの両方から使う。`security_invoker = true`）：
- `v_work_entry_calc`：work_entries ＋ bill／pay／margin／royalty（端数処理は行の rounding_mode）／entry_profit ＋ ドライバー名・案件名・内容名・区分
- `v_driver_month_summary`：driver_months ＋ 稼働行合計 ＋ 調整 → mgmt_fee（数量 > 0 の行がある場合のみ）／payout／driver_profit
- `v_month_summary`：会社 × 月（＋締め状態）
- `v_project_summary`：案件内容 × 月
- `v_month_list`：データがある月の一覧（件数・売上・利益・支払・状態・バックアップパス）

トリガー・制約：
- work_entries／driver_months／adjustments の INSERT/UPDATE/DELETE は対象月が closed なら拒否（復元関数のみ一時的に回避可）。
- work_entries INSERT 時に driver_months が無ければ自動作成（mgmt_fee ＝ drivers.mgmt_fee）し、有効な固定控除を adjustments に複写。
- 子テーブルの company_id は親から自動補完。updated_at 自動更新。
- 監査ログ：主要テーブルの INSERT/UPDATE/DELETE を自動記録（差分の無い UPDATE は除く）。
- profiles の role/company_id/is_active/driver_id は owner のみ変更可。自分自身のロール変更・無効化は不可。
- month_closings の closed → open と削除は owner のみ。
- ドライバー／案件内容は稼働行が参照していれば削除不可（restrict）。率は 0〜1、金額・単価は 0 以上。

RLS：全テーブル `company_id = current_company_id()`（security definer のヘルパー関数で profiles を参照、is_active 必須）。書き込みは owner/admin。companies・invitations の更新は owner のみ（profiles は本人の display_name のみ可）。driver は work_entries／driver_months／adjustments を自分かつ締め済み月のみ SELECT、drivers・projects・project_items は自分に関係する行のみ。audit_logs は owner/admin のみ SELECT、書き込みはトリガーのみ。anon には一切の権限を与えない。

RPC：`copy_previous_month(month)`（admin+）、`close_month(month, note)`（admin+、スナップショット保存）、`reopen_month(month)`（owner）、`export_backup()`（admin+）、`import_backup(jsonb)`（owner、ID 一致は上書き、他社 ID と衝突すれば拒否）、`reset_company_data(会社名)`（owner）。

Storage：`backups` バケット（非公開）。月締め時に `<company_id>/<YYYY-MM>_<timestamp>.json` を保存し、署名付き URL でダウンロード。

---

## 6. 技術スタックと構成

- Next.js 15（App Router、Server Components、Server Actions）、TypeScript、Tailwind CSS、shadcn/ui 相当の UI
- Supabase（PostgreSQL、Auth、RLS、Storage）、`@supabase/ssr` で Cookie セッション（middleware でセッション更新）
- zod（入力スキーマをサーバー・クライアントで共用）
- Vitest（計算ロジック単体・§2.6 の全ケース必須、変換ロジック）、psql による SQL 結合テスト（ビューの計算・RLS・締めガード・招待制・復元）、Playwright（主要導線）
- `@react-pdf/renderer`（支払明細 PDF。日本語フォント Noto Sans JP を同梱）、`iconv-lite`（弥生 CSV の Shift_JIS）、Recharts（推移グラフ）
- Vercel（東京リージョン `hnd1`）、Supabase は東京リージョン、PWA manifest
- Server Action は「セッション取得 → ロール確認 → zod 検証 → DB → 監査（DB トリガー）→ revalidatePath」の順。エラーメッセージは日本語に変換。

ディレクトリ（案）：
```
app/(auth)/login, app/(auth)/invite/[token], app/auth/{confirm,callback,signout}
app/(app)/{dashboard,entries,entries/bulk,payouts,payouts/[driverId]/statement,projects,settings/{drivers,projects,months,company,users,data,audit,account}}
app/driver/*                       ドライバーポータル
app/api/export/{entries.csv,payouts.csv,statement.csv,statement.pdf,yayoi.csv,backup.json}
lib/calc（純関数）, lib/db（クライアント・型・クエリ）, lib/actions（Server Actions）, lib/schemas（zod）, lib/migrate（試作 JSON 変換）, lib/pdf, lib/exports, lib/yayoi
supabase/migrations（0001 スキーマ … 0006 Storage）, supabase/setup_all.sql（全結合・1 回貼るだけ）, supabase/seed/bootstrap_owner.sql, supabase/email-templates（日本語）
scripts/setup-supabase.sh, scripts/deploy-vercel.sh, scripts/migrate-prototype.ts
tests/calc.test.ts, tests/migrate.test.ts, tests/sql/{auth_stub.sql,run.sh,test.sql}, tests/e2e/
docs/SETUP.md, docs/OPERATIONS.md, docs/ARCHITECTURE.md, CLAUDE.md
```

---

## 7. 入力検証・業務ルール

- 稼動月 YYYY-MM。未来月の入力は可（予定）だが、ダッシュボードで「予定」表示。
- 数量 > 0 で保存可（0 は「前月から複製」直後の未入力状態としてのみ許容し、警告表示）。
- 支払単価 > 受注単価 は保存可だが赤字警告。ロイヤリティ率は 0〜100%。管理費・単価は 0 以上、小数 2 桁まで。
- ドライバー名・案件名は会社内で一意。締め済み月への変更はサーバー側で必ず拒否。
- 削除は稼働行・調整のみ物理削除。マスタは参照があれば「停止中」に切り替える。
- 数値入力は全角数字・カンマ入りも受け付けて正規化する。

---

## 8. 出力・移行

### 8.1 CSV（UTF-8 BOM、Excel でそのまま開ける）
- 稼働明細：稼動月, ドライバー, 案件, 内容, 区分, 数量, 受注単価, 支払単価, 会社売上, ドライバー売上, 単価差額利益, ロイヤリティ率, ロイヤリティ額, 行の利益, 備考
- 支払一覧：稼動月, ドライバー, 会社売上, ドライバー売上, 単価差額利益, ロイヤリティ, 管理費, 調整, 支払額, 会社利益
- 個人明細：稼働行・ロイヤリティ・管理費・調整・支払額

### 8.2 弥生会計 仕訳インポート CSV（Shift_JIS、25 列、ヘッダー無し）
売上：借方 売掛金／貸方 売上高（会社売上）。外注費：借方 外注費／貸方 未払金（ドライバー売上）。ロイヤリティ・管理費・調整（利益計上）：借方 未払金／貸方 雑収入（補助科目で区別）。利益計上なしの調整は立替金。結果として未払金の残高＝支払額。勘定科目・税区分・ドライバーごとに分けるかは会社設定で変更できる。

### 8.3 PDF 支払明細（A4 縦）
宛名（ドライバー名 様）、稼動月、会社名・住所・電話・登録番号・発行日、お支払額（強調）と振込予定日、稼働明細（案件／数量／単価／金額）、控除・調整（ロイヤリティ・管理費・調整）、支払額、備考。会社利益は載せない。ブラウザの印刷用ページも用意。

### 8.4 バックアップ JSON
全テーブルのスナップショット `{version, app, exported_at, company, drivers, projects, project_items, driver_pay_overrides, driver_recurring_adjustments, work_entries, driver_months, adjustments, month_closings}`。復元は owner のみ、ID 一致は上書き。

### 8.5 移行元：試作アプリ（Claude 上の「ROOTIVE 利益管理」）のバックアップ JSON
```json
{ "version": 1, "exportedAt": "...",
  "data": {
    "settings": { "app": { "companyName": "", "rounding": "none|floor|round|ceil", "defRoyalty": 0.1, "defMgmt": 15000 } },
    "drivers":  { "<id>": { "id", "name", "active", "royaltyRate", "mgmtFee", "rateOverrides": { "<projectId>|<itemId>": 21960 }, "memo", "order" } },
    "projects": { "<id>": { "id", "name", "client", "active", "memo", "order", "items": [ { "id", "name", "unit": "day|piece", "billRate", "payRate" } ] } },
    "entries":  { "<id>": { "id", "month": "YYYY-MM", "driverId", "driverName", "projectId", "projectName", "itemId", "itemName", "unit", "qty", "billRate", "payRate", "royaltyRate", "memo" } },
    "driverMonths": { "<YYYY-MM>_<driverId>": { "month", "driverId", "mgmtFee", "memo", "adjustments": [ { "label", "amount", "toProfit" } ] } },
    "months": { "<YYYY-MM>": { "status": "open|closed", "closedAt" } }
  } }
```
対応：drivers→drivers、projects/items→projects/project_items、rateOverrides→driver_pay_overrides、entries→work_entries（month は月初日、rounding は会社設定を複写）、driverMonths→driver_months＋adjustments、months→month_closings、settings.app→companies。ID は uuid v5（固定名前空間 ＋ 試作の ID）で決定的に生成し、同じファイルを何度取り込んでも重複しないようにする。取り込み画面で件数と月別集計（売上／利益／支払）をプレビューし、検算できること。CLI 版も用意。

### 8.6 初期データ（試作 JSON が無い場合の任意の初期投入）
- ドライバー 10 名：相曽慧、金島幸太、沼田基、今井皇輝、石田泰典、黒岩亜夢莉、藤田裕介、吉田雅一、川島幹太、高森豪介（平出将は登録しない）
- 案件：三郷Amazon（日給 23,025/21,780）、川口領家Amazon（日給 21,133/20,250）、Temu（日給 23,025/21,960）、にほんばし蔵前郵便局（個数 180/162、荷主 株式会社GALLOP9）、和光ヤマト（宅急便 180/162、ネコポス 50/50）、草加→鎌ヶ谷（日給 15,000/15,000）、辰巳屋興業（日給 8,500／支払 0）
- 個別単価：吉田雅一・高森豪介 → 三郷Amazon 支払 21,960
- 2026 年 9 月の稼働行は §2.6 の 10 行（相曽慧の管理費 14,999）

---

## 9. 非機能要件・品質

- 対応端末：iPhone／Android（Safari・Chrome 最新 2 版）、PC（Chrome・Edge・Safari）。幅 375px から崩れない。
- 性能：稼働行 10,000 件・ドライバー 100 名でダッシュボード 1 秒以内（集計はビュー＋月インデックス）。
- セキュリティ：RLS 必須、環境変数に秘密、HTTPS のみ、セキュリティヘッダー、監査ログ。
- バックアップ：月締め時に JSON を Storage へ自動保存。手動出力も可。
- 表記：日本語のみ。通貨 ¥、カンマ区切り、率は小数 1 桁 %。
- テスト：`npm test`（Vitest）、`npm run test:sql`（SQL 結合）、`npm run typecheck`、`npm run lint`、`npm run build` をすべて通す。可能なら Supabase 相当の環境（PostgreSQL ＋ GoTrue ＋ PostgREST）で主要導線をブラウザ E2E し、スクリーンショットで確認する。

---

## 10. 本番公開

1. Supabase プロジェクト（東京、無料プラン可）を作成。`supabase/setup_all.sql`（migrations 全結合 ＋ オーナー招待）を SQL Editor で 1 回実行、または Management API／CLI で適用。
2. 認証設定：自由登録 OFF、Site URL／Redirect URLs、メールテンプレートを日本語＋`token_hash` 方式に置換、カスタム SMTP（Resend 等）を案内。
3. Vercel にデプロイ（東京 `hnd1`）。環境変数 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_APP_URL`（任意 `ANTHROPIC_API_KEY`）。GitHub を使う場合は Private リポジトリ。
4. 最初のオーナー：SQL で会社と owner 招待（メール `rootive.biz@gmail.com`）を作成し、**招待リンク `/invite/<token>` を開くだけでメール無しでログイン**できる状態にする。
5. 動作確認：ダッシュボード表示、稼働追加、支払明細・PDF、月締め・解除、閲覧者の編集不可、試作 JSON の取り込みと合計一致。
6. 納品物：コード一式（Git 初期コミット済み）、`docs/SETUP.md`（手作業の公開手順）、`docs/QUICKSTART.md`（スクリプト自動化：`scripts/setup-supabase.sh` → `scripts/deploy-vercel.sh`）、`docs/OPERATIONS.md`（毎月の運用）、`docs/ARCHITECTURE.md`、`CLAUDE.md`。
7. アカウント作成・トークン発行・支払い（無料枠）はオーナーの作業。必要になった時点で、画面のどこで何をするかを具体的に案内すること。

## 11. 決定済み事項（再質問しない）

1. ロイヤリティ額の端数処理：会社の既定値（初期は「丸めない」＝Excel と同一）に加えてドライバーごとに設定でき、稼働行に入力時点の値を記録する。
2. 管理費は「数量 > 0 の稼働行が 1 件以上ある月」だけ計上する。
3. 川島幹太はオーナー本人（役員報酬 0 円のため業務委託の支払をしない）。支払単価 0・ロイヤリティ率 0%・管理費 0 で登録し、支払額 0 が正常。警告は出さない。
4. ユーザー管理（招待・権限変更）は owner のみ。招待制で自由登録は禁止。招待リンクでメール無しログインを可能にする。
5. 振込予定日は会社設定で「翌月末」を既定にし、明細に表示する。
6. 弥生仕訳は §8.2 の考え方。勘定科目・税区分は会社設定で変更可（税理士確認を前提）。
7. フェーズ2 のうち実装するもの：ドライバーポータル、PDF 明細、固定控除の毎月自動計上、弥生 CSV、監査ログ画面、一括入力、締め時バックアップ（Storage）、AI 月次分析（API キー設定時のみ）。後回し：LINE／メール通知、Google Drive 自動保存、2 段階認証の UI、複数会社の UI（データ構造は対応）。
8. 実データは基本的にオーナーが設定画面から入力する。マスタ・単価・率・端数処理・振込日・勘定科目など、固定値をコードに埋め込まず、すべて設定画面から変更できるようにする。

## 12. 未決事項（実装は既定値で進め、オーナーに確認する）

1. 相曽慧の 2026 年 9 月の管理費 14,999 は 15,000 の誤入力の可能性（ダッシュボードの警告で気づけるようにする）。
2. 弥生の勘定科目対応（税理士確認後に会社設定で変更）。
3. SMTP のプロバイダ（Resend 等）と独自ドメインの有無。
4. ドライバーポータルで見せる範囲（既定：ロイヤリティ率まで表示。会社設定で率を非表示にできる）。
