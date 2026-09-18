import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPreview, convertPrototype, detectFormat, deterministicId, normalizeBackup, previewBackup } from "@/lib/migrate";

const COMPANY = "00000000-0000-0000-0000-000000000001";
const sample = JSON.parse(readFileSync(path.join(__dirname, "fixtures/prototype-sample.json"), "utf8"));

describe("試作アプリ JSON の移行（§8.5）", () => {
  it("形式判定", () => {
    expect(detectFormat(sample)).toBe("prototype");
    expect(detectFormat({ app: "rootive-profit", drivers: [], work_entries: [] })).toBe("backup");
    expect(detectFormat({ foo: 1 })).toBe("unknown");
    expect(detectFormat(null)).toBe("unknown");
  });

  it("変換結果の件数と ID の決定性", () => {
    const a = convertPrototype(sample, COMPANY);
    const b = convertPrototype(sample, COMPANY);
    expect(a.backup.drivers).toHaveLength(10);
    expect(a.backup.projects).toHaveLength(7);
    expect(a.backup.project_items).toHaveLength(8);
    expect(a.backup.driver_pay_overrides).toHaveLength(2);
    expect(a.backup.work_entries).toHaveLength(10);
    expect(a.backup.driver_months).toHaveLength(8);
    expect(a.backup.month_closings).toHaveLength(1);
    expect(a.warnings).toEqual([]);
    expect(JSON.parse(JSON.stringify({ ...a.backup, exported_at: "" }))).toEqual(JSON.parse(JSON.stringify({ ...b.backup, exported_at: "" })));
    expect(a.backup.drivers[0].id).toBe(deterministicId("driver", "d1"));
    expect(a.backup.work_entries[0].month).toBe("2026-09-01");
    expect(a.backup.work_entries[0].rounding_mode).toBe("none");
    const yoshida = a.backup.drivers.find((d) => d.name === "吉田雅一")!;
    const misato = a.backup.project_items.find((i) => i.name === "標準" && a.backup.projects.find((p) => p.id === i.project_id)?.name === "三郷Amazon")!;
    expect(a.backup.driver_pay_overrides.find((o) => o.driver_id === yoshida.id)?.project_item_id).toBe(misato.id);
    expect(a.backup.company).toMatchObject({ name: "株式会社ROOTIVE", rounding_mode: "none", default_royalty_rate: 0.1, default_mgmt_fee: 15000 });
  });

  it("プレビューの月別集計が §2.6 の合計と一致する", () => {
    const { preview } = buildPreview(sample, COMPANY);
    expect(preview.format).toBe("prototype");
    expect(preview.counts.work_entries).toBe(10);
    expect(preview.months).toHaveLength(1);
    const m = preview.months[0];
    expect(m.month).toBe("2026-09");
    expect(m.entryCount).toBe(10);
    expect(m.driverCount).toBe(8);
    expect(m.bill).toBeCloseTo(2559573, 2);
    expect(m.profit).toBeCloseTo(652490.3, 2);
    expect(m.payout).toBeCloseTo(1907082.7, 2);
    expect(m.status).toBe("open");
    expect(preview.totals.bill).toBeCloseTo(2559573, 2);
    expect(preview.companyName).toBe("株式会社ROOTIVE");
  });

  it("変換済みバックアップを再プレビューしても同じ集計になる（バックアップ形式の取り込み）", () => {
    const { backup } = convertPrototype(sample, COMPANY);
    const json = JSON.parse(JSON.stringify(backup));
    expect(detectFormat(json)).toBe("backup");
    const { preview } = buildPreview(json, COMPANY);
    expect(preview.format).toBe("backup");
    expect(preview.totals.profit).toBeCloseTo(652490.3, 2);
    expect(normalizeBackup(json).work_entries).toHaveLength(10);
  });

  it("参照切れ・重複名・不正な月は警告して補完／スキップする", () => {
    const broken = JSON.parse(JSON.stringify(sample));
    broken.data.entries.e99 = { id: "e99", month: "2026-10", driverId: "dX", driverName: "不明太郎", projectId: "pX", projectName: "謎案件", itemId: "pXi1", itemName: "標準", unit: "day", qty: 2, billRate: 10000, payRate: 9000, royaltyRate: 0.1, memo: "" };
    broken.data.entries.e98 = { id: "e98", month: "2026-13", driverId: "d1", projectId: "p1", itemId: "p1i1", qty: 1, billRate: 1, payRate: 1, royaltyRate: 0.1 };
    broken.data.drivers.d11 = { id: "d11", name: "相曽慧", active: true, royaltyRate: 0.1, mgmtFee: 0, rateOverrides: { "p9|zzz": 100 }, order: 11 };
    const { backup, warnings } = convertPrototype(broken, COMPANY);
    expect(warnings.some((w) => w.includes("不明太郎"))).toBe(true);
    expect(warnings.some((w) => w.includes("謎案件"))).toBe(true);
    expect(warnings.some((w) => w.includes("2026-13"))).toBe(true);
    expect(warnings.some((w) => w.includes("相曽慧（2）"))).toBe(true);
    expect(warnings.some((w) => w.includes("個別単価の参照先"))).toBe(true);
    expect(backup.drivers.find((d) => d.name === "不明太郎")?.is_active).toBe(false);
    expect(backup.work_entries).toHaveLength(11);
    // 稼働行だけの月にはドライバー標準の管理費で driver_months が作られる
    const preview = previewBackup(backup, "prototype", warnings);
    expect(preview.months.map((m) => m.month)).toEqual(["2026-09", "2026-10"]);
    expect(preview.months[1].bill).toBe(20000);
  });

  it("バックアップ v2（経費・取引先・請求書・月次目標）を落とさずに引き継ぐ", () => {
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const backup = normalizeBackup({
      app: "rootive-profit",
      version: 2,
      drivers: [],
      work_entries: [],
      clients: [{ id: id(1), company_id: COMPANY, name: "株式会社テスト", payment_month_offset: 1, payment_day: 0 }],
      expense_categories: [{ id: id(2), company_id: COMPANY, name: "燃料費", kind: "variable" }],
      recurring_expenses: [{ id: id(3), company_id: COMPANY, category_id: id(2), label: "リース", amount: 1000 }],
      expenses: [{ id: id(4), company_id: COMPANY, month: "2026-12-01", category_id: id(2), label: "ガソリン", amount: 5000 }],
      invoices: [{ id: id(5), company_id: COMPANY, client_id: id(1), month: "2026-12-01", invoice_no: "202612-01" }],
      invoice_items: [{ id: id(6), company_id: COMPANY, invoice_id: id(5), name: "配送", qty: 1, unit_price: 100 }],
      month_targets: [{ company_id: COMPANY, month: "2026-12-01", bill_target: 100, profit_target: 10 }],
    });
    expect(backup.version).toBe(2);
    expect(backup.clients).toHaveLength(1);
    expect(backup.expenses?.[0].label).toBe("ガソリン");
    expect(backup.invoice_items).toHaveLength(1);
    expect(backup.month_targets).toHaveLength(1);
    const preview = previewBackup(backup, "backup");
    expect(preview.counts.expenses).toBe(1);
    expect(preview.counts.invoices).toBe(1);
    expect(preview.counts.clients).toBe(1);
    expect(preview.counts.month_targets).toBe(1);
  });

  it("古いバックアップ（v1）は 0009 のテーブルが空でも読める", () => {
    const backup = normalizeBackup({ app: "rootive-profit", version: 1, drivers: [], work_entries: [] });
    expect(backup.version).toBe(1);
    expect(backup.clients).toEqual([]);
    expect(backup.expenses).toEqual([]);
    expect(previewBackup(backup, "backup").counts.expenses).toBe(0);
  });

  it("不正な JSON は日本語エラー", () => {
    expect(() => buildPreview({ hello: 1 }, COMPANY)).toThrow(/形式を判定できません/);
    expect(() => convertPrototype({ data: { drivers: { a: { name: 1 } } } }, COMPANY)).not.toThrow(); // 名前は文字列化される
    expect(() => normalizeBackup({ app: "rootive-profit", drivers: [{ id: "bad" }], work_entries: [] })).toThrow(/不正な ID/);
  });
});
