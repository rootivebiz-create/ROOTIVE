import { describe, expect, it } from "vitest";
import {
  blankLine,
  burdenRows,
  formForPreset,
  formFromSample,
  methodText,
  nextMonth,
  parsePresetParam,
  presetFromSearch,
  readNumber,
  readPercent,
  summaryTaxRows,
  toPayoutInput,
  toText,
  withServiceMonth,
  type PayoutForm,
} from "@/components/tools/payout/state";
import { PRESETS, getPreset } from "@/lib/engine/presets";
import { buildPayout, type PayoutResult } from "@/lib/engine/statement";
import { WITHHOLDING_RATES, withholdingRateFor } from "@/lib/engine/withholding";
import { bpText } from "@/lib/engine/types";

function run(form: PayoutForm) {
  const { input, errors } = toPayoutInput(form);
  return { input, errors, result: buildPayout(input) };
}

function numbers(r: PayoutResult) {
  return {
    subtotal: r.subtotal,
    settlementsTotal: r.settlementsTotal,
    tax: r.tax,
    withholdingBase: r.withholdingBase,
    withholding: r.withholding,
    reimbursementsPaid: r.reimbursementsPaid,
    reimbursementsDirect: r.reimbursementsDirect,
    deductionsTotal: r.deductionsTotal,
    payout: r.payout,
    invoiceBurden: r.invoiceBurden,
    deductibleRate: r.deductibleRate,
    lines: r.lines.map((l) => l.amount),
    warnings: r.warnings.map((w) => w.code).sort(),
  };
}

function patchLine(form: PayoutForm, index: number, patch: Partial<PayoutForm["lines"][number]>): PayoutForm {
  return { ...form, lines: form.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) };
}

describe("見本 → 入力欄 → 計算", () => {
  for (const preset of PRESETS) {
    for (const sample of preset.samples) {
      it(`${preset.id} / ${sample.id}：入力欄を通しても、見本そのままと同じ結果になる`, () => {
        const { errors, result } = run(formFromSample(preset, sample));
        expect(errors).toEqual([]);
        expect(numbers(result)).toEqual(numbers(buildPayout(sample.input)));
      });
    }
  }

  it("見本の数字（手で確かめた値）：軽貨物のドライバーAは振込 350,900円", () => {
    const { result } = run(formForPreset("trucking", "trucking-a"));
    expect(result.subtotal).toBe(319_000);
    expect(result.tax).toBe(31_900);
    expect(result.withholding).toBe(0);
    expect(result.payout).toBe(350_900);
  });

  it("免税のドライバーBの負担は、10月分 9,463円・9月分 6,309円（役務の提供を受けた月で決まる）", () => {
    const oct = run(formForPreset("trucking", "trucking-b"));
    expect(oct.result.invoiceBurden).toBe(9_463);
    const sep = run(withServiceMonth(formForPreset("trucking", "trucking-b"), "2026-09"));
    expect(sep.result.invoiceBurden).toBe(6_309);
    expect(sep.result.deductibleRate).toBe(0.8);
  });

  it("出版の印税 150万円は、100万円を超える部分だけ 20.42%（204,200円）", () => {
    const { result } = run(formForPreset("publishing", "publishing-f"));
    expect(result.withholding).toBe(204_200);
    const steps = result.withholdingGroups[0].steps;
    expect(steps.map((s) => [s.amount, s.bp, s.tax])).toEqual([
      [1_000_000, 1021, 102_100],
      [500_000, 2042, 102_100],
    ]);
  });

  it("URL の preset を読む（知らない値・配列・無しは軽貨物）", () => {
    expect(parsePresetParam("publishing")).toBe("publishing");
    expect(parsePresetParam(["school", "it"])).toBe("school");
    expect(parsePresetParam("construction")).toBe("trucking");
    expect(parsePresetParam(undefined)).toBe("trucking");
  });

  it("見本の id が無ければ、その業種の最初の見本", () => {
    expect(formForPreset("it", "nope").sampleId).toBe(getPreset("it").samples[0].id);
  });

  it("行・立替・控除の id は重ならず、nextId はどれよりも大きい", () => {
    for (const preset of PRESETS) {
      for (const sample of preset.samples) {
        const f = formFromSample(preset, sample);
        const ids = [
          ...f.lines.flatMap((l) => [l.id, ...l.categories.map((c) => c.id), ...l.tiers.map((t) => t.id)]),
          ...f.reimbursements.map((r) => r.id),
          ...f.deductions.map((d) => d.id),
        ];
        expect(new Set(ids).size).toBe(ids.length);
        expect(Math.max(...ids)).toBeLessThan(f.nextId);
      }
    }
  });
});

describe("入力の読み方", () => {
  it("全角・カンマ・円・万を読む。空は null、読めなければ NaN", () => {
    expect(readNumber("１２，０００")).toBe(12_000);
    expect(readNumber("110万")).toBe(1_100_000);
    expect(readNumber("1.5万円")).toBe(15_000);
    expect(readNumber("¥3,880")).toBe(3_880);
    expect(readNumber("186.5")).toBe(186.5);
    expect(readNumber("  ")).toBeNull();
    expect(readNumber("abc")).toBeNaN();
  });

  it("率は % を付けても付けなくてもよい", () => {
    expect(readPercent("45")).toBe(0.45);
    expect(readPercent("45%")).toBe(0.45);
    expect(readPercent("１０％")).toBe(0.1);
    expect(readPercent("1.728")).toBe(0.01728);
    expect(readPercent("")).toBeNull();
  });

  it("数から入力欄の文字へ（カンマつき・小数はそのまま）", () => {
    expect(toText(42_000)).toBe("42,000");
    expect(toText(186.5)).toBe("186.5");
    expect(toText(undefined)).toBe("");
  });

  it("読めない数字は 0 として計算し、どの欄かを知らせる", () => {
    const form = patchLine(formForPreset("trucking", "trucking-a"), 0, { qty: "たくさん" });
    const { errors, result } = run(form);
    expect(errors).toEqual(["「宅配」の数量を数字で入れてください"]);
    expect(result.lines[0].amount).toBe(0);
  });

  it("空の欄はエラーにせず 0（まだ入れていない）", () => {
    const form = patchLine(formForPreset("trucking", "trucking-a"), 0, { qty: "" });
    expect(run(form).errors).toEqual([]);
  });

  it("月は「12月の次は翌年1月」", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(nextMonth("2026-09")).toBe("2026-10");
  });
});

describe("入力欄の動き", () => {
  it("ロイヤリティの元の額は、上の行の報酬の合計に自動でついてくる", () => {
    const form = formForPreset("trucking", "trucking-a");
    expect(form.lines[1].feeBaseAuto).toBe(true);
    const { result } = run(patchLine(form, 0, { qty: "2,000" }));
    // 2,000個 × 150円 = 300,000、ロイヤリティ 10% = 30,000、管理費 5,000
    expect(result.lines.map((l) => l.amount)).toEqual([300_000, -30_000, -5_000]);
    expect(result.subtotal).toBe(265_000);
  });

  it("元の額が上の行の合計と違う見本（技術売上 × 8%）は手入力のまま", () => {
    const form = formForPreset("beauty", "beauty-sato");
    expect(form.lines[1].feeBaseAuto).toBe(false);
    expect(form.lines[1].feeBase).toBe("1,100,000");
  });

  it("月を変えると、既定のままの受け取った日・支払日もいっしょに動く", () => {
    const form = formForPreset("publishing", "publishing-a");
    expect(form.terms.enabled).toBe(false);
    const moved = withServiceMonth(form, "2026-12");
    expect(moved.terms.receivedOn).toBe("2026-12-31");
    expect(moved.terms.payOn).toBe("2027-01-31");
  });

  it("受け取った日を自分で入れていたら、月を変えても日付はどちらも動かさない", () => {
    const form = formForPreset("publishing", "publishing-d");
    expect(form.terms.receivedOn).toBe("2026-10-01");
    const moved = withServiceMonth(form, "2026-11");
    expect(moved.serviceMonth).toBe("2026-11");
    expect(moved.terms.receivedOn).toBe("2026-10-01");
    expect(moved.terms.payOn).toBe("2026-11-30");
  });

  it("差し引きの行に源泉の区分を付けても、源泉の元は減らない", () => {
    let form = formForPreset("publishing", "publishing-a");
    const fee = { ...blankLine(getPreset("publishing"), () => 900), label: "資料代", model: "contractFee" as const };
    form = { ...form, lines: [...form.lines, { ...fee, feeMode: "fixed" as const, feeAmount: "10,000", feeAgreed: true, withholding: "ko1" as const }] };
    const { result } = run(form);
    expect(result.subtotal).toBe(74_000);
    expect(result.withholdingBase).toBe(84_000);
    expect(result.withholding).toBe(8_576);
  });

  it("請求書で消費税を分けて書かないと、源泉の元は税込になる", () => {
    const form = formForPreset("publishing", "publishing-a");
    const separated = run(form).result;
    const notSeparated = run({ ...form, payee: { ...form.payee, taxShownSeparately: false } }).result;
    expect(separated.withholdingBase).toBe(84_000);
    expect(separated.withholding).toBe(8_576);
    expect(notSeparated.withholdingBase).toBe(92_400);
    expect(notSeparated.withholding).toBe(9_434);
    expect(notSeparated.withholdingRule).toBe("incl_tax");
  });

  it("支払先を法人にすると、区分があっても源泉は 0", () => {
    const form = formForPreset("publishing", "publishing-a");
    const { result } = run({ ...form, payee: { ...form.payee, isCorporation: true } });
    expect(result.withholding).toBe(0);
    expect(result.payout).toBe(84_000 + 8_400);
  });

  it("日付の欄が空のまま支払日の確認をオンにすると、知らせて期日の確認はしない", () => {
    const form = formForPreset("school", "school-a");
    const { input, errors } = toPayoutInput({ ...form, terms: { ...form.terms, enabled: true, payOn: "" } });
    expect(errors).toEqual(["給付を受け取った日と支払日を、日付で入れてください"]);
    expect(input.paymentTerms).toBeUndefined();
  });

  it("人数の加算は、読点・カンマ・空白で区切った回ごとの人数を読む", () => {
    const form = formForPreset("school", "school-d");
    expect(form.lines[1].counts).toBe("12、12、11、10、13、12、11、12、14、10、12、11");
    const { result } = run(patchLine(form, 1, { counts: "12, 15 11" }));
    // 超えた人数 2 + 5 + 1 = 8人 × 300円
    expect(result.lines[1].amount).toBe(2_400);
  });
});

describe("算定方法の文", () => {
  it("率は表から引き、1円未満は切り捨てと書く（四捨五入と書かない）", () => {
    const { input, result } = run(formForPreset("publishing", "publishing-a"));
    const text = methodText(input, result);
    const rate = withholdingRateFor(input.serviceDate);
    expect(text).toContain(`× ${bpText(rate.basicBp)}`);
    expect(text).toContain(bpText(rate.upperBp));
    expect(text).toContain("1回の支払ごと");
    expect(text).toContain("1円未満切り捨て");
    expect(text).toContain("税抜の報酬の額にかける");
    expect(text).not.toContain("四捨五入");
    expect(text).not.toMatch(/年(の|間の)?合計/);
  });

  it("表の率を変えると文も変わる（率を直書きしていない）", () => {
    const row = WITHHOLDING_RATES[0];
    const saved = row.basicBp;
    try {
      row.basicBp = 1111;
      const { input, result } = run(formForPreset("school", "school-b"));
      expect(methodText(input, result)).toContain("× 11.11%");
    } finally {
      row.basicBp = saved;
    }
  });

  it("源泉なしの業種では源泉の段を出さない。差し引きは根拠つきで書く", () => {
    const { input, result } = run(formForPreset("trucking", "trucking-a"));
    const text = methodText(input, result);
    expect(text).not.toContain("源泉徴収税額");
    expect(text).toContain("・宅配：1個あたり 150円 × 個数");
    expect(text).toContain("根拠：業務委託契約");
    expect(text).toContain("消費税（10%。1円未満切り捨て）を加えて支払う");
  });

  it("罰金・振込手数料の差し引きは文に入れない", () => {
    const { input, result } = run(formForPreset("beauty", "beauty-ito"));
    const text = methodText(input, result);
    expect(text).toContain("ユニフォーム代 3,000円");
    expect(text).not.toContain("遅刻の罰金");
    expect(text).toContain("罰金・振込手数料の差し引きは、この文に入れていません");
  });

  it("消費税相当額を上乗せしない免税の方は「総額」と書き、源泉は支払う報酬の額にかける", () => {
    const { input, result } = run(formForPreset("school", "school-a"));
    const text = methodText(input, result);
    expect(text).toContain("含む総額とし、別に加えない");
    expect(text).toContain("支払う報酬の額にかける");
  });

  it("面貸しは報酬と分けて「精算」として書く", () => {
    const { input, result } = run(formForPreset("beauty", "beauty-suzuki"));
    const text = methodText(input, result);
    expect(text).toContain("■ 精算（報酬の支払ではない）");
    expect(text).not.toContain("■ 報酬の額");
  });
});

describe("経過措置の前後", () => {
  it("10月分：前の段階 80%・いま 70%・次の段階 50% を、表の割合で並べる", () => {
    const { input } = run(formForPreset("trucking", "trucking-b"));
    const rows = burdenRows(input);
    expect(rows.map((r) => [r.from, r.rate, r.burden, r.current])).toEqual([
      ["2023-10-01", 0.8, 6_309, false],
      ["2026-10-01", 0.7, 9_463, true],
      ["2028-10-01", 0.5, 15_772, false],
    ]);
  });

  it("発注する側が簡易課税でも、参考として原則課税の負担を出す", () => {
    const form = formForPreset("trucking", "trucking-b");
    const { input, result } = run({ ...form, orderSideTaxMethod: "simplified" });
    expect(result.invoiceBurden).toBe(0);
    expect(burdenRows(input).find((r) => r.current)?.burden).toBe(9_463);
  });
});

describe("URL の見本と、結果のまとめの見出し", () => {
  it("location.search から見本を読む（知らない値・無しは軽貨物）", () => {
    expect(presetFromSearch("?preset=beauty")).toBe("beauty");
    expect(presetFromSearch("?x=1&preset=school")).toBe("school");
    expect(presetFromSearch("?preset=unknown")).toBe("trucking");
    expect(presetFromSearch("")).toBe("trucking");
  });

  it("消費税を上乗せしないときは「報酬」（別に足さない総額）と書き、「税抜」と書かない", () => {
    const { input, result } = run(formForPreset("trucking", "trucking-b"));
    const rows = summaryTaxRows(input, result);
    expect(rows.feeLabel).toBe("報酬");
    expect(rows.feeNote).toBe("消費税（相当額）を別に足さない総額");
    expect(rows.taxNote).toBe("上乗せしない");
    expect(result.tax).toBe(0);
  });

  it("上乗せするときは「報酬（税抜）」と、報酬 × 率の注記", () => {
    const { input, result } = run(formForPreset("trucking", "trucking-a"));
    const rows = summaryTaxRows(input, result);
    expect(rows.feeLabel).toBe("報酬（税抜）");
    expect(rows.taxLabel).toBe("消費税");
    expect(rows.taxNote).toContain("1円未満切り捨て");
  });

  it("上乗せするが消費税をかける報酬が 0 円（面貸しだけ）なら、「上乗せしない」ではなく 0 円と書く", () => {
    const form = formForPreset("beauty", "beauty-suzuki");
    const { input, result } = run({ ...form, payee: { ...form.payee, paysTaxOnTop: true } });
    expect(result.subtotal).toBe(0);
    expect(result.tax).toBe(0);
    const rows = summaryTaxRows(input, result);
    expect(rows.taxNote).not.toBe("上乗せしない");
    expect(rows.taxNote).toContain("0円");
    expect(rows.taxLabel).toBe(form.payee.invoiceRegistered ? "消費税" : "消費税相当額");
  });
});
