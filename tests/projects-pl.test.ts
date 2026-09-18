import { describe, expect, it } from "vitest";
import {
  TARGET_JUDGEMENT_CSV_LABELS,
  TARGET_JUDGEMENT_LABELS,
  belowTargetCount,
  judgeTarget,
  sortByMargin,
  sumProjectRows,
  toProjectRow,
  toTrend,
  trendMonths,
  type ProjectPlRow,
} from "@/components/projects/helpers";
import { PROJECTS_CSV_HEADERS, projectToCsvRow, toProjectsCsv } from "@/lib/exports/projects-csv";
import { CSV_BOM } from "@/lib/exports/csv";
import { projectInputSchema, type ProjectFormInput } from "@/lib/schemas/projects";
import type { ProjectPl } from "@/lib/db/types";

const COMPANY = "00000000-0000-4000-8000-000000000000";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

/** v_project_pl の 1 行（DB からの生の値を想定） */
function viewRow(over: Partial<ProjectPl> = {}): ProjectPl {
  const bill = Number(over.bill ?? 1_000_000);
  const entryProfit = Number(over.entry_profit ?? 200_000);
  const expenseDirect = Number(over.expense_direct ?? 0);
  const projectProfit = over.project_profit != null ? Number(over.project_profit) : entryProfit - expenseDirect;
  return {
    company_id: COMPANY,
    month: "2026-09-01",
    project_id: P1,
    project_name: "三郷Amazon",
    client_id: null,
    client_name: "アマゾンジャパン",
    project_is_active: true,
    project_sort_order: 1,
    target_margin: null,
    entry_count: 3,
    driver_count: 2,
    qty_total: 42,
    bill,
    pay: 800_000,
    margin: 180_000,
    royalty: 20_000,
    entry_profit: entryProfit,
    expense_direct: expenseDirect,
    expense_count: expenseDirect === 0 ? 0 : 1,
    project_profit: projectProfit,
    project_margin: bill !== 0 ? Math.round((projectProfit / bill) * 1_000_000) / 1_000_000 : 0,
    below_target: over.target_margin == null || bill === 0 ? false : projectProfit / bill < Number(over.target_margin),
    is_closed: false,
    ...over,
  } as ProjectPl;
}

/** 画面用の行（省略した列は viewRow の既定値） */
function row(over: Partial<ProjectPl> = {}): ProjectPlRow {
  return toProjectRow(viewRow(over));
}

describe("toProjectRow", () => {
  it("ビューの列をそのまま画面用の形にする（月は YYYY-MM）", () => {
    const r = toProjectRow(viewRow({ target_margin: 0.2, expense_direct: 50_000 }));
    expect(r.month).toBe("2026-09");
    expect(r.projectId).toBe(P1);
    expect(r.projectName).toBe("三郷Amazon");
    expect(r.clientName).toBe("アマゾンジャパン");
    expect(r.bill).toBe(1_000_000);
    expect(r.entryProfit).toBe(200_000);
    expect(r.expenseDirect).toBe(50_000);
    // 案件利益 ＝ 稼働の利益 − 直課経費（ビューの値をそのまま使う）
    expect(r.projectProfit).toBe(150_000);
    expect(r.projectMargin).toBeCloseTo(0.15, 6);
    expect(r.targetMargin).toBe(0.2);
    expect(r.belowTarget).toBe(true);
  });

  it("null は 0 / 空文字 / null に正規化する", () => {
    const r = toProjectRow({
      company_id: null,
      month: null,
      project_id: null,
      project_name: null,
      client_id: null,
      client_name: null,
      project_is_active: null,
      project_sort_order: null,
      target_margin: null,
      entry_count: null,
      driver_count: null,
      qty_total: null,
      bill: null,
      pay: null,
      margin: null,
      royalty: null,
      entry_profit: null,
      expense_direct: null,
      expense_count: null,
      project_profit: null,
      project_margin: null,
      below_target: null,
      is_closed: null,
    });
    expect(r.month).toBe("");
    expect(r.projectName).toBe("");
    expect(r.clientName).toBe("");
    expect(r.bill).toBe(0);
    expect(r.projectProfit).toBe(0);
    expect(r.targetMargin).toBeNull();
    expect(r.belowTarget).toBe(false);
    expect(r.closed).toBe(false);
  });
});

describe("sortByMargin", () => {
  const a = row({ project_id: P1, project_name: "A", bill: 1_000_000, entry_profit: 100_000 }); // 10%
  const b = row({ project_id: P2, project_name: "B", bill: 500_000, entry_profit: 150_000 }); // 30%
  const c = row({ project_id: P3, project_name: "C", bill: 2_000_000, entry_profit: 400_000 }); // 20%

  it("利益率の高い順に並べる", () => {
    expect(sortByMargin([a, b, c]).map((r) => r.projectName)).toEqual(["B", "C", "A"]);
  });

  it("同率は売上の多い順、元の配列は変更しない", () => {
    const small = row({ project_id: P2, project_name: "小", bill: 100_000, entry_profit: 20_000 }); // 20%
    const input = [small, c];
    expect(sortByMargin(input).map((r) => r.projectName)).toEqual(["C", "小"]);
    expect(input.map((r) => r.projectName)).toEqual(["小", "C"]);
  });
});

describe("sumProjectRows", () => {
  it("金額を誤差なく合計し、利益率は合計どうしで求める", () => {
    const rows = [
      row({ project_id: P1, bill: 1_000_000.1, entry_profit: 200_000.2, expense_direct: 0.1 }),
      row({ project_id: P2, bill: 500_000.2, entry_profit: 100_000.1, expense_direct: 0.2 }),
    ];
    const t = sumProjectRows(rows);
    expect(t.projectCount).toBe(2);
    expect(t.bill).toBe(1_500_000.3);
    expect(t.expenseDirect).toBe(0.3);
    expect(t.entryProfit).toBe(300_000.3);
    expect(t.projectProfit).toBe(300_000);
    expect(t.projectMargin).toBeCloseTo(300_000 / 1_500_000.3, 9);
    expect(t.entryCount).toBe(6);
  });

  it("売上 0・空配列でも利益率は 0", () => {
    expect(sumProjectRows([]).projectMargin).toBe(0);
    expect(sumProjectRows([]).bill).toBe(0);
    const onlyExpense = row({ bill: 0, entry_profit: 0, expense_direct: 30_000 });
    const t = sumProjectRows([onlyExpense]);
    expect(t.projectProfit).toBe(-30_000);
    expect(t.projectMargin).toBe(0);
  });
});

describe("目標利益率の判定", () => {
  it("目標なしは判定しない", () => {
    const r = row({ target_margin: null, bill: 1_000_000, entry_profit: 10 });
    expect(judgeTarget(r)).toBe("none");
    expect(TARGET_JUDGEMENT_LABELS[judgeTarget(r)]).toBe("—");
  });

  it("目標とちょうど同じ利益率は達成", () => {
    const r = row({ target_margin: 0.2, bill: 1_000_000, entry_profit: 200_000 });
    expect(r.projectMargin).toBe(0.2);
    expect(r.belowTarget).toBe(false);
    expect(judgeTarget(r)).toBe("ok");
  });

  it("目標を下回ると目標未達", () => {
    const r = row({ target_margin: 0.2, bill: 1_000_000, entry_profit: 200_000, expense_direct: 1 });
    expect(r.belowTarget).toBe(true);
    expect(judgeTarget(r)).toBe("below");
    expect(TARGET_JUDGEMENT_LABELS.below).toBe("目標未達");
  });

  it("売上 0（経費だけ）の案件は判定しない", () => {
    const r = row({ target_margin: 0.2, bill: 0, entry_profit: 0, expense_direct: 10_000 });
    expect(judgeTarget(r)).toBe("none");
  });

  it("belowTargetCount は目標未達の件数を数える", () => {
    const rows = [
      row({ project_id: P1, target_margin: 0.2, bill: 1_000_000, entry_profit: 100_000 }), // 10% → 未達
      row({ project_id: P2, target_margin: 0.2, bill: 1_000_000, entry_profit: 300_000 }), // 30% → 達成
      row({ project_id: P3, target_margin: null, bill: 1_000_000, entry_profit: 0 }), // 目標なし
    ];
    expect(belowTargetCount(rows)).toBe(1);
    expect(sumProjectRows(rows).belowTargetCount).toBe(1);
  });
});

describe("toTrend", () => {
  const rows = [
    row({ project_id: P1, month: "2026-08-01", bill: 900_000, entry_profit: 90_000 }),
    row({ project_id: P1, month: "2026-09-01", bill: 1_000_000, entry_profit: 200_000, expense_direct: 50_000 }),
    row({ project_id: P2, month: "2026-09-01", bill: 400_000, entry_profit: 40_000 }),
  ];

  it("指定した 12 か月に並べ、行の無い月は 0 埋めする", () => {
    const months = trendMonths("2026-09");
    const points = toTrend(rows, P1, months);
    expect(points).toHaveLength(12);
    expect(points[0].month).toBe("2025-10");
    expect(points[0].hasData).toBe(false);
    expect(points[0].bill).toBe(0);
    expect(points[0].projectProfit).toBe(0);
    expect(points[0].projectMargin).toBe(0);
    expect(points[10]).toMatchObject({ month: "2026-08", bill: 900_000, projectProfit: 90_000, hasData: true });
    expect(points[11]).toMatchObject({ month: "2026-09", bill: 1_000_000, projectProfit: 150_000, hasData: true });
  });

  it("月を省略すると行のある最新の月で終わる 12 か月になる", () => {
    const points = toTrend(rows, P1);
    expect(points).toHaveLength(12);
    expect(points[11].month).toBe("2026-09");
    expect(points[0].month).toBe("2025-10");
  });

  it("他の案件の行は含めず、行が無ければ空", () => {
    const points = toTrend(rows, P2, trendMonths("2026-09"));
    expect(points.filter((p) => p.hasData).map((p) => p.month)).toEqual(["2026-09"]);
    expect(points[11].bill).toBe(400_000);
    expect(toTrend(rows, P3)).toEqual([]);
  });

  it("trendMonths は古い順の 12 か月", () => {
    const months = trendMonths("2026-01");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-02");
    expect(months[11]).toBe("2026-01");
  });
});

describe("案件別採算 CSV", () => {
  it("ヘッダーと 1 行（目標ありの未達）", () => {
    const r = row({ target_margin: 0.2, bill: 1_000_000, entry_profit: 200_000, expense_direct: 50_000 });
    expect(projectToCsvRow(r)).toEqual([
      "2026-09",
      "三郷Amazon",
      "アマゾンジャパン",
      3,
      2,
      "42",
      "1000000",
      "800000",
      "180000",
      "20000",
      "200000",
      "50000",
      "150000",
      "0.15",
      "0.2",
      "目標未達",
    ]);
    expect(PROJECTS_CSV_HEADERS).toHaveLength(16);
    expect(PROJECTS_CSV_HEADERS[0]).toBe("稼動月");
    expect(PROJECTS_CSV_HEADERS[15]).toBe("判定");
  });

  it("目標が未設定なら空欄・判定は「目標なし」", () => {
    const cells = projectToCsvRow(row({ target_margin: null }));
    expect(cells[14]).toBe("");
    expect(cells[15]).toBe(TARGET_JUDGEMENT_CSV_LABELS.none);
    expect(projectToCsvRow(row({ target_margin: 0.1, bill: 1_000_000, entry_profit: 200_000 }))[15]).toBe("達成");
  });

  it("BOM・CRLF・カンマを含む案件名のエスケープ", () => {
    const csv = toProjectsCsv([row({ project_name: "三郷,Amazon", target_margin: null })]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(CSV_BOM + PROJECTS_CSV_HEADERS.join(","));
    expect(lines[1]).toContain('"三郷,Amazon"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(toProjectsCsv([]).split("\r\n")).toHaveLength(2);
  });
});

describe("projectInputSchema の目標利益率", () => {
  const base: ProjectFormInput = {
    id: null,
    name: "和光ヤマト",
    client_id: null,
    is_active: true,
    memo: "",
    items: [{ id: null, name: "宅急便", unit: "piece", bill_rate: "180", pay_rate: "162", is_active: true }],
  };

  it("空欄・未指定・null は null（判定しない）", () => {
    expect(projectInputSchema.parse({ ...base, target_margin: "" }).target_margin).toBeNull();
    expect(projectInputSchema.parse({ ...base, target_margin: "  " }).target_margin).toBeNull();
    expect(projectInputSchema.parse({ ...base, target_margin: null }).target_margin).toBeNull();
    expect(projectInputSchema.parse(base).target_margin).toBeNull();
  });

  it("パーセント入力を率にする（全角・％付きも可）", () => {
    expect(projectInputSchema.parse({ ...base, target_margin: "20" }).target_margin).toBe(0.2);
    expect(projectInputSchema.parse({ ...base, target_margin: "12.5%" }).target_margin).toBe(0.125);
    expect(projectInputSchema.parse({ ...base, target_margin: "１０％" }).target_margin).toBe(0.1);
    expect(projectInputSchema.parse({ ...base, target_margin: "0" }).target_margin).toBe(0);
  });

  it("0〜100% の範囲外は拒否する", () => {
    expect(projectInputSchema.safeParse({ ...base, target_margin: "150" }).success).toBe(false);
    expect(projectInputSchema.safeParse({ ...base, target_margin: "-5" }).success).toBe(false);
    expect(projectInputSchema.safeParse({ ...base, target_margin: "100" }).success).toBe(true);
  });
});
