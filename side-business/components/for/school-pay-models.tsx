/**
 * /for/school の「この業種の支払でよくあること」。支払の形ごとに、小さな計算の例を lib/engine で計算して見せる。
 * 例の入力（架空）だけをここに書き、答えは毎回計算する。サーバーで描くだけで、状態は持たない。
 */
import { Card } from "@/components/ui";
import { calcThreshold, type ThresholdInput } from "@/lib/engine/payModels";
import {
  buildPayout,
  type Deduction,
  type Payee,
  type PayoutLine,
  type PayoutResult,
} from "@/lib/engine/statement";
import { LABOR_RISK_TEXT, en, num, percent } from "@/lib/engine/types";
import { SCHOOL } from "./school-example";

/** 例の支払先（架空・インボイス登録済みの個人。消費税は請求書で分けて書く） */
const PAYEE: Payee = {
  name: "例（架空）",
  invoiceRegistered: true,
  isCorporation: false,
  paysTaxOnTop: true,
};

/** 1人・1回の支払を計算する（見本と同じ月・同じ教室の前提） */
function payoutExample(
  lines: PayoutLine[],
  deductions?: Deduction[],
): PayoutResult {
  return buildPayout({
    payee: PAYEE,
    lines,
    deductions,
    serviceDate: SCHOOL.serviceDate,
    orderSideTaxMethod: SCHOOL.orderSideTaxMethod,
  });
}

/** 源泉の式（区分ごと） */
function formulas(r: PayoutResult): string {
  return r.withholdingGroups.map((g) => g.formulaText).join("、");
}

/** 振込額の式（報酬 ＋ 消費税 − 源泉 − 相殺） */
function payoutText(r: PayoutResult): string {
  const parts = [en(r.subtotal)];
  if (r.tax) parts.push(`＋ 消費税 ${en(r.tax)}`);
  if (r.withholding) parts.push(`− 源泉 ${en(r.withholding)}`);
  if (r.deductionsTotal) parts.push(`− 相殺 ${en(r.deductionsTotal)}`);
  return `${parts.join(" ")} = ${en(r.payout)}`;
}

type Model = {
  name: string;
  how: string;
  where: string;
  example: string[];
  /** 補足（計算の対象の範囲など） */
  note?: string;
  /** 判定はしない注意（労働者性など） */
  caution?: string;
};

function buildModels(): Model[] {
  // コマ給
  const koma = payoutExample([
    {
      label: "個別指導",
      model: "unit",
      input: { qty: 20, rate: 2_000, unitLabel: "コマ" },
      withholding: "ko1",
    },
    {
      label: "面談手当",
      model: "unit",
      input: { qty: 2, rate: 500, unitLabel: "回" },
      withholding: "ko1",
    },
  ]);

  // 月謝の歩合と教室の使用料
  const tuition = { students: 10, fee: 8_000, rate: 0.6 };
  const tuitionSales = tuition.students * tuition.fee;
  const roomFee = 3_000;
  const commission = payoutExample(
    [
      {
        label: "月謝の歩合",
        model: "commission",
        input: {
          categories: [
            {
              label: "担当する生徒の月謝",
              sales: tuitionSales,
              rate: tuition.rate,
            },
          ],
        },
        withholding: "ko1",
      },
    ],
    [
      {
        label: "教室の使用料",
        amount: roomFee,
        agreedInWriting: true,
        kind: "fee",
      },
    ],
  );

  // レッスン ＋ 参加人数の加算
  const bonus: ThresholdInput = {
    counts: [9, 10, 8, 12, 7, 9, 11, 10],
    base: 8,
    unitPrice: 200,
    countLabel: "人",
  };
  const lessons = Array.isArray(bonus.counts) ? bonus.counts.length : 1;
  const lesson = payoutExample([
    {
      label: "レッスン",
      model: "unit",
      input: { qty: lessons, rate: 3_500, unitLabel: "本" },
      withholding: "ko1",
    },
    {
      label: "人数の加算",
      model: "threshold",
      input: bonus,
      withholding: "ko1",
    },
  ]);
  const bonusDetail = calcThreshold(bonus).detail;
  const lessonLine = lesson.lines.find((l) => l.model === "unit");

  // 家庭教師（派遣型）：時間単価 × 時間 ＋ 報酬と一緒に払う交通費
  const visit = { minutes: 90, times: 8, hourly: 2_500, fare: 4_000 };
  const tutorHours = (visit.minutes * visit.times) / 60;
  const tutor = payoutExample([
    {
      label: "指導",
      model: "unit",
      input: { qty: tutorHours, rate: visit.hourly, unitLabel: "時間" },
      withholding: "ko1",
    },
    {
      label: "交通費",
      model: "fixed",
      input: { amount: visit.fare, text: `${visit.times}回分` },
      withholding: "ko1",
    },
  ]);

  // 教材・プリントの原稿（テストの出題料・採点料は原則として原稿の報酬に含まれないとされるので、例にしない）
  const writing = payoutExample([
    {
      label: "教材プリントの原稿",
      model: "unit",
      input: { qty: 3, rate: 5_000, unitLabel: "本" },
      withholding: "ko1",
    },
  ]);

  // 月額（担当クラス）＋ 追加のコマ、教室の運営の委託
  const monthly = payoutExample([
    {
      label: "担当クラス",
      model: "fixed",
      input: { amount: 60_000, text: "月額" },
      withholding: "ko1",
    },
    {
      label: "追加の授業",
      model: "unit",
      input: { qty: 2, rate: 3_000, unitLabel: "コマ" },
      withholding: "ko1",
    },
    {
      label: "教室の運営（受付・事務）",
      model: "fixed",
      input: { amount: 30_000, text: "月額" },
      withholding: "none",
      withholdingNeedsReview: true,
    },
  ]);
  const teachingLines = monthly.lines.filter((l) => l.withholding !== "none");
  const opsLines = monthly.lines.filter((l) => l.withholding === "none");

  return [
    {
      name: "コマ給（コマ単価 × コマ数 ＋ 手当）",
      how: "授業1コマの単価 × コマ数に、面談などの手当を足す。交通費を報酬と一緒に渡すことも多い",
      where: "学習塾の個別指導・集団授業など",
      example: [
        `例：${koma.lines.map((l) => `${l.label} ${l.detail}`).join("、")} → 報酬 ${en(koma.subtotal)}`,
        `→ 源泉：${formulas(koma)}`,
      ],
    },
    {
      name: "月謝の歩合（− 教室の使用料）",
      how: "担当する生徒の月謝の合計 × 講師の取り分の率。教室・楽器の使用料を契約で決めて相殺することもある（源泉は相殺の前の額に）",
      where: "音楽教室・英会話・習い事など",
      example: [
        `例：月謝 ${en(tuition.fee)} × ${num(tuition.students)}名 = ${en(tuitionSales)}、その${percent(tuition.rate)} → 報酬 ${en(commission.subtotal)}`,
        `→ 源泉は相殺の前の額に：${formulas(commission)}`,
        `→ 教室の使用料 ${en(commission.deductionsTotal)}はそのあとで相殺。振込 ${payoutText(commission)}`,
      ],
    },
    {
      name: "レッスン単価 ＋ 参加人数の加算",
      how: "レッスン1本の単価 × 本数に、1回の参加が基準の人数を超えた分 × 1人あたりの加算を足す",
      where: "ヨガ・ピラティス・フィットネス・ダンスなど",
      example: [
        `例：${lessonLine ? `${lessonLine.label} ${lessonLine.detail}、` : ""}1回ごとに基準の${num(bonus.base)}人を超えた人数を合計して ${bonusDetail} → 報酬 ${en(lesson.subtotal)}`,
        `→ 源泉：${formulas(lesson)}`,
      ],
    },
    {
      name: "家庭教師の時間単価（派遣型）",
      how: "時間単価 × 指導の時間 ＋ 交通費。センターが家庭から授業料を受け取り、講師へ払う形",
      where: "家庭教師センター・オンライン指導など",
      example: [
        `例：指導は ${visit.minutes}分 × ${visit.times}回 = ${num(tutorHours)}時間`,
        `${tutor.lines.map((l) => `${l.label} ${l.detail}`).join("、")} → 報酬 ${en(tutor.subtotal)}`,
        `→ 報酬と一緒に払う交通費も源泉の元に入れる：${formulas(tutor)}`,
      ],
      note: "家庭が講師へ直接払う紹介型は、センターが講師へ報酬を払わないので、この計算の対象外です。",
    },
    {
      name: "教材・プリントの原稿",
      how: "1本・1ページいくら。原稿の報酬として、授業と同じ1号。同じ月に授業の報酬と一緒に払うなら合計してから源泉を計算する",
      where: "教材・プリント・解説の執筆など",
      example: [
        `例：${writing.lines.map((l) => `${l.label} ${l.detail}`).join("、")}`,
        `→ 源泉：${formulas(writing)}`,
      ],
      note: "テストの出題料や答案の採点料は、国税庁の通達で原則として原稿の報酬に含まれないとされています（雑誌などに載せるものを除く）。作問を別の行で払うときは、源泉の区分を税理士に確かめてください。",
    },
    {
      name: "月額（担当クラス・教室の運営の委託）",
      how: "月額 ＋ 追加のコマ × 単価（欠講・振替は契約で決めた方法で精算）。授業の行と、教室の運営・事務の行で源泉の区分が分かれる",
      where: "担当クラスが決まっている講師・教室長の業務委託など",
      example: [
        `例：${monthly.lines.map((l) => `${l.label} ${l.detail}`).join("、")} → 報酬 ${en(monthly.subtotal)}`,
        `→ 源泉は授業の行（${teachingLines.map((l) => l.label).join("・")}）だけ：${formulas(monthly)}`,
        `→ ${opsLines.map((l) => l.label).join("・")}は「源泉なし・要確認」として計算（区分の最終の判断は税理士へ）`,
      ],
      caution: `勤怠や時間と結びついた固定の月額や、時間・場所・方法の細かい指示は、給与に近く見えることがあります。${LABOR_RISK_TEXT}`,
    },
  ];
}

const MODELS = buildModels();

export function SchoolPayModels() {
  return (
    <ul className="mt-2 grid gap-3 sm:grid-cols-2">
      {MODELS.map((m) => (
        <li key={m.name}>
          <Card className="h-full">
            <p className="font-bold">{m.name}</p>
            <p className="mt-1 text-sm">{m.how}</p>
            <p className="mt-1 text-xs text-muted-foreground">{m.where}</p>
            <div className="mt-2 rounded-lg bg-muted p-2 text-xs leading-relaxed [overflow-wrap:anywhere]">
              {m.example.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
            {m.note && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {m.note}
              </p>
            )}
            {m.caution && (
              <p className="mt-2 rounded-lg border border-warning p-2 text-xs leading-relaxed">
                <span className="font-bold text-warning">注意：</span>
                {m.caution}
              </p>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}
