/**
 * 営業資料（提案書・FAX・チラシ）で使い回す文面と数字。
 * 料金は site.config.ts、経過措置の割合と負担額は lib/payroll/tax.ts から組み立て、ここに数字を手で書かない。
 */
import { compactYen, jpDate, jpMonth, rangeYen } from "@/lib/format";
import { TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS, nonDeductibleTax } from "@/lib/payroll/tax";
import { buildPlans, buildWeeksText, trialPlan } from "@/lib/plans";
import { SITE } from "@/site.config";
import { makerCopy } from "./maker";

export type Source = { label: string; url: string };

export const SOURCES = {
  nta: { label: "国税庁「インボイス制度の見直し」（令和8年度税制改正）", url: TRANSITIONAL_SOURCE },
  jftc: { label: "公正取引委員会「フリーランス法に基づく勧告」", url: "https://www.jftc.go.jp/FL/FLkankoku/index.html" },
  lnews: { label: "LNEWS（2026年9月2日の記事）", url: "https://www.lnews.jp/2026/09/s0902505.html" },
  mlit: { label: "国土交通省（貨物軽自動車運送事業）", url: "https://www.mlit.go.jp/jidosha/jidosha_tk2_000172.html" },
} satisfies Record<string, Source>;

/** 「https://」を外した出典の URL（紙に載せる） */
export function shortSource(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/* ───────────── 期限 ───────────── */

/** 例に使う支払額（税込・1人・1か月） */
export const EXAMPLE_PAID = 110_000;

/** 80% → 70% に変わる日（2026-10-01） */
export const STEP_70 = TRANSITIONAL_STEPS.find((s) => s.rate === 0.7) ?? TRANSITIONAL_STEPS[1];
export const STEP_70_DATE = jpDate(STEP_70.from);

export type BurdenRow = { label: string; rateLabel: string; burden: number; current: boolean };

/** 例：税込11万円を払ったときの、会社の負担（期間ごと）。2,000円 → 3,000円 → 5,000円 → 7,000円 → 10,000円 */
export function burdenExample(paid: number = EXAMPLE_PAID): BurdenRow[] {
  return TRANSITIONAL_STEPS.map((s, i) => ({
    label: i === 0 && s.to ? `${jpMonth(s.to)}まで` : `${jpMonth(s.from)}から`,
    rateLabel: s.rate > 0 ? `控除${Math.round(s.rate * 100)}%` : "控除なし",
    burden: nonDeductibleTax(paid, s.from),
    current: s === STEP_70,
  }));
}

export const FREELANCE = {
  /** 公取委が日本郵便に勧告した日 */
  recommendedOn: "2026年9月2日",
  enforcedOn: "2024年11月1日",
} as const;

export const SAFETY = {
  deadline: "2027年3月31日",
} as const;

/* ───────────── 何ができるか・なぜ選ばれるか ───────────── */

export const PAINS = [
  { title: "月末のExcelが、特定の1人にしか分からない", body: "その人が休んだ月や辞めた月に、締められるかが心配" },
  { title: "控除が複雑で、市販のサービスに合わない", body: "管理費・ロイヤリティ・リース・その月だけの調整" },
  { title: "元請ごとに、締め日や明細の形が違う", body: "毎月、手で並べ直して確かめている" },
  { title: "どこで儲かっているのか分からない", body: "案件別・元請別・ドライバー別の利益が見えない" },
  { title: `${jpMonth(STEP_70.from)}から、免税ドライバーの分の負担が増える`, body: "インボイス未登録の方への支払の控除が80%→70%に" },
  { title: "フリーランス法への対応が気になる", body: "取引条件の明示書と、60日以内の支払期日" },
] as const;

export const BENEFITS = [
  { title: "今のExcelのルールのまま", body: "単価・控除・端数・元請ごとの締めを、そのまま再現します", short: "単価・控除・締めを、そのまま再現" },
  {
    title: "データもシステムも、御社のもの",
    body: "御社のアカウントに作り、ソースもお渡しします。やめても手元に残ります",
    short: "ソースもお渡し。やめても手元に残る",
  },
  { title: "月額は定額", body: "ドライバーは何人でも同じ料金です", short: "ドライバーは何人でも同じ料金" },
] as const;

export const FEATURES = [
  {
    title: "支払明細",
    body: "数量×単価、管理費・ロイヤリティなどの控除、消費税まで自動で計算。PDFで渡せます",
    short: "数量×単価・控除・消費税まで自動で計算",
  },
  {
    title: "振込データ（全銀形式）",
    body: "銀行に出せる振込ファイルを作ります。振込は御社が金額を確かめてから行います",
    short: "銀行に出せるファイル。振込は御社が行います",
  },
  { title: "案件別・元請別・ドライバー別の利益", body: "どこで儲かっているかを、毎月同じ形で出します", short: "どこで儲かっているかが、毎月分かる" },
  {
    title: "免税ドライバーの経過措置",
    body: "インボイス未登録の方への支払で、会社が控除できない消費税を月ごとに表示",
    short: "控除できない消費税を、月ごとに表示",
  },
  { title: "フリーランス法の取引条件明示", body: "取引条件の明示書と、支払期日（60日以内）のチェック", short: "明示書と、支払期日（60日以内）のチェック" },
] as const;

export const TRUST = [
  { title: "データとソースは御社のもの", body: "御社のアカウントに作り、ソースもお渡しします" },
  { title: "やめても困らない", body: "引き継ぎの資料とソースを渡し、別の会社が引き継げる形にします" },
  { title: "保守の範囲を書面で決める", body: "月額に何が入り、何が別料金かを、始める前に決めます" },
  { title: "1か月は今のExcelと並べて締める", body: "本番の前に、両方で締めて差がないかを確かめます" },
  { title: "本番の個人情報はAIに入れない", body: "AIは作る作業に使い、ドライバーの名前や口座は入れません" },
  { title: "お金には触れない", body: "作るのは振込データまで。振込は御社が行います" },
] as const;

/** 「作っている人」の段落。書き方は SITE.makerIsOperator で変わる（components/kit/maker.ts） */
export const MAKER = makerCopy().paragraph;

export const NOT_ADVICE =
  "お作りするのは、計算と書類づくりの仕組みです。税務・法律の判断はしません。最終的な判断は、税理士・弁護士・社労士にご確認ください。";

/** 無料診断（先月分の支払明細を見て、1枚にまとめて返す） */
export const FREE_CHECK = {
  title: "先月分の無料診断",
  body: "先月分の支払明細を、ドライバーの名前を番号に置きかえ、口座・住所の列を消してお送りください。記載の足りないところ・支払期日・免税の方の分の負担を、1枚にまとめてお返しします。",
} as const;

/* ───────────── 導入の流れ ───────────── */

export type Step = { title: string; time?: string; body: string };

export function flowSteps(): Step[] {
  const trial = trialPlan();
  const buildTime = buildWeeksText(true);
  return [
    { title: "無料の相談・診断", time: "30分", body: "オンラインで今の締め方をうかがいます。先月分の明細で無料診断もできます" },
    ...(trial
      ? [
          {
            title: trial.name,
            time: `${trial.weeks}・${compactYen(trial.initialYen)}`,
            body: "先月分で計算し、実際の支払額と突き合わせます。本契約なら初期費用から全額差し引き",
          },
        ]
      : []),
    { title: "構築", time: buildTime, body: "今のExcelのルールで、御社のアカウントに作ります。台帳は今のExcelから取り込みます" },
    { title: "並行運用", time: "1か月", body: "今のExcelと両方で締め、差が出たら理由を調べて直します" },
    { title: "本番", body: "毎月の締めに使います。不具合の修正や制度の変更への対応は月額の保守に入っています" },
  ];
}

/* ───────────── ほかの選び方との比較 ───────────── */

export const COMPARISON_CRITERIA = [
  { key: "fit", label: "形に合わせる必要" },
  { key: "monthly", label: "月額の決まり方" },
  { key: "data", label: "データの持ち主" },
  { key: "initial", label: "初期費用の目安" },
] as const;

type CriterionKey = (typeof COMPARISON_CRITERIA)[number]["key"];
export type Choice = { name: string; ours?: boolean; values: Record<CriterionKey, string> };

export const COMPARISON_NOTE = "2026年9月時点の公開情報をもとにした目安です。各社の最新の料金は、各社のサイトでご確認ください。";

export function comparisonChoices(): Choice[] {
  const packs = buildPlans();
  const trial = trialPlan();
  const monthly = packs.map((p) => p.monthlyYen);
  const initial = packs.map((p) => p.initialYen);
  return [
    {
      name: "1人あたり課金のアプリ",
      values: {
        fit: "あり。決まった画面と計算の形に合わせる",
        monthly: "ドライバー1人ごと（1人月1,000円前後）。人が増えると上がる",
        data: "サービス会社のサーバー。やめるときの持ち出しは各社の条件しだい",
        initial: "0円のことが多い",
      },
    },
    {
      name: "運送業向けのクラウドサービス",
      values: {
        fit: "あり。設定できる範囲で合わせる",
        monthly: "プランごと（月1万〜5万円前後）。機能や台数・人数で変わる",
        data: "サービス会社のサーバー。やめるときの持ち出しは各社の条件しだい",
        initial: "0円のところが多い。見積のところもある",
      },
    },
    {
      name: "ノーコードの業務アプリ（kintone など）・受託開発",
      values: {
        fit: "なし。自由に作れる",
        monthly: "ノーコードの業務アプリは、利用料＋作り込みの外注費。受託開発は、保守を頼むと別に費用",
        data: "ノーコードの業務アプリはサービス会社のクラウド。受託開発は契約しだい",
        initial: "作る範囲と外注先しだい",
      },
    },
    {
      name: SITE.name,
      ours: true,
      values: {
        fit: "なし。今のExcelのルールに合わせて作る",
        monthly:
          monthly.length > 0
            ? `定額（月${rangeYen(Math.min(...monthly), Math.max(...monthly))}）。ドライバーは何人でも同じ。サーバー代は御社が直接`
            : "定額。ドライバーは何人でも同じ",
        data: "御社のアカウントに置く。データもソースも御社のもの",
        initial:
          initial.length > 0
            ? `${rangeYen(Math.min(...initial), Math.max(...initial))}${trial ? `（お試し${compactYen(trial.initialYen)}は本契約で差し引き）` : ""}`
            : "お見積り",
      },
    },
  ];
}

/** 例：いちばん安い月額が、1人月1,000円前後のアプリなら何人分か（1.8万円 → 18人分） */
export function perHeadEquivalent(perHeadYen = 1_000): { monthly: number; heads: number } | null {
  const packs = buildPlans();
  if (packs.length === 0) return null;
  const monthly = Math.min(...packs.map((p) => p.monthlyYen));
  return { monthly, heads: Math.floor(monthly / perHeadYen) };
}
