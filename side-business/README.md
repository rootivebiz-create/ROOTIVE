# しめ日ラボ（個人事業）

小さな運送会社向けの **月末の締めの製品「しめ日ラボ」**（`product/`）と、それを売るための個人事業のサイト・営業の道具です。
いちばん先に言うのは「**元請の支払通知と、自社の記録が合っているか。先月分で、差を金額でお見せします（お試し 5 万円）**」。
作るのは AI（Claude Code）、オーナーがやるのは商談とお試しの納品だけ（週 1〜2 時間）という前提で組んであります。

> この事業は **オーナーが経営する会社とは別の、オーナー個人の事業** です。会社のコード・データ・画面・名前・お客様は一切使いません（このフォルダのコードはすべて新しく書いたものです）。
> 始める前に、会社の承認（議事録）を必ず済ませてください → [`sales-kit/02-company-approval-minutes.md`](sales-kit/02-company-approval-minutes.md)

---

## 製品（お客様に納めるもの）

`product/` が、お客様に納める Web アプリです。**画面・立ち上げの手順・デモの公開・環境変数は [`product/README.md`](product/README.md)**、何を・なぜ・言ってはいけないことは [`product/SPEC.md`](product/SPEC.md) にあります。

- 業務委託ドライバーに支払う会社（5〜50 人ほど）の月末の締めを引き受ける：Excel をそのまま取り込み → 締め前の見張り番 → 支払明細（ドライバーへリンク・「確認しました」の記録）→ 全銀の振込データ → 締め。今の Excel と比べる並行運用と、元請の支払通知との突合つき
- **お客様 1 社ごとに、お客様名義の Vercel ＋ Postgres に置きます**（データはお客様のもの。サーバー代はお客様が直接払う）。立ち上げはオーナーが `product/scripts/provision.ts` で行います
- **製品のデモ**：来た人ごとに架空の会社を作り、24 時間で消えます。公開した URL をこのサイトの `NEXT_PUBLIC_PRODUCT_DEMO_URL` に入れると、サイトと営業資料に「製品のデモ」が出ます（入口は `<URL>/demo/start`）
- **お試しの納品物**（並行運用レポート・突合レポート）は、オーナーの手元のパソコンで動かす製品で作ります（→ [`sales-kit/03-weekly-routine.md`](sales-kit/03-weekly-routine.md) の 3-8）
- 製品は別のチームが直しています。営業資料の画面の名前・数字は、製品の README と製品のデモが正です

---

## お金の流れ

- お客様（運送会社）からの **初期費用と月額の保守料は、オーナー個人（屋号）の事業用口座に銀行振込** で入ります。会社は通りません。
- 料金は `site.config.ts` の `PLANS` が正です（お試し 5 万円／支払明細パック 初期 25 万円＋月 1.8 万円／利益まるごとパック 初期 48 万円＋月 3.5 万円／運行記録オプション 初期 15 万円＋月 1 万円、税抜。オプションは `OPTIONS`）。この README の金額は写しなので、違ったら `PLANS` を正にします。
- お客様の製品のサーバー代（Vercel の Pro と Postgres）は **お客様名義のアカウントでお客様が直接払う** 形にするので、こちらの費用はほぼかかりません。
- このサイト自体の運営費は、**Vercel Pro（月 20 ドル前後）とドメイン代（年 1,000〜3,000 円程度）** です。Vercel の無料プラン（Hobby）は商用で使えない決まりなので、事業のサイトは Pro にしてください。製品のデモは、同じ Pro のチームにプロジェクトを 1 つ足し、デモ専用の無料の Postgres（Neon か Supabase）を使います（使用量の枠は料金ページで確かめる）。

## サイトの中身

| ページ | 役目 |
|---|---|
| `/` | 紹介ページ（悩み・期限・できること・「今ので十分」への答え・作り手・料金・安心の仕組み・流れ・よくある質問・相談） |
| `/product` | 製品の紹介（画面・ひと月の流れ・しないこと・使うために必要なもの）。製品のデモへの入口 |
| `/demo` | 計算のデモ（ブラウザだけ）。稼働 → 支払明細 → 利益 → 全銀の振込データ。架空のデータで動き、入力は端末の中だけ。製品のデモ（`NEXT_PUBLIC_PRODUCT_DEMO_URL`）があればそこへも案内 |
| `/tools/invoice-cost` | 無料ツール：免税ドライバーへの支払で会社が負担する消費税（2026年10月から控除 70%） |
| `/tools/torihiki-joken` | 無料ツール：フリーランス法の取引条件明示書と、支払期日の 60 日チェック |
| `/tools/payout` | 無料ツール：業種別の報酬・源泉徴収・振込額の計算（運送・出版・IT・美容・講師の見本） |
| `/for/*` | 業種別のまとめ（検索からの入口） |
| `/articles` | 記事 10 本（10 月からの 70%・フリーランス法・支払明細・利益・安全管理者 など。出典つき） |
| `/contact` | 相談フォームと予約カレンダー |
| `/kit` | **オーナー専用**の印刷用の営業資料（提案書・FAX 原稿・紹介チラシ）。突合と 10 月からの 70% を先に言う順番。検索には出ません |
| `sales-kit/` | **オーナー専用**の営業の手順と文面（開業の手続き・議事録・週の回し方・紹介の文面・メール・FAX・商談と 5 分の製品のデモ・見積書・契約書・お試しの報告書・KPI） |

---

## 公開の手順（最初に 1 回、1〜2 時間）

### 1. 個人のリポジトリへ移す（おすすめ）

いまは会社のリポジトリの中の `side-business/` にあります。個人事業なので、**個人の GitHub アカウントのリポジトリへ移す** のが安全です。

```bash
# 会社のリポジトリで、side-business だけの履歴を切り出す
git subtree split --prefix side-business -b side-business-only
# 個人の GitHub で空のリポジトリを作ってから
git push git@github.com:<個人のアカウント>/<リポジトリ名>.git side-business-only:main
```

移したあとは、`.github/workflows/side-business.yml` を新しいリポジトリの `.github/workflows/ci.yml` に写し、`working-directory: side-business` と `cache-dependency-path` の `side-business/` を消してください。

### 2. Vercel で公開する

1. **個人の** Vercel アカウント（**Pro プラン**。無料の Hobby は商用不可）で「Add New → Project」→ 上のリポジトリを選ぶ
2. このまま会社のリポジトリで公開する場合は **Root Directory を `side-business`** にする（個人のリポジトリへ移したなら空のまま）
3. 下の環境変数を入れて「Deploy」
4. ドメインを取ったら「Settings → Domains」で追加し、`NEXT_PUBLIC_SITE_URL` をその URL にして再デプロイ
5. Vercel の Analytics タブで Web Analytics を有効にする（ページの表示回数・参照元を、Cookie を使わずに数えます。コードには `<Analytics />` を入れてあります）

### 3. 環境変数

個人の情報は Git に入れず、ここに入れます。**未設定の項目は画面に出ません**（営業の FAX 原稿だけは、未設定だと赤い注意が出ます）。

| 名前 | 必須 | 中身 |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | ◯ | 本番の URL（例 `https://shimebi-lab.jp`）。未設定なら Vercel の本番ドメイン（`VERCEL_PROJECT_PRODUCTION_URL`）を使います |
| `OWNER_NAME` | ◯ | 事業者名（氏名。屋号と並べて出ます） |
| `NEXT_PUBLIC_CONTACT_EMAIL` | ◯ | 事業用のメールアドレス |
| `BUSINESS_ADDRESS` | 営業メール・FAX を送るなら ◯ | 所在地（バーチャルオフィス可） |
| `BUSINESS_PHONE` | 営業メール・FAX を送るなら ◯ | 電話番号（050 番号など） |
| `INVOICE_REG_NO` | 登録後 | インボイスの登録番号（T＋13 桁） |
| `NEXT_PUBLIC_BOOKING_URL` | おすすめ | オンライン相談の予約ページ（Google カレンダーの「予約スケジュール」など） |
| `NEXT_PUBLIC_LINE_URL` | 任意 | LINE 公式アカウントの友だち追加 URL |
| `NEXT_PUBLIC_PRODUCT_DEMO_URL` | 製品のデモを公開したら ◯ | 製品のデモの URL（例 `https://…vercel.app`）。入口は `<URL>/demo/start`（末尾に付いていてもよい）。**未設定なら「製品のデモ」のリンクと QR は出ません**（提案書の QR は計算のデモ `/demo` を指します）。ビルドのときに読むので、変えたら再デプロイ。デモの公開のしかたは [`product/README.md`](product/README.md) |
| `CONTACT_WEBHOOK_URL` | どちらか ◯ | 相談フォームの通知先。**Discord のウェブフック URL がいちばん簡単**（スマホに通知が来ます）。Slack の Incoming Webhook でも可 |
| `RESEND_API_KEY` ＋ `CONTACT_TO_EMAIL` | どちらか ◯ | メールで受け取る場合（Resend の API キーと受け取るアドレス。`CONTACT_FROM_EMAIL` は独自ドメインを Resend で認証したら設定） |

相談フォームの通知先（`CONTACT_WEBHOOK_URL` か Resend）が **どちらも無いと、フォームは「準備中」になります**。公開したら自分で 1 回送って、届くか確かめてください。

### 4. 検索に出す

1. [Google Search Console](https://search.google.com/search-console) で本番の URL を追加
2. 「サイトマップ」に `sitemap.xml` を登録

---

## 最初の 30 日と、週 1〜2 時間の回し方

→ [`sales-kit/README.md`](sales-kit/README.md) にすべてあります。最初にやること（開業届・インボイス登録・青色申告・事業用口座・会社の承認）は [`sales-kit/01-owner-setup-checklist.md`](sales-kit/01-owner-setup-checklist.md)。

AI への頼み方（そのまま貼れる文）は [`sales-kit/03-weekly-routine.md`](sales-kit/03-weekly-routine.md) にあります。例：

- 「今週の反響をまとめて、送るものの下書きを作って」
- 「◯◯運送向けに、`/kit/proposal?company=◯◯運送` を使った提案書を作って」
- 「お試しの C001 の報告書を作って」（製品で作った並行運用レポート・突合レポートから。本番の個人情報は入れない。名前は番号に置きかえてもらう）

---

## 気をつけること

- **契約書・見積書のひな形**（`sales-kit/08`・`09`）は、使う前に一度 **弁護士** に見てもらってください。
- **税金**（インボイス登録・青色申告・簡易課税の届出の時期）は **税理士** に一度確かめてください。
- 記事とツールの制度の情報は **2026年9月時点** です。インボイスの経過措置（2028年10月から 50%）や源泉徴収の率が変わったら、`lib/payroll/tax.ts`・`lib/engine/withholding.ts` の表と記事を直します（AI に「制度が変わったので直して」と頼めば済みます）。
- 実績・お客様の声・時短の数字は、**本当にできてから** 載せます（それまでは載せない）。

---

## 開発する人向け

```bash
npm install
npm run dev          # http://localhost:3200
npm run check        # 型チェック・Lint・単体テスト・本番ビルド
npm run test:e2e     # ブラウザでの確認（先に npm run build。スマホ 375px とパソコン）
```

| 場所 | 中身 |
|---|---|
| `site.config.ts` | 屋号・料金（`PLANS`）・連絡先・事業者情報の読み取り。**料金はここだけ** |
| `lib/payroll/` | 運送向けの計算（支払明細・利益・経過措置・全銀の振込データ・貼り付け） |
| `lib/engine/` | 全業種向けの計算（数量×単価・歩合・段階歩合・最低保証・精算幅・源泉徴収・注意） |
| `lib/tools/` | 無料ツールの計算（負担額・取引条件明示書・60 日） |
| `lib/format.ts`・`lib/plans.ts` | 円・日付の書式（`yenText`・`compactYen`・`jpDate` など）と、`PLANS` からの料金の組み立て。画面ごとに同じ関数を書かない |
| `components/json-ld.tsx` | 構造化データ（`JsonLd`・`faqPageLd`） |
| `content/articles/*.md` | 記事。先頭の `title`・`description`・`published`・`category`・`order`・`sources` を書けば自動で載る |
| `app/kit/`・`components/kit/` | 印刷用の営業資料（`noindex`）。文面は `components/kit/content.ts`（突合・並行運用・見張り番の例は製品のデモの数字）、FAX の見出しは `fax-hooks.ts` |
| `product/` | お客様に納める製品（別の Next.js アプリ。[`product/README.md`](product/README.md)） |
| `tests/` | 単体テスト（Vitest）、`e2e/` ブラウザのテスト（Playwright） |

計算はすべて純関数で、テストがあります。金額は円の整数、源泉徴収は 1 円未満切り捨て、税率・経過措置の割合は日付つきの表で持ちます（画面に数字を直書きしない）。
