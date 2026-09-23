import { describe, expect, it } from "vitest";
import { calcModel } from "@/lib/engine/payModels";
import { PRESETS, getPreset, withServiceDate, type PresetSample } from "@/lib/engine/presets";
import { buildPayout, type PayoutLine } from "@/lib/engine/statement";

function sample(presetId: Parameters<typeof getPreset>[0], id: string): PresetSample {
  const s = getPreset(presetId).samples.find((x) => x.id === id);
  if (!s) throw new Error(`no sample ${id}`);
  return s;
}

function run(presetId: Parameters<typeof getPreset>[0], id: string) {
  return buildPayout(sample(presetId, id).input);
}

function billTotal(lines: PayoutLine[] | undefined): number {
  return (lines ?? []).reduce((a, l) => a + calcModel(l).amount, 0);
}

type Expect = { subtotal: number; tax: number; withholding: number; payout: number; invoiceBurden?: number };

function expectNumbers(presetId: Parameters<typeof getPreset>[0], id: string, e: Expect) {
  const r = run(presetId, id);
  expect({ subtotal: r.subtotal, tax: r.tax, withholding: r.withholding, payout: r.payout }).toEqual({
    subtotal: e.subtotal,
    tax: e.tax,
    withholding: e.withholding,
    payout: e.payout,
  });
  if (e.invoiceBurden !== undefined) expect(r.invoiceBurden).toBe(e.invoiceBurden);
  return r;
}

describe("どの見本も、わざと出している注意以外は出ない", () => {
  for (const preset of PRESETS) {
    for (const s of preset.samples) {
      it(`${preset.id} / ${s.id}`, () => {
        const r = buildPayout(s.input);
        expect(r.warnings.map((w) => w.code).sort()).toEqual([...s.expectedWarnings].sort());
        expect(Number.isInteger(r.payout)).toBe(true);
        expect(r.payout).toBeGreaterThan(0);
        expect(r.explanation.length).toBeGreaterThan(3);
      });
    }
  }
});

describe("見本は架空と明記している", () => {
  it("会社名と支払先の名前に「架空」が入っている", () => {
    for (const preset of PRESETS) {
      expect(preset.sampleCompany).toContain("架空");
      for (const s of preset.samples) {
        expect(s.title).toContain("架空");
        expect(s.input.payee.name).toContain("架空");
      }
    }
  });

  it("5業種がそろい、見本の id は重ならない", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["trucking", "publishing", "it", "beauty", "school"]);
    const ids = PRESETS.flatMap((p) => p.samples.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("「全業種に対応」とは書かない", () => {
    const text = JSON.stringify(PRESETS);
    expect(text).not.toContain("全業種");
    expect(text).not.toContain("四捨五入");
  });
});

describe("軽貨物（基準）", () => {
  it("ドライバーA：360,000 − ロイヤリティ 36,000 − 管理費 5,000 = 319,000、消費税 31,900、振込 350,900", () => {
    expectNumbers("trucking", "trucking-a", { subtotal: 319_000, tax: 31_900, withholding: 0, payout: 350_900 });
    const s = sample("trucking", "trucking-a");
    expect(billTotal(s.billLines)).toBe(432_000);
    expect(billTotal(s.billLines) - 360_000).toBe(72_000);
  });

  it("ドライバーB（免税）：347,000。控除できない負担は10月 9,463・9月 6,309", () => {
    const s = sample("trucking", "trucking-b");
    expectNumbers("trucking", "trucking-b", { subtotal: 347_000, tax: 0, withholding: 0, payout: 347_000, invoiceBurden: 9_463 });
    expect(buildPayout(withServiceDate(s.input, "2026-09-30")).invoiceBurden).toBe(6_309);
  });
});

describe("出版・編集", () => {
  it("ライターA：84,000 → 源泉 8,576 → 振込 83,824", () => {
    expectNumbers("publishing", "publishing-a", { subtotal: 84_000, tax: 8_400, withholding: 8_576, payout: 83_824 });
  });

  it("ライターB（免税・消費税相当額を区分）：源泉 9,189、負担 2,700（9月は 1,800）", () => {
    const r = expectNumbers("publishing", "publishing-b", { subtotal: 90_000, tax: 9_000, withholding: 9_189, payout: 89_811, invoiceBurden: 2_700 });
    expect(r.taxLabel).toBe("消費税相当額");
    expect(r.withholdingBase).toBe(90_000);
    expect(buildPayout(withServiceDate(sample("publishing", "publishing-b").input, "2026-09-30")).invoiceBurden).toBe(1_800);
  });

  it("カメラマンC：日当 100,000 ＋ 一緒に払う交通費 4,800 = 源泉の元 104,800 → 10,700", () => {
    const r = expectNumbers("publishing", "publishing-c", { subtotal: 100_000, tax: 10_000, withholding: 10_700, payout: 104_100 });
    expect(r.withholdingBase).toBe(104_800);
  });

  it("イラストD：96,000 → 9,801。納品から61日目の支払は60日超え", () => {
    const r = expectNumbers("publishing", "publishing-d", { subtotal: 96_000, tax: 9_600, withholding: 9_801, payout: 95_799 });
    expect(r.warnings.map((w) => w.code)).toEqual(["over_60_days"]);
  });

  it("著者E：印税 900,000 → 91,890", () => {
    expectNumbers("publishing", "publishing-e", { subtotal: 900_000, tax: 90_000, withholding: 91_890, payout: 898_110 });
  });

  it("著者F：印税 1,500,000 → 204,200（20.42%の段階）", () => {
    const r = expectNumbers("publishing", "publishing-f", { subtotal: 1_500_000, tax: 150_000, withholding: 204_200, payout: 1_445_800 });
    expect(r.withholdingGroups[0].steps).toHaveLength(2);
  });
});

describe("IT・SES", () => {
  it("田中：上下割 186.5h → 725,220、消費税 72,522。請求側 880,680", () => {
    expectNumbers("it", "it-tanaka", { subtotal: 725_220, tax: 72_522, withholding: 0, payout: 797_742 });
    expect(billTotal(sample("it", "it-tanaka").billLines)).toBe(880_680);
  });

  it("佐藤（免税）：132h → 565,760、消費税相当 56,576。負担は10月 16,972・9月 11,315", () => {
    expectNumbers("it", "it-sato", { subtotal: 565_760, tax: 56_576, withholding: 0, payout: 622_336, invoiceBurden: 16_972 });
    expect(buildPayout(withServiceDate(sample("it", "it-sato").input, "2026-09-30")).invoiceBurden).toBe(11_315);
  });

  it("鈴木：月額固定 900,000", () => {
    expectNumbers("it", "it-suzuki", { subtotal: 900_000, tax: 90_000, withholding: 0, payout: 990_000 });
  });

  it("渡辺：650,000 × 12/21営業日 = 371,428（精算幅も80〜102.86hに縮めて、96hは精算なし）", () => {
    expectNumbers("it", "it-watanabe", { subtotal: 371_428, tax: 37_142, withholding: 0, payout: 408_570 });
  });

  it("高橋：デザイン 430,000 → 源泉 43,903 → 振込 429,097", () => {
    expectNumbers("it", "it-takahashi", { subtotal: 430_000, tax: 43_000, withholding: 43_903, payout: 429_097 });
  });

  it("山本：1,500,000 → 源泉 204,200", () => {
    expectNumbers("it", "it-yamamoto", { subtotal: 1_500_000, tax: 150_000, withholding: 204_200, payout: 1_445_800 });
  });

  it("中村：請求 140〜200h・支払 140〜180h で 195h → 支払だけ 58,200 増え、粗利は 91,800 に縮む", () => {
    const s = sample("it", "it-nakamura");
    const r = expectNumbers("it", "it-nakamura", { subtotal: 758_200, tax: 75_820, withholding: 0, payout: 834_020 });
    expect(billTotal(s.billLines)).toBe(850_000);
    expect(billTotal(s.billLines) - r.subtotal).toBe(91_800);
  });
});

describe("美容・サロン", () => {
  it("佐藤（免税）：606,000 − 材料費 88,000 = 518,000。負担は9月 9,418・10月 14,127", () => {
    expectNumbers("beauty", "beauty-sato", { subtotal: 518_000, tax: 0, withholding: 0, payout: 518_000, invoiceBurden: 14_127 });
    expect(buildPayout(withServiceDate(sample("beauty", "beauty-sato").input, "2026-09-30")).invoiceBurden).toBe(9_418);
  });

  it("田中：超過累進 950,000 → 440,000 ＋ 消費税 44,000 = 484,000", () => {
    expectNumbers("beauty", "beauty-tanaka", { subtotal: 440_000, tax: 44_000, withholding: 0, payout: 484_000 });
  });

  it("鈴木（面貸し）：精算 437,040。報酬ではないので消費税・源泉・負担は0", () => {
    const r = expectNumbers("beauty", "beauty-suzuki", { subtotal: 0, tax: 0, withholding: 0, payout: 437_040, invoiceBurden: 0 });
    expect(r.settlementsTotal).toBe(437_040);
    expect(r.notes.join("")).toContain("精算");
  });

  it("高橋（最低保証）：190,000 ＋ 消費税 19,000", () => {
    expectNumbers("beauty", "beauty-takahashi", { subtotal: 190_000, tax: 19_000, withholding: 0, payout: 209_000 });
  });

  it("伊藤：264,500 ＋ 26,450 − 合意の無い差し引き 4,000 = 286,950", () => {
    expectNumbers("beauty", "beauty-ito", { subtotal: 264_500, tax: 26_450, withholding: 0, payout: 286_950 });
  });
});

describe("スクール・講師", () => {
  it("講師A（免税）：80,000 → 源泉 8,168 → 振込 71,832。負担は10月 2,181・9月 1,454", () => {
    expectNumbers("school", "school-a", { subtotal: 80_000, tax: 0, withholding: 8_168, payout: 71_832, invoiceBurden: 2_181 });
    expect(buildPayout(withServiceDate(sample("school", "school-a").input, "2026-09-30")).invoiceBurden).toBe(1_454);
  });

  it("講師B：82,000 ＋ 8,200 − 源泉 8,372 = 81,828", () => {
    expectNumbers("school", "school-b", { subtotal: 82_000, tax: 8_200, withholding: 8_372, payout: 81_828 });
  });

  it("ピアノ講師C：59,400 → 源泉 6,064（相殺の前）→ 使用料 5,000 を相殺 → 48,336", () => {
    const r = expectNumbers("school", "school-c", { subtotal: 59_400, tax: 0, withholding: 6_064, payout: 48_336 });
    expect(r.withholdingBase).toBe(59_400);
    expect(r.deductionsTotal).toBe(5_000);
  });

  it("ヨガ講師D：48,000 ＋ 20人分 × 300 = 54,000 → 源泉 5,513 → 48,487", () => {
    expectNumbers("school", "school-d", { subtotal: 54_000, tax: 0, withholding: 5_513, payout: 48_487 });
  });

  it("教室長E：源泉は「なし・要確認」、労働者性と期日の注意", () => {
    const r = expectNumbers("school", "school-e", { subtotal: 150_000, tax: 15_000, withholding: 0, payout: 165_000 });
    expect(r.lines[0].withholdingNeedsReview).toBe(true);
  });
});

describe("見本の数字の形（レビューで足した）", () => {
  it("どの見本も金額はすべて整数の円。説明に「四捨五入」「全業種」は出ない", () => {
    for (const preset of PRESETS) {
      for (const s of preset.samples) {
        for (const date of [s.input.serviceDate, ...preset.compareServiceDates]) {
          const r = buildPayout(withServiceDate(s.input, date));
          for (const v of [r.subtotal, r.tax, r.withholdingBase, r.withholding, r.deductionsTotal, r.payout, r.invoiceBurden, r.settlementsTotal]) {
            expect(Number.isInteger(v)).toBe(true);
          }
          for (const g of r.withholdingGroups) expect(g.tax).toBe(g.tax | 0);
          const text = [...r.explanation, ...r.warnings.map((w) => w.message), ...r.notes].join("");
          expect(text).not.toContain("四捨五入");
          expect(text).not.toContain("全業種");
        }
      }
    }
  });

  it("注意の文は労働者性を判定しない・免税の方への支払を下げるよう勧めない", () => {
    for (const preset of PRESETS) {
      for (const s of preset.samples) {
        const r = buildPayout(s.input);
        for (const w of r.warnings) {
          expect(w.message).not.toMatch(/適法です|違法です|労働者にあたります|偽装請負です/);
          if (w.code === "exempt_no_tax_equivalent") expect(w.message).toContain("問題になりえます");
          if (w.code.startsWith("labor_risk")) expect(w.message).toContain("判断は専門家へ");
        }
      }
    }
  });

  it("源泉の元の決め方：上乗せの無い見本は「支払う報酬の額」、分けて書いた見本は税抜", () => {
    expect(run("school", "school-a").withholdingRule).toBe("no_tax_added");
    expect(run("school", "school-b").withholdingRule).toBe("excl_tax_separated");
    expect(run("publishing", "publishing-b").withholdingRule).toBe("excl_tax_separated");
  });
});
