/**
 * /for/beauty の「この業種の支払でよくあること」。支払の形ごとに、小さな計算の例を lib/engine で計算して見せる。
 * 例の入力（架空）だけをここに書き、答えは毎回計算する。サーバーで描くだけで、状態は持たない。
 * 率・単価・日額はすべて架空の例で、相場を示すものではない。
 */
import { Card } from "@/components/ui";
import {
  calcChairRental,
  calcCommission,
  calcContractFee,
  calcGuarantee,
  calcTiered,
  calcUnit,
  type SalesCategory,
  type Tier,
} from "@/lib/engine/payModels";
import { bpText, en, percent } from "@/lib/engine/types";
import { applyBp } from "@/lib/engine/withholding";

/** 区分ごとの歩合の例（税抜の売上） */
const SPLIT: SalesCategory[] = [
  { label: "フリー", sales: 200_000, rate: 0.45 },
  { label: "指名", sales: 300_000, rate: 0.6 },
  { label: "店販", sales: 40_000, rate: 0.15 },
];

/** 段階歩合の例 */
const TIERS: Tier[] = [
  { upTo: 500_000, rate: 0.4 },
  { upTo: 800_000, rate: 0.5 },
  { upTo: null, rate: 0.6 },
];
const TIER_SALES = 820_000;
/** 全額スライドで、境目の前後を比べる売上 */
const EDGE_BELOW = 800_000;
const EDGE_ABOVE = 810_000;

/** 面貸しの例：カード払いの分の決済手数料（万分率。324 = 3.24%） */
const CARD_SALES = 200_000;
const CARD_FEE_BP = 324;
/** 定額の席料の例 */
const SEAT_DAILY = 3_000;
const SEAT_DAYS = 10;

/** 500,000円まで 40%／800,000円まで 50%／それより上 60% */
function tiersText(tiers: Tier[]): string {
  return tiers.map((t) => (t.upTo === null ? `それより上 ${percent(t.rate)}` : `${en(t.upTo)}まで ${percent(t.rate)}`)).join("／");
}

type Model = {
  name: string;
  how: string;
  where: string;
  example: string[];
};

function buildModels(): Model[] {
  const split = calcCommission({ categories: SPLIT });
  const splitIncl = calcCommission({ categories: SPLIT, rateAppliesTo: "incl" });

  const tier = (sales: number, mode: "slide" | "progressive") =>
    calcTiered({ sales, tiers: TIERS, mode, salesLabel: "技術売上" });
  const slide = tier(TIER_SALES, "slide");
  const progressive = tier(TIER_SALES, "progressive");
  const edgeBelow = tier(EDGE_BELOW, "slide");
  const edgeAbove = tier(EDGE_ABOVE, "slide");

  const guarantee = calcGuarantee({
    commission: { categories: [{ label: "技術", sales: 200_000, rate: 0.5 }] },
    dailyGuarantee: 8_000,
    days: 16,
  });

  const koma = calcUnit({ qty: 80, rate: 2_000, unitLabel: "コマ" });
  const nominated = calcUnit({ qty: 20, rate: 500, unitLabel: "本" });

  const nail = calcCommission({ categories: [{ label: "施術", sales: 300_000, rate: 0.5 }] });
  const material = calcContractFee({
    mode: "rate",
    base: 300_000,
    rate: 0.08,
    baseLabel: "施術売上",
    agreedInWriting: true,
    basis: "業務委託契約（材料費）",
  });

  const cardFee = applyBp(CARD_SALES, CARD_FEE_BP);
  const rental = calcChairRental({
    salesCollected: 300_000,
    rent: { mode: "rate", rate: 0.4 },
    cardFee: { mode: "fixed", amount: cardFee },
  });
  const seat = calcChairRental({ salesCollected: 250_000, rent: { mode: "fixed", amount: SEAT_DAILY * SEAT_DAYS } });

  return [
    {
      name: "売上の区分ごとの歩合（フリー・指名・店販）",
      how: "区分ごとの売上 × 区分ごとの率を合計する。率を掛ける売上が税込か税抜かは、サロンごとに違うので契約で決める",
      where: "美容室のスタイリスト・アイリストなど",
      example: [
        `例：${split.detail}`,
        `→ 同じ売上でも、率を税込の売上に掛ける契約なら ${en(splitIncl.amount)}（差 ${en(splitIncl.amount - split.amount)}）`,
      ],
    },
    {
      name: "段階歩合（全額スライド・超過累進）",
      how: "売上が増えると率が上がる。売上の全額にその段階の率を掛ける「全額スライド」と、段階ごとの部分に率を掛けて足す「超過累進」がある",
      where: "美容室・ネイル・エステなど",
      example: [
        `例：${tiersText(TIERS)}、技術売上 ${en(TIER_SALES)}なら`,
        `全額スライド：${slide.detail}`,
        `超過累進：${progressive.detail}`,
        `→ 全額スライドは境目で跳ねる（${en(EDGE_BELOW)}なら ${en(edgeBelow.amount)}、${en(EDGE_ABOVE)}なら ${en(edgeAbove.amount)}）。どちらの方式かを契約に書いておく`,
      ],
    },
    {
      name: "最低保証つきの歩合",
      how: "歩合と「保証の日額 × 日数」の多いほうを払う",
      where: "ネイル・アイラッシュ・リラクゼーションなど",
      example: [
        `例：${guarantee.detail}`,
        "→ 日数や時間に結びついた保証には、計算の道具が「労働者性のリスクがある設計です」と注意を出します（判定はしません）",
      ],
    },
    {
      name: "コマ単価 ＋ 指名の還元",
      how: "施術の時間をコマに直してコマ単価を掛け、指名の本数 × 還元額を足す（オプションの売上 × 率を足すことも）。当日キャンセルの扱いも決めておく",
      where: "リラクゼーション・エステのセラピストなど",
      example: [`例：${koma.detail}、${nominated.detail}`, `→ ${en(koma.amount + nominated.amount)}`],
    },
    {
      name: "施術売上 × 率 − 材料費",
      how: "材料（ジェル・グルー・エクステ・薬剤など）をどちらが持つかは契約で決める。差し引くなら、項目と計算の方法を明示して合意しておく",
      where: "ネイル・アイラッシュ・美容室など",
      example: [
        `例：${nail.detail}`,
        `材料費：${material.detail}（契約に書いてある差し引き）`,
        `→ ${en(nail.amount + material.amount)}`,
      ],
    },
    {
      name: "面貸し・シェアサロンの精算",
      how: "報酬の支払ではなく、サロンが預かった売上から場所代（売上 × 率、または定額の席料）・決済手数料などを引いて返す精算。本人が代金を直接受け取るなら、サロンは席料を受け取るだけ",
      where: "面貸し・シェアサロン",
      example: [
        `例（歩合で場所代）：${rental.detail}（決済手数料はカード払い ${en(CARD_SALES)} × ${bpText(CARD_FEE_BP)}）`,
        `例（定額の席料 ${en(SEAT_DAILY)} × ${SEAT_DAYS}日）：${seat.detail}`,
        "→ 報酬ではないので、消費税・源泉徴収の計算には入れず、別に計算します",
      ],
    },
  ];
}

const MODELS = buildModels();

export function BeautyPayModels() {
  return (
    <ul className="mt-2 grid gap-3 sm:grid-cols-2">
      {MODELS.map((m) => (
        <li key={m.name}>
          <Card className="h-full">
            <p className="font-bold">{m.name}</p>
            <p className="mt-1 text-sm">{m.how}</p>
            <p className="mt-1 text-xs text-muted-foreground">{m.where}</p>
            <div className="mt-2 space-y-1 rounded-lg bg-muted p-2 text-xs leading-relaxed [overflow-wrap:anywhere]">
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
