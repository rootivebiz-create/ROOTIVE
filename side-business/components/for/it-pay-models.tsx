/**
 * /for/it の「この業種の支払でよくあること」。支払の形ごとに、小さな計算の例を lib/engine で計算して見せる。
 * 例の入力（架空）だけをここに書き、答えは毎回計算する。サーバーで描くだけで、状態は持たない。
 */
import { Card } from "@/components/ui";
import { calcSettlement, type SettlementInput } from "@/lib/engine/payModels";
import {
  buildPayout,
  type Payee,
  type PayoutLine,
} from "@/lib/engine/statement";
import { en } from "@/lib/engine/types";
import { IT } from "./it-example";

/** 例の支払先（架空・インボイス登録済みの個人。消費税は請求書で分けて書く） */
const PAYEE: Payee = {
  name: "例（架空）",
  invoiceRegistered: true,
  isCorporation: false,
  paysTaxOnTop: true,
};

/** 精算幅の例（上下割と中間割で同じ条件を比べる） */
const RANGE_BASE = {
  monthly: 600_000,
  lower: 140,
  upper: 180,
  timeUnitMinutes: 15,
  unitPriceStep: 10,
} as const;
const RANGE_OVER_HOURS = 186.5;

function settlementExample(input: SettlementInput) {
  const r = calcSettlement(input);
  return {
    amount: r.amount,
    detail: r.detail,
    excess: r.settlement.excessUnitPrice,
    short: r.settlement.shortUnitPrice,
  };
}

/** 1人・1回の支払を計算して、源泉の式と一緒に返す */
function payoutExample(lines: PayoutLine[]) {
  const r = buildPayout({
    payee: PAYEE,
    lines,
    serviceDate: IT.serviceDate,
    orderSideTaxMethod: IT.orderSideTaxMethod,
  });
  return {
    subtotal: r.subtotal,
    withholding: r.withholding,
    formulas: r.withholdingGroups.map((g) => g.formulaText).join("、"),
    lines: r.lines,
  };
}

type Model = {
  name: string;
  how: string;
  where: string;
  example: string[];
};

function buildModels(): Model[] {
  const updown = settlementExample({
    mode: "updown",
    ...RANGE_BASE,
    actualHours: RANGE_OVER_HOURS,
  });
  const middle = settlementExample({
    mode: "middle",
    ...RANGE_BASE,
    actualHours: RANGE_OVER_HOURS,
  });
  const fixed = settlementExample({
    mode: "fixed",
    monthly: 900_000,
    actualHours: 160,
  });
  const prorated = settlementExample({
    mode: "fixed",
    monthly: 900_000,
    actualHours: 80,
    proration: { workedDays: 10, businessDays: 21 },
  });
  const hourlyHours = 120.4;
  const hourly = settlementExample({
    mode: "hourly",
    hourlyRate: 4_500,
    actualHours: hourlyHours,
    timeUnitMinutes: 15,
  });
  const deliverable = payoutExample([
    {
      label: "LP デザイン",
      model: "fixed",
      input: { amount: 200_000, text: "一式" },
      withholding: "ko1",
    },
    {
      label: "コーディング",
      model: "fixed",
      input: { amount: 150_000, text: "一式" },
      withholding: "none",
    },
  ]);
  const lecture = payoutExample([
    {
      label: "社内研修の講師",
      model: "unit",
      input: { qty: 2, rate: 40_000, unitLabel: "回" },
      withholding: "ko1",
    },
  ]);
  const rangeText = `月額 ${en(RANGE_BASE.monthly)}・精算幅 ${RANGE_BASE.lower}〜${RANGE_BASE.upper}時間・実働 ${RANGE_OVER_HOURS}時間なら`;

  return [
    {
      name: "月額 ＋ 精算幅（上下割）",
      how: "実働が上限を超えたら「月額 ÷ 上限」の超過単価で足し、下限を割ったら「月額 ÷ 下限」の控除単価で引く",
      where: "SES・準委任の常駐など",
      example: [
        `例：${rangeText}、超過単価 ${en(updown.excess ?? 0)}・控除単価 ${en(updown.short ?? 0)}（10円未満切り捨て）`,
        `→ ${updown.detail}`,
      ],
    },
    {
      name: "月額 ＋ 精算幅（中間割）",
      how: "超過も控除も「月額 ÷ 精算幅の真ん中の時間」の単価で精算する",
      where: "SES・準委任の常駐など",
      example: [
        `例：同じ条件なら、超過・控除とも ${en(middle.excess ?? 0)}（10円未満切り捨て）`,
        `→ ${middle.detail}（上下割との差 ${en(middle.amount - updown.amount)}）`,
      ],
    },
    {
      name: "月額固定（精算なし）",
      how: "実働の時間にかかわらず月額。月の途中で入る・抜けるときだけ営業日で日割り",
      where: "PM・コンサル・リードなど",
      example: [
        `例：月額 ${en(fixed.amount)}（実働が何時間でも同じ）`,
        `→ 月の途中から10営業日だけなら ${prorated.detail}`,
      ],
    },
    {
      name: "時間単価",
      how: "時間単価 × 実働（15分・30分単位などで丸める）",
      where: "副業・短時間の稼働など",
      example: [
        `例：実働 ${hourlyHours}時間を15分単位で切り捨てて`,
        `→ ${hourly.detail}`,
      ],
    },
    {
      name: "成果物（デザイン料・制作一式）",
      how: "点数 × 単価、または一式の金額。デザインの行は源泉徴収の対象（1号）、コーディングの行は対象外（Web デザインの扱いは下の「源泉徴収」を参照）",
      where: "Web 制作・UI デザイン・ロゴなど",
      example: [
        `例：${deliverable.lines.map((l) => `${l.label} ${en(l.amount)}`).join(" ＋ ")} = ${en(deliverable.subtotal)}`,
        `→ 源泉はデザインの行だけ：${deliverable.formulas}`,
      ],
    },
    {
      name: "原稿・翻訳・研修の講師料",
      how: "字数 × 単価、1本・1回あたりの金額など。源泉徴収の対象（1号）",
      where: "技術記事の執筆・翻訳・社内研修など",
      example: [
        `例：${lecture.lines.map((l) => `${l.label} ${l.detail}`).join("、")}`,
        `→ 源泉：${lecture.formulas}`,
      ],
    },
  ];
}

const MODELS = buildModels();

export function ItPayModels() {
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
          </Card>
        </li>
      ))}
    </ul>
  );
}
