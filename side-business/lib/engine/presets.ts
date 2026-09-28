/**
 * 業種ごとの見本（プリセット）。言葉（案件・支払先・数量の呼び方）、既定の源泉の区分、架空の見本の支払。
 * 見本の人名・会社名はすべて架空（名前に「架空」と入れる）。金額は buildPayout で計算し直して使う（ここに答えを書かない）。
 *
 * 対応するのは、業務委託の個人に払う業種の代表的な支払の形だけ（全業種ではない）。
 * 区分の最終判断は税理士へ。労働者性は判定しない。
 */
import type { PayoutInput, PayoutLine } from "./statement";
import type { WarningCode } from "./types";
import type { WithholdingCategory } from "./withholding";

export type PresetId = "trucking" | "publishing" | "it" | "beauty" | "school";

export type PresetTerms = {
  /** 案件の呼び方 */
  project: string;
  /** 元請の呼び方（売上の出所が元請でない業種は null） */
  client: string | null;
  /** 支払先の呼び方（1人） */
  payee: string;
  /** 支払先のまとめた呼び方 */
  payeeGroup: string;
  /** 数量の呼び方 */
  qty: string;
};

export type PresetSample = {
  id: string;
  /** 見出し（架空の名前入り） */
  title: string;
  /** この見本で見せたいこと */
  point: string;
  input: PayoutInput;
  /** この見本でわざと出している注意（これ以外が出たら見本の誤り） */
  expectedWarnings: WarningCode[];
  /** 請求側（元請への請求）。粗利を見せる見本だけ */
  billLines?: PayoutLine[];
};

export type IndustryPreset = {
  id: PresetId;
  label: string;
  shortLabel: string;
  terms: PresetTerms;
  defaultWithholding: WithholdingCategory;
  /** 行の種類ごとの源泉の区分の目安（最終判断は税理士へ） */
  withholdingHints: { item: string; category: WithholdingCategory; note?: string }[];
  /** 取引条件明示書に足す項目 */
  disclosureExtras: string[];
  /** 架空の会社名 */
  sampleCompany: string;
  /** 発注する側の消費税の計算方法（見本の前提） */
  orderSideTaxMethod: PayoutInput["orderSideTaxMethod"];
  /** 見本の役務の提供を受けた日 */
  serviceDate: string;
  /** 並べて見せる日（経過措置の前後） */
  compareServiceDates: string[];
  samples: PresetSample[];
  /** 業種の注意（ページ・道具に出す。判定はしない） */
  cautions: string[];
};

const OCT = "2026-10-31";
const COMPARE = ["2026-09-30", "2026-10-31"];

const registered = (name: string) => ({ name, invoiceRegistered: true, isCorporation: false, paysTaxOnTop: true });
const exemptWithTax = (name: string) => ({ name, invoiceRegistered: false, isCorporation: false, paysTaxOnTop: true });
const exemptNoTax = (name: string) => ({ name, invoiceRegistered: false, isCorporation: false, paysTaxOnTop: false });

/* ───────────── 軽貨物（基準） ───────────── */

const trucking: IndustryPreset = {
  id: "trucking",
  label: "軽貨物運送",
  shortLabel: "軽貨物",
  terms: { project: "案件（荷主・コース）", client: "元請・荷主", payee: "ドライバー", payeeGroup: "ドライバー", qty: "個数・日数・件数" },
  defaultWithholding: "none",
  withholdingHints: [{ item: "運送の報酬", category: "none", note: "所得税法204条1項に挙げられていない" }],
  disclosureExtras: ["管理費・ロイヤリティなど差し引くものの項目と計算方法", "車両・燃料・保険などの費用の負担"],
  sampleCompany: "サンプル軽便（架空）",
  orderSideTaxMethod: "general",
  serviceDate: OCT,
  compareServiceDates: COMPARE,
  samples: [
    {
      id: "trucking-a",
      title: "ドライバーA（架空・課税事業者）宅配",
      point: "数量 × 単価から、契約で決めたロイヤリティと管理費を差し引き、消費税を足す",
      input: {
        payee: registered("ドライバーA（架空）"),
        lines: [
          { label: "宅配", model: "unit", input: { qty: 2_400, rate: 150, unitLabel: "個" } },
          {
            label: "ロイヤリティ",
            model: "contractFee",
            input: { mode: "rate", base: 360_000, rate: 0.1, baseLabel: "委託料", agreedInWriting: true, basis: "業務委託契約" },
          },
          { label: "管理費", model: "contractFee", input: { mode: "fixed", amount: 5_000, agreedInWriting: true, basis: "業務委託契約" } },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
        paymentTerms: { receivedOn: OCT, payOn: "2026-11-30", monthlyClosing: true },
      },
      expectedWarnings: [],
      billLines: [{ label: "宅配", model: "unit", input: { qty: 2_400, rate: 180, unitLabel: "個" } }],
    },
    {
      id: "trucking-b",
      title: "ドライバーB（架空・免税事業者）企業配",
      point: "免税の方への支払で、発注する側が控除できない消費税（10月から控除できるのは70%）",
      input: {
        payee: exemptNoTax("ドライバーB（架空）"),
        lines: [
          { label: "企業配", model: "unit", input: { qty: 22, rate: 16_000, unitLabel: "日" } },
          { label: "管理費", model: "contractFee", input: { mode: "fixed", amount: 5_000, agreedInWriting: true, basis: "業務委託契約" } },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
        paymentTerms: { receivedOn: OCT, payOn: "2026-11-30", monthlyClosing: true },
      },
      expectedWarnings: ["exempt_no_tax_equivalent"],
      billLines: [{ label: "企業配", model: "unit", input: { qty: 22, rate: 20_000, unitLabel: "日" } }],
    },
  ],
  cautions: [
    "運送の報酬は源泉徴収の対象として挙げられていないため、源泉徴収はしません。",
    "控除（車両のリース・保険など）は、取引条件として明示し、合意したものだけにします。",
    "振込手数料は、支払う側（会社）が負担するのが安全です。取適法（旧・下請法）の運用では合意があっても報酬から差し引くと減額とされうるとされ、フリーランス法でも問題になりえます（判断は専門家へ）。",
  ],
};

/* ───────────── 出版・編集・Web メディア ───────────── */

const publishing: IndustryPreset = {
  id: "publishing",
  label: "出版・編集プロダクション・Webメディア",
  shortLabel: "出版・編集",
  terms: { project: "企画・媒体・号", client: "版元・クライアント", payee: "寄稿者", payeeGroup: "ライター・カメラマン・イラストレーター・著者", qty: "字数・ページ・カット・日・点・部" },
  defaultWithholding: "ko1",
  withholdingHints: [
    { item: "原稿料", category: "ko1" },
    { item: "撮影料", category: "ko1" },
    { item: "挿絵料・デザイン料", category: "ko1" },
    { item: "印税（著作権の使用料）", category: "ko1" },
  ],
  disclosureExtras: ["著作権などの知的財産権の扱い（譲渡か利用の許諾か、報酬に含むか）", "支払期日（刊行日ではなく、納品を受けた日から60日以内）"],
  sampleCompany: "サンプル編集室（架空）",
  orderSideTaxMethod: "general",
  serviceDate: OCT,
  compareServiceDates: COMPARE,
  samples: [
    {
      id: "publishing-a",
      title: "ライターA（架空・課税事業者）原稿料",
      point: "消費税が分けて書いてあるので、源泉は税抜の額に10.21%（1円未満切り捨て）",
      input: {
        payee: registered("ライターA（架空）"),
        lines: [{ label: "原稿料", model: "unit", input: { qty: 42_000, rate: 2, unitLabel: "字" }, withholding: "ko1" }],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "publishing-b",
      title: "ライターB（架空・免税事業者）ページ単価",
      point: "免税の方でも、請求書で消費税相当額を分けて書けば源泉は税抜の額に。控除できない負担も出す",
      input: {
        payee: exemptWithTax("ライターB（架空）"),
        lines: [{ label: "原稿料", model: "unit", input: { qty: 6, rate: 15_000, unitLabel: "ページ" }, withholding: "ko1" }],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "publishing-c",
      title: "カメラマンC（架空・課税事業者）撮影料と交通費",
      point: "報酬と一緒に払う交通費は源泉の元に入る",
      input: {
        payee: registered("カメラマンC（架空）"),
        lines: [{ label: "撮影料", model: "unit", input: { qty: 2, rate: 50_000, unitLabel: "日" }, withholding: "ko1" }],
        reimbursements: [{ label: "交通費", amount: 4_800, paidWithFee: true }],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "publishing-d",
      title: "イラストレーターD（架空・課税事業者）挿絵",
      point: "納品から61日目の支払は、60日の期限を過ぎる",
      input: {
        payee: registered("イラストレーターD（架空）"),
        lines: [{ label: "挿絵料", model: "unit", input: { qty: 12, rate: 8_000, unitLabel: "点" }, withholding: "ko1" }],
        serviceDate: "2026-10-01",
        orderSideTaxMethod: "general",
        paymentTerms: { receivedOn: "2026-10-01", payOn: "2026-11-30" },
      },
      expectedWarnings: ["over_60_days"],
    },
    {
      id: "publishing-e",
      title: "著者E（架空・課税事業者）印税",
      point: "印税 = 本体価格 × 部数 × 率。100万円以下なので10.21%",
      input: {
        payee: registered("著者E（架空）"),
        lines: [
          {
            label: "印税",
            model: "commission",
            input: { categories: [{ label: "本体価格1,800円 × 5,000部", sales: 9_000_000, rate: 0.1 }] },
            withholding: "ko1",
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "publishing-f",
      title: "著者F（架空・課税事業者）印税 150万円",
      point: "1回の支払で100万円を超える部分だけ20.42%",
      input: {
        payee: registered("著者F（架空）"),
        lines: [{ label: "印税", model: "fixed", input: { amount: 1_500_000, text: "印税" }, withholding: "ko1" }],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
  ],
  cautions: [
    "源泉は同一人に対する1回の支払で、100万円を超える部分だけ20.42%です（年の合計にはかけません）。",
    "同じ人への年の支払が5万円を超えたら、支払調書（翌年1月31日まで）の対象です。",
  ],
};

/* ───────────── IT・SES・受託開発・Web 制作 ───────────── */

const it: IndustryPreset = {
  id: "it",
  label: "IT・SES・受託開発・Web制作",
  shortLabel: "IT・SES",
  terms: { project: "案件・プロジェクト", client: "元請・エンド", payee: "技術者", payeeGroup: "エンジニア・デザイナー", qty: "実働時間・月・点・一式" },
  defaultWithholding: "none",
  withholdingHints: [
    { item: "システム開発・プログラミング", category: "none" },
    { item: "デザイン料", category: "ko1", note: "Web デザインを含めるのは実務の扱い（通達に Web の明記は無い）。最終判断は税理士へ" },
    { item: "原稿料・研修の講師料", category: "ko1" },
  ],
  disclosureExtras: ["精算幅・精算の方式・時間の丸め・単価の端数（請求側と支払側で別に決める）", "月の途中で入る・抜けるときの日割りの方法"],
  sampleCompany: "株式会社サンプルテック（架空）",
  orderSideTaxMethod: "general",
  serviceDate: OCT,
  compareServiceDates: COMPARE,
  samples: [
    {
      id: "it-tanaka",
      title: "田中（架空・課税事業者）上下割 140〜180時間",
      point: "上限を超えた6.5時間は、超過単価（700,000 ÷ 180 → 10円未満切り捨て 3,880円）で精算",
      input: {
        payee: registered("田中（架空）"),
        lines: [
          {
            label: "開発支援（準委任）",
            model: "settlement",
            input: { mode: "updown", monthly: 700_000, lower: 140, upper: 180, actualHours: 186.5, timeUnitMinutes: 15, unitPriceStep: 10 },
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
      billLines: [
        {
          label: "開発支援（準委任）",
          model: "settlement",
          input: { mode: "updown", monthly: 850_000, lower: 140, upper: 180, actualHours: 186.5, timeUnitMinutes: 15, unitPriceStep: 10 },
        },
      ],
    },
    {
      id: "it-sato",
      title: "佐藤（架空・免税事業者）下限割れ",
      point: "下限140時間に8時間足りない分を控除単価で差し引く。免税の方の控除できない負担も出す",
      input: {
        payee: exemptWithTax("佐藤（架空）"),
        lines: [
          {
            label: "開発支援（準委任）",
            model: "settlement",
            input: { mode: "updown", monthly: 600_000, lower: 140, upper: 180, actualHours: 132, timeUnitMinutes: 15, unitPriceStep: 10 },
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "it-suzuki",
      title: "鈴木（架空・課税事業者）PM 月額固定",
      point: "時間による精算の無い月額",
      input: {
        payee: registered("鈴木（架空）"),
        lines: [{ label: "PM（準委任）", model: "settlement", input: { mode: "fixed", monthly: 900_000, actualHours: 160 } }],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "it-watanabe",
      title: "渡辺（架空・課税事業者）10月15日から参画",
      point: "月額と精算幅を営業日で日割り（10月は営業日21日。スポーツの日を除く。15日から12日稼働）",
      input: {
        payee: registered("渡辺（架空）"),
        lines: [
          {
            label: "開発支援（準委任）",
            model: "settlement",
            input: {
              mode: "updown",
              monthly: 650_000,
              lower: 140,
              upper: 180,
              actualHours: 96,
              timeUnitMinutes: 15,
              unitPriceStep: 10,
              proration: { workedDays: 12, businessDays: 21 },
            },
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "it-takahashi",
      title: "高橋（架空・課税事業者）UI デザイン",
      point: "デザイン料の行だけ源泉1号（2行を合計してから10.21%）",
      input: {
        payee: registered("高橋（架空）"),
        lines: [
          { label: "バナー", model: "unit", input: { qty: 12, rate: 15_000, unitLabel: "点" }, withholding: "ko1" },
          { label: "LP デザイン", model: "fixed", input: { amount: 250_000, text: "一式" }, withholding: "ko1" },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "it-yamamoto",
      title: "山本（架空・課税事業者）ブランドデザイン一式",
      point: "1回の支払で100万円を超える部分だけ20.42%",
      input: {
        payee: registered("山本（架空）"),
        lines: [{ label: "ブランドデザイン", model: "fixed", input: { amount: 1_500_000, text: "一式" }, withholding: "ko1" }],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "it-nakamura",
      title: "中村（架空・課税事業者）請求と支払で精算幅がずれる",
      point: "請求は140〜200時間、支払は140〜180時間。実働195時間だと、支払だけ超過精算が出て粗利が縮む",
      input: {
        payee: registered("中村（架空）"),
        lines: [
          {
            label: "開発支援（準委任）",
            model: "settlement",
            input: { mode: "updown", monthly: 700_000, lower: 140, upper: 180, actualHours: 195, timeUnitMinutes: 15, unitPriceStep: 10 },
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
      billLines: [
        {
          label: "開発支援（準委任）",
          model: "settlement",
          input: { mode: "updown", monthly: 850_000, lower: 140, upper: 200, actualHours: 195, timeUnitMinutes: 15, unitPriceStep: 10 },
        },
      ],
    },
  ],
  cautions: [
    "精算幅（上下割・中間割）は法律ではなく契約の慣行です。方式・時間の丸め・単価の端数は契約ごとに決めます。",
    "システム開発の報酬は源泉徴収の対象として挙げられていません。デザイン料・原稿料・研修の講師料の行だけ1号です。",
  ],
};

/* ───────────── 美容・ネイル・リラクゼーション ───────────── */

const beauty: IndustryPreset = {
  id: "beauty",
  label: "美容室・ネイル・アイラッシュ・エステ・リラクゼーション",
  shortLabel: "美容・サロン",
  terms: { project: "店舗・メニュー区分", client: null, payee: "業務委託スタッフ", payeeGroup: "スタイリスト・ネイリスト・アイリスト・セラピスト", qty: "技術売上・コマ・指名本数・日" },
  defaultWithholding: "none",
  withholdingHints: [
    { item: "施術の報酬", category: "none", note: "所得税法204条1項に挙げられていない" },
    { item: "講習の講師料・デザイン料", category: "ko1" },
    { item: "モデル料", category: "ko4_standard", note: "4号。税額の出し方は1号と同じ（10.21%。1回の支払で100万円を超える部分は20.42%）" },
  ],
  disclosureExtras: ["売上の区分ごとの率と、率を掛ける売上が税込か税抜か", "材料費などを差し引く場合の項目と計算方法", "最低保証の有無と条件"],
  sampleCompany: "ヘアサロン ルミエ（架空）",
  orderSideTaxMethod: "general",
  serviceDate: OCT,
  compareServiceDates: COMPARE,
  samples: [
    {
      id: "beauty-sato",
      title: "佐藤（架空・免税事業者）区分ごとの歩合と材料費",
      point: "フリー・指名・店販で率を変え、契約に書いた材料費（技術売上の8%）を差し引く。9月と10月の負担を比べる",
      input: {
        payee: exemptNoTax("佐藤（架空）"),
        lines: [
          {
            label: "歩合",
            model: "commission",
            input: {
              categories: [
                { label: "フリー", sales: 420_000, rate: 0.45 },
                { label: "指名", sales: 680_000, rate: 0.6 },
                { label: "店販", sales: 60_000, rate: 0.15 },
              ],
            },
          },
          {
            label: "材料費",
            model: "contractFee",
            input: { mode: "rate", base: 1_100_000, rate: 0.08, baseLabel: "技術売上", agreedInWriting: true, basis: "業務委託契約（材料費）" },
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: ["exempt_no_tax_equivalent"],
    },
    {
      id: "beauty-tanaka",
      title: "田中（架空・課税事業者）超過累進の段階歩合",
      point: "〜50万円 40%／〜80万円 50%／80万円〜 60% を段階ごとに掛けて合計",
      input: {
        payee: registered("田中（架空）"),
        lines: [
          {
            label: "段階歩合",
            model: "tiered",
            input: {
              sales: 950_000,
              salesLabel: "技術売上",
              mode: "progressive",
              tiers: [
                { upTo: 500_000, rate: 0.4 },
                { upTo: 800_000, rate: 0.5 },
                { upTo: null, rate: 0.6 },
              ],
            },
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "beauty-suzuki",
      title: "鈴木（架空）面貸しの精算",
      point: "報酬ではなく、預かった売上から場所代と手数料を引いて返す精算",
      input: {
        payee: exemptNoTax("鈴木（架空）"),
        lines: [
          {
            label: "面貸しの精算",
            model: "chairRental",
            input: { salesCollected: 750_000, rent: { mode: "rate", rate: 0.4 }, cardFee: { mode: "fixed", amount: 12_960 } },
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "beauty-takahashi",
      title: "高橋（架空・課税事業者）ネイル・最低保証",
      point: "歩合と、保証の日額 × 日数 の多いほう。日数に結びついた保証には注意を出す",
      input: {
        payee: registered("高橋（架空）"),
        lines: [
          {
            label: "歩合（最低保証つき）",
            model: "guarantee",
            input: { commission: { categories: [{ label: "技術", sales: 380_000, rate: 0.5 }] }, dailyGuarantee: 8_000, days: 16 },
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: ["labor_risk_guarantee"],
    },
    {
      id: "beauty-ito",
      title: "伊藤（架空・課税事業者）セラピスト・コマと指名",
      point: "明示していないユニフォーム代と、遅刻の罰金を差し引くと注意が出る",
      input: {
        payee: registered("伊藤（架空）"),
        lines: [
          { label: "施術", model: "unit", input: { qty: 110, rate: 2_200, unitLabel: "コマ" } },
          { label: "指名", model: "unit", input: { qty: 45, rate: 500, unitLabel: "本" } },
        ],
        deductions: [
          { label: "ユニフォーム代", amount: 3_000, agreedInWriting: false, kind: "other" },
          { label: "遅刻の罰金", amount: 1_000, agreedInWriting: false, kind: "penalty" },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: ["reduction_risk", "reduction_risk", "labor_risk_penalty"],
    },
  ],
  cautions: [
    "施術の報酬は源泉徴収の対象として挙げられていません。講習の講師料・デザイン料の行は1号、モデル料の行は4号です（モデル料の税額の出し方は1号と同じ）。",
    "この道具は労働者性を判定しません。固定の日額保証・罰金・時間の拘束の設定には「リスクのある設計」とだけ知らせます。",
  ],
};

/* ───────────── 学習塾・スクール・フィットネス ───────────── */

const school: IndustryPreset = {
  id: "school",
  label: "学習塾・スクール・習い事・フィットネス",
  shortLabel: "スクール・講師",
  terms: { project: "教室・クラス・講座", client: null, payee: "講師", payeeGroup: "講師・インストラクター", qty: "コマ・レッスン・担当生徒数・参加人数" },
  defaultWithholding: "ko1",
  withholdingHints: [
    { item: "授業・レッスン（教授料）", category: "ko1" },
    { item: "教材の原稿（作問は要確認）", category: "ko1" },
    { item: "教室の運営事務", category: "none", note: "要確認" },
  ],
  disclosureExtras: ["欠講・振替の扱い", "教室の使用料などを相殺する場合の項目と金額", "交通費の扱い（報酬と一緒に払うと源泉の元に入る）"],
  sampleCompany: "さくら個別指導塾＆カルチャー教室（架空）",
  orderSideTaxMethod: "general",
  serviceDate: OCT,
  compareServiceDates: COMPARE,
  samples: [
    {
      id: "school-a",
      title: "大学生講師A（架空・免税事業者）コマ給",
      point: "コマ給・面談手当・交通費の定額を合計してから10.21%",
      input: {
        payee: exemptNoTax("大学生講師A（架空）"),
        lines: [
          { label: "個別指導", model: "unit", input: { qty: 40, rate: 1_800, unitLabel: "コマ" }, withholding: "ko1" },
          { label: "面談手当", model: "unit", input: { qty: 4, rate: 500, unitLabel: "回" }, withholding: "ko1" },
          { label: "交通費（定額）", model: "fixed", input: { amount: 6_000, text: "月額" }, withholding: "ko1" },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: ["exempt_no_tax_equivalent"],
    },
    {
      id: "school-b",
      title: "社会人講師B（架空・課税事業者）集団授業と教材プリント",
      point: "消費税が分けて書いてあるので、源泉は税抜の額に",
      input: {
        payee: registered("社会人講師B（架空）"),
        lines: [
          { label: "集団授業", model: "unit", input: { qty: 16, rate: 4_500, unitLabel: "コマ" }, withholding: "ko1" },
          { label: "教材プリントの原稿", model: "fixed", input: { amount: 10_000, text: "一式" }, withholding: "ko1" },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: [],
    },
    {
      id: "school-c",
      title: "ピアノ講師C（架空・免税事業者）月謝の歩合と教室の使用料",
      point: "源泉は相殺の前の額にかけ、教室の使用料はそのあとで差し引く",
      input: {
        payee: exemptNoTax("ピアノ講師C（架空）"),
        lines: [
          {
            label: "月謝の歩合",
            model: "commission",
            input: { categories: [{ label: "月謝（12名 × 9,000円）", sales: 108_000, rate: 0.55 }] },
            withholding: "ko1",
          },
        ],
        deductions: [{ label: "教室の使用料", amount: 5_000, agreedInWriting: true, basis: "業務委託契約（教室の使用）", kind: "fee" }],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: ["exempt_no_tax_equivalent"],
    },
    {
      id: "school-d",
      title: "ヨガ講師D（架空・免税事業者）レッスンと人数の加算",
      point: "1回の参加が基準の10人を超えた人数 × 300円を加算（12回で合計20人分）",
      input: {
        payee: exemptNoTax("ヨガ講師D（架空）"),
        lines: [
          { label: "レッスン", model: "unit", input: { qty: 12, rate: 4_000, unitLabel: "本" }, withholding: "ko1" },
          {
            label: "人数の加算",
            model: "threshold",
            input: { counts: [12, 12, 11, 10, 13, 12, 11, 12, 14, 10, 12, 11], base: 10, unitPrice: 300, countLabel: "人" },
            withholding: "ko1",
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
      },
      expectedWarnings: ["exempt_no_tax_equivalent"],
    },
    {
      id: "school-e",
      title: "教室長E（架空・課税事業者）運営の業務委託",
      point: "月額の運営業務は源泉の区分が要確認。勤怠と結びつく固定額と、請求書の受け取りを起点にした期日には注意が出る",
      input: {
        payee: registered("教室長E（架空）"),
        lines: [
          {
            label: "教室の運営",
            model: "fixed",
            input: { amount: 150_000, text: "月額", fixedSalaryLike: true },
            withholding: "none",
            withholdingNeedsReview: true,
          },
        ],
        serviceDate: OCT,
        orderSideTaxMethod: "general",
        paymentTerms: { receivedOn: OCT, payOn: "2026-12-31", monthlyClosing: true, basedOnInvoiceReceipt: true },
      },
      expectedWarnings: ["withholding_needs_review", "labor_risk_fixed_pay", "due_from_invoice_receipt", "over_60_days"],
    },
  ],
  cautions: [
    "教授料は源泉1号（10.21%）です。教室の使用料などの相殺は、源泉を計算したあとで差し引きます（元は減りません）。",
    "講師へ報酬と一緒に渡す交通費は、原則として源泉の元に入ります。",
    "この道具は労働者性を判定しません。時間割や指導方法の指定、授業以外の業務の指示が多い設計には注意を出します。",
  ],
};

export const PRESETS: IndustryPreset[] = [trucking, publishing, it, beauty, school];

export const PRESET_IDS: PresetId[] = PRESETS.map((p) => p.id);

export function getPreset(id: PresetId): IndustryPreset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`unknown preset: ${id}`);
  return preset;
}

/** 見本の役務の提供を受けた日だけ差し替える（経過措置の前後を並べるとき） */
export function withServiceDate(input: PayoutInput, serviceDate: string): PayoutInput {
  return { ...input, serviceDate };
}
