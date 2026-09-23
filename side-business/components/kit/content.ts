/**
 * 営業資料（提案書・FAX・チラシ）で使い回す文面と数字。
 * 料金は site.config.ts、経過措置の割合と負担額は lib/payroll/tax.ts から組み立て、ここに数字を手で書かない。
 *
 * 話の筋（すべての資料で同じ順番）：
 *   1. 元請の支払通知との突合（少ない可能性がある差を金額で・問い合わせ文の下書き）
 *   2. 10 月からの経過措置（控除 80%→70%）
 *   3. Excel をそのまま取り込み → 今の Excel と 1 人ずつ比べてから切り替え（並行運用）
 *   4. ドライバーが納得する明細（リンク・「確認しました」の記録・行ごとの質問）と、締め前の見張り番（事実と根拠だけ）
 *   5. データは御社のサーバーに。いつでも全部書き出せる
 *
 * 言わないこと（sales-kit/README.md の「守ること」）：未払いを取り戻せる・必ず合う・完全自動・ミスゼロ・適法・違反はない・
 * 仕入税額控除できる・補助金が使える・他社の名前や「ほかには無い」。判断は税理士・弁護士に残す。
 */
import { compactYen, jpDate, jpMonth, yenText } from "@/lib/format";
import { TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS, nonDeductibleTax } from "@/lib/payroll/tax";
import { buildWeeksText, trialPlan } from "@/lib/plans";
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

/** 差の金額（+1,000円 ／ −1,000円 ／ 0円）。マイナスは全角のマイナス記号 */
export function signedYen(value: number): string {
  if (value === 0) return yenText(0);
  return `${value > 0 ? "+" : "−"}${yenText(Math.abs(value))}`;
}

/** 割合の表示（0.7 → 70%） */
export function ratePct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/* ───────────── 期限 ───────────── */

/** 例に使う支払額（税込・1人・1か月） */
export const EXAMPLE_PAID = 110_000;

/** 80% → 70% に変わる日（2026-10-01） */
export const STEP_70 = TRANSITIONAL_STEPS.find((s) => s.rate === 0.7) ?? TRANSITIONAL_STEPS[1];
export const STEP_70_DATE = jpDate(STEP_70.from);
/** 70% の前の段（80%） */
const STEP_BEFORE_70 = TRANSITIONAL_STEPS[Math.max(0, TRANSITIONAL_STEPS.indexOf(STEP_70) - 1)];
/** 70% の次の段（2028年10月から 50%） */
const STEP_AFTER_70 = TRANSITIONAL_STEPS[TRANSITIONAL_STEPS.indexOf(STEP_70) + 1] ?? null;

/** 「控除80%→70%」 */
export const STEP_70_CHANGE = `控除${ratePct(STEP_BEFORE_70.rate)}→${ratePct(STEP_70.rate)}`;

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

/**
 * 「2026年10月1日から、免税ドライバーへの支払の控除80%→70%に。例：税込11万円の支払で、会社の負担は1人・月2,000円→3,000円（原則課税の会社）。」
 * FAX・チラシ・提案書で同じ文を使う
 */
export function burdenSentence(paid: number = EXAMPLE_PAID): string {
  const before = nonDeductibleTax(paid, STEP_BEFORE_70.from);
  const after = nonDeductibleTax(paid, STEP_70.from);
  return (
    `${STEP_70_DATE}から、免税ドライバーへの支払の${STEP_70_CHANGE}に。` +
    `例：税込${compactYen(paid)}の支払で、会社の負担は1人・月${yenText(before)}→${yenText(after)}（原則課税の会社）。`
  );
}

export const FREELANCE = {
  /** 公取委が日本郵便に勧告した日 */
  recommendedOn: "2026年9月2日",
  enforcedOn: "2024年11月1日",
} as const;

export const SAFETY = {
  deadline: "2027年3月31日",
} as const;

/* ───────────── いちばん先に言うこと ───────────── */

export const LEAD = {
  /** 見出しの前半（問いかけ） */
  question: "元請の支払通知と、自社の記録が合っているか。",
  /** 見出しの後半（申し出） */
  offer: "先月分で、差を金額でお見せします",
  /** 何の仕組みか（1 文） */
  what: "業務委託ドライバーの月末の締め（取り込み・支払明細・振込データ・締め前の点検・元請との突合）を、今のExcelのまま引き受ける仕組みです。",
} as const;

/** 「先月分で、差を金額でお見せします（お試し5万円）」。お試しが無ければ括弧を付けない */
export function leadOffer(): string {
  const trial = trialPlan();
  return trial ? `${LEAD.offer}（お試し${compactYen(trial.initialYen)}）` : LEAD.offer;
}

/* ───────────── 製品のデモの例（架空の会社。製品の server/seed-demo.ts と同じ値） ───────────── */

/**
 * 製品のデモ「サンプル運送株式会社（架空）」の 2026年10月分から写した例。実在の会社・人ではない。
 * 製品のデモのデータ（product/server/seed-demo.ts）を変えたら、ここも直す。
 */
export const DEMO_COMPANY = "サンプル運送株式会社（架空）";
export const DEMO_MONTH_LABEL = "2026年10月分";

export type ReconcileExampleRow = {
  project: string;
  unit: string;
  ours: { qty: number; price: number };
  theirs: { qty: number; price: number };
};

/** A物流（架空）の 10 月分の支払通知と、自社の記録（宅配は数量、夜間便は単価が違う。企業配は一致） */
export const RECONCILE_EXAMPLE: { client: string; rows: ReconcileExampleRow[] } = {
  client: "A物流（架空）",
  rows: [
    { project: "宅配（個建て）", unit: "個", ours: { qty: 4_950, price: 190 }, theirs: { qty: 4_520, price: 190 } },
    { project: "企業配（日当）", unit: "日", ours: { qty: 61, price: 22_000 }, theirs: { qty: 61, price: 22_000 } },
    { project: "夜間便", unit: "便", ours: { qty: 20, price: 12_000 }, theirs: { qty: 20, price: 11_500 } },
  ],
};

export type ReconcileLine = ReconcileExampleRow & {
  ourAmount: number;
  theirAmount: number;
  /** 通知 − 自社の記録（マイナスは受け取りが少ない可能性） */
  diff: number;
  kind: "一致" | "数量の違い" | "単価の違い" | "数量と単価の違い";
};

/** 突合の例を金額にする（通知 − 自社の記録）。少ない可能性の合計と件数も返す */
export function reconcileExample(example = RECONCILE_EXAMPLE): {
  client: string;
  lines: ReconcileLine[];
  short: number;
  shortCount: number;
  over: number;
  overCount: number;
} {
  const lines = example.rows.map((r): ReconcileLine => {
    const ourAmount = r.ours.qty * r.ours.price;
    const theirAmount = r.theirs.qty * r.theirs.price;
    const qtyDiff = r.ours.qty !== r.theirs.qty;
    const priceDiff = r.ours.price !== r.theirs.price;
    const kind = qtyDiff && priceDiff ? "数量と単価の違い" : qtyDiff ? "数量の違い" : priceDiff ? "単価の違い" : "一致";
    return { ...r, ourAmount, theirAmount, diff: theirAmount - ourAmount, kind };
  });
  const shorts = lines.filter((l) => l.diff < 0);
  const overs = lines.filter((l) => l.diff > 0);
  return {
    client: example.client,
    lines,
    short: -shorts.reduce((a, l) => a + l.diff, 0),
    shortCount: shorts.length,
    over: overs.reduce((a, l) => a + l.diff, 0),
    overCount: overs.length,
  };
}

/** 問い合わせ文の下書きの 1 文（製品が作る文面と同じ形） */
export function reconcileLetterLine(line: ReconcileLine): string {
  return (
    `当社の記録では ${line.project} ${line.ours.qty.toLocaleString("ja-JP")}${line.unit} × ${yenText(line.ours.price)} = ${yenText(line.ourAmount)}、` +
    `お支払通知では ${line.theirs.qty.toLocaleString("ja-JP")}${line.unit} = ${yenText(line.theirAmount)}（差 ${yenText(Math.abs(line.diff))}）`
  );
}

export type ParallelExampleRow = { name: string; ours: number; excel: number; reason: string | null };

/** 並行運用の例：製品のデモで、今の Excel の振込額を 3 人分貼り付けたとき（差の原因は候補で、断定しない） */
export const PARALLEL_EXAMPLE: ParallelExampleRow[] = [
  { name: "青木 翔太", ours: 357_555, excel: 320_105, reason: "消費税の扱いが違う可能性" },
  { name: "井上 美咲", ours: 357_720, excel: 372_720, reason: "Excel で「管理費」を引いていない可能性" },
  { name: "上田 健", ours: 245_740, excel: 245_740, reason: null },
];

/** 並行運用の例のまとめ（一致の人数・差の合計（しめ日ラボ − Excel）） */
export function parallelExample(rows = PARALLEL_EXAMPLE): { matched: number; total: number; diffTotal: number } {
  return {
    matched: rows.filter((r) => r.ours === r.excel).length,
    total: rows.length,
    diffTotal: rows.reduce((a, r) => a + (r.ours - r.excel), 0),
  };
}

/** ドライバーのスマホに出る明細の例（青木 翔太さん・10月分）。足すと振込額になる */
export const STATEMENT_EXAMPLE = {
  driver: "青木 翔太",
  lines: [
    { label: "宅配（個建て） 2,310個 × 150円", amount: 346_500 },
    { label: "スポット便 4件 × 7,000円", amount: 28_000 },
    { label: "消費税（10%）", amount: 37_450 },
  ],
  deductions: [
    { label: "ロイヤリティ（委託料の10%）", amount: -37_450 },
    { label: "管理費", amount: -15_000 },
    { label: "引かれているものの消費税", amount: -5_245 },
  ],
  adjustments: [{ label: "駐車場代の立替", amount: 3_300 }],
} as const;

export function statementExampleTotal(): number {
  const all = [...STATEMENT_EXAMPLE.lines, ...STATEMENT_EXAMPLE.deductions, ...STATEMENT_EXAMPLE.adjustments];
  return all.reduce((a, l) => a + l.amount, 0);
}

/** 製品のデモで、インボイスに登録していない 3 人への 10 月分の支払（税込） */
const DEMO_EXEMPT_PAID = [303_600, 385_000, 62_700];

export type WatchExample = { level: "赤" | "黄" | "お知らせ"; title: string; detail: string; basis: string | null };

/** 見張り番の例（製品のデモの 10 月分から要約）。事実と根拠だけで、判断の言葉は使わない */
export function watchExample(): WatchExample[] {
  const monthEnd = "2026-10-31";
  const now = DEMO_EXEMPT_PAID.reduce((a, p) => a + nonDeductibleTax(p, monthEnd), 0);
  const items: WatchExample[] = [
    { level: "赤", title: "取引条件の記録がありません", detail: "遠藤 大輔さん（10月分の支払額 294,800円）", basis: "フリーランス法 第3条" },
    { level: "赤", title: "合意の記録が無い控除があります", detail: "木村 誠さんの制服代 5,000円", basis: "フリーランス法 第5条" },
    { level: "黄", title: "振込先の口座がありません", detail: "木村 誠さん（振込額 34,430円）", basis: null },
    {
      level: "お知らせ",
      title: "免税の方への支払で、会社が控除できない消費税",
      detail:
        `${DEMO_EXEMPT_PAID.length}人分で月${yenText(now)}（控除${ratePct(STEP_70.rate)}）` +
        (STEP_AFTER_70 ? `。${jpMonth(STEP_AFTER_70.from)}からは${yenText(DEMO_EXEMPT_PAID.reduce((a, p) => a + nonDeductibleTax(p, STEP_AFTER_70.from), 0))}` : ""),
      basis: "インボイスの経過措置",
    },
  ];
  return items;
}

/* ───────────── 何ができるか・なぜ選ばれるか ───────────── */

export const PAINS = [
  { title: "元請の支払通知が合っているか、確かめる仕組みが無い", body: "数量や単価が違っていても、気づかないまま入金されているかもしれない" },
  { title: "毎月、Excelから打ち直している", body: "元請ごとに形が違い、並べ直すだけで時間がかかる" },
  { title: "「何を引かれたのか分からない」と聞かれる", body: "明細の説明や、個数が合わないという電話・LINE" },
  { title: "締める前の確認が、1人の頭の中にしかない", body: "取引条件の明示・控除の合意・口座の変更・支払期日" },
  { title: `${jpMonth(STEP_70.from)}から、免税ドライバーの分の負担が増える`, body: `インボイス未登録の方への支払の${STEP_70_CHANGE}に` },
  { title: "新しい仕組みの数字を、信じてよいか分からない", body: "今のExcelと合うのか、乗り換える前に確かめたい" },
] as const;

/** しめ日ラボが足すもの（提案書・チラシ・FAX の「できること」） */
export const FEATURES = [
  {
    title: "元請の支払通知との突合",
    body: "通知と自社の記録（数量×単価）を案件ごとに比べ、少ない可能性がある差を金額で出します。確認をお願いする文の下書きまで作ります。送るかどうかは御社が決めます",
    short: "少ない可能性がある差を金額で。問い合わせ文の下書きも",
  },
  {
    title: "Excelをそのまま取り込み",
    body: "今のExcel・CSVを形を変えずに置くだけ。打ち直しは要りません。一度読んだ形と、名前の表記ゆれは覚えます",
    short: "打ち直し不要。形と名前の表記ゆれを覚える",
  },
  {
    title: "ドライバーが納得する明細",
    body: "明細はリンクで渡します。アプリもパスワードも要りません。「確認しました」の記録と、行ごとの質問が残ります",
    short: "アプリ不要。「確認しました」の記録と質問",
  },
  {
    title: "締め前の見張り番",
    body: "取引条件の明示・合意の無い控除・口座・免税の方の分の負担などを、記録から分かる事実と根拠つきで出します。判断はしません",
    short: "記録から分かる事実を、根拠つきで",
  },
  {
    title: "今のExcelと比べてから切り替え",
    body: "先月分を今のExcelと1人ずつ比べ、差と原因の候補を出します。全員が一致するか、差の理由が分かってから切り替えます",
    short: "1人ずつ比べ、差の理由が分かってから",
  },
  {
    title: "振込データ（全銀形式）",
    body: "銀行に出せる振込ファイルを作ります。振込は御社が金額を確かめてから行います",
    short: "振込は御社が金額を確かめてから",
  },
] as const;

export const BENEFITS = [
  {
    title: "今のExcelのまま",
    body: "形を変えずに置くだけ。今の計算と1人ずつ比べてから切り替えます",
    short: "形を変えずに置き、比べてから切り替え",
  },
  {
    title: "データは御社のもの",
    body: "御社名義のサーバーに置きます。全部のデータを、いつでも書き出せます",
    short: "御社のサーバーに。いつでも書き出せる",
  },
  { title: "月額は定額", body: "ドライバーは何人でも同じ料金です", short: "ドライバーは何人でも同じ料金" },
] as const;

/** 「今の道具で十分では？」への答え（ほかの製品の名前は出さない。比べて悪く言わない） */
export const ENOUGH = {
  title: "今お使いの道具で足りているなら、それがいちばん安い",
  lead: "Excelの取り込みや会計ソフトへの出力は、ほかの道具にもあります。しめ日ラボが足すのは、次の4つです。",
  items: [
    { title: "元請の支払通知との突合", body: "少ない可能性がある差を金額で出し、問い合わせ文の下書きまで" },
    { title: "ドライバーの確認の記録", body: "「確認しました」の日時と、明細の行ごとの質問と返事が残る" },
    { title: "締め前の見張り番", body: "記録から分かる事実と根拠だけを、締める前に" },
    { title: "立ち上げは当方、データは御社", body: "先月分のExcelから当方が設定し、今のExcelと比べてから切り替え。データは御社のサーバーに" },
  ],
  close: "どれも要らなければ、今のままをおすすめします。",
} as const;

export const TRUST = [
  { title: "データは御社のサーバーに", body: "御社名義で契約したサーバーに置き、いつでも全部書き出せます" },
  { title: "お金には触れない", body: "作るのは振込データまで。振込は御社が行います" },
  { title: "AIに渡すものを限る", body: "当方は本番のデータをAIに入れません。製品のAIは、御社が同意したときだけ使います" },
  { title: "判断はしない", body: "事実と根拠まで。最終的な判断は税理士・弁護士に" },
] as const;

/** お試しで納めるもの（提案書・FAX・見積で同じ 4 つ） */
export const TRIAL_DELIVERABLES = [
  { title: "元請の支払通知との突合", body: "差の合計と件数、確認をお願いする文の下書き" },
  { title: "今のExcelとの比べ合わせ", body: "一致した人数と、差がある人の原因の候補" },
  { title: "締め前の見張り番", body: "いただいた記録から分かる事実だけ" },
  { title: `${jpMonth(STEP_70.from)}からの負担の目安`, body: "免税の方への支払で、会社が控除できない消費税" },
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

/** 先月分でお試し（FAX・チラシの 1 行）。お試しが無ければ null */
export function trialLine(): { title: string; body: string } | null {
  const trial = trialPlan();
  if (!trial) return null;
  return {
    title: `${trial.name}（${trial.weeks}・${compactYen(trial.initialYen)}）`,
    body: "先月の稼働のExcel・今の振込額・元請の支払通知をお預かりし（ドライバーの名前は番号に）、差を金額でお見せします。本契約なら初期費用から全額差し引きます。",
  };
}

/* ───────────── 導入の流れ ───────────── */

export type Step = { title: string; time?: string; body: string };

export function flowSteps(): Step[] {
  const trial = trialPlan();
  const buildTime = buildWeeksText(true);
  return [
    { title: "無料の相談", time: "30分", body: "今の締め方をうかがい、製品のデモをお見せします" },
    ...(trial
      ? [
          {
            title: trial.name,
            time: `${trial.weeks}・${compactYen(trial.initialYen)}`,
            body: "元請の通知との差と、今のExcelとの差を、先月分で測ります。本契約なら初期費用から全額差し引き",
          },
        ]
      : []),
    { title: "立ち上げ", time: buildTime, body: "御社のサーバーに置き、先月分のExcelから当方が設定します" },
    { title: "並行運用", time: "1〜2か月", body: "今のExcelと両方で締め、全員が一致するか、差の理由が分かってから切り替えます" },
    { title: "本番", body: "毎月の締めに。不具合の修正と制度の変更への対応は月額に入っています" },
  ];
}
