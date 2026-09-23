import iconv from "iconv-lite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { StatementDraft } from "~/server/calc/statement";
import {
  GENERIC_HEADER,
  MF_HEADER,
  PAYMENT_HEADER,
  SOFTWARE,
  SOFTWARE_KEYS,
  buildAccountingFile,
  buildSlips,
  loadAccountingView,
  resolveMapping,
  saveAccountingSettings,
  slipRows,
  memoNames,
  MEMO_NAMES_MAX,
  yayoiFlag,
  type Slip,
} from "~/server/features/accounting";
import { loadMonthDrafts } from "~/server/features/profit";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

let db: Db;
let client: PGlite;
let tenantId: string;
let otherId: string;

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  ({ tenantId } = await seedDemo(db));
  ({ tenantId: otherId } = await seedDemo(db));
});
afterAll(async () => client.close());

/** CSV を読む（" で囲んだ値・"" の中の " に対応） */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.replace(/^﻿/, "").split("\r\n")) {
    if (line === "") continue;
    const cells: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

async function demoSlips(software: keyof typeof SOFTWARE, month = DEMO_MONTH): Promise<{ slips: Slip[]; drafts: StatementDraft[] }> {
  const md = await loadMonthDrafts(db, tenantId, month);
  const info = SOFTWARE[software];
  return { slips: buildSlips(md.drafts, resolveMapping({}, info.format), info.taxMode), drafts: md.drafts };
}

describe("仕訳の組み立て", () => {
  it("どのソフトでも、伝票ごとに借方＝貸方、未払金の残り＝明細の振込額", async () => {
    for (const soft of SOFTWARE_KEYS) {
      const { slips, drafts } = await demoSlips(soft);
      expect(slips).toHaveLength(8);
      for (const slip of slips) {
        const debit = slip.rows.reduce((a, r) => a + r.amount, 0);
        expect(slip.debitTotal).toBe(debit);
        expect(slip.creditTotal).toBe(debit);
        const d = drafts.find((x) => x.driverId === slip.driverId)!;
        expect(slip.payableNet).toBe(d.total);
        let net = 0;
        for (const r of slip.rows) {
          if (r.credit.account === "未払金") net += r.amount;
          if (r.debit.account === "未払金") net -= r.amount;
          expect(r.amount).toBeGreaterThan(0);
        }
        expect(net).toBe(d.total);
      }
    }
  });

  it("青木さん（弥生）：委託料は税込で税金額つき、控除は売上高、立替の精算は立替金。未払金の残りは 357,555 円", async () => {
    const { slips } = await demoSlips("yayoi");
    const aoki = slips.find((x) => x.driverName === "青木 翔太")!;
    expect(aoki.rows.map((r) => [r.debit.account, r.credit.account, r.amount, r.debit.tax, r.credit.tax])).toEqual([
      ["外注費", "未払金", 411_950, 37_450, null],
      ["未払金", "売上高", 57_695, null, 5_245],
      ["立替金", "未払金", 3_300, null, null],
    ]);
    expect(aoki.rows[0].debit.taxLabel).toBe("課対仕入込10%");
    expect(aoki.rows[0].memo).toBe("青木 翔太 2026年10月分 委託料");
    expect(aoki.rows[1].memo).toBe("青木 翔太 2026年10月分 控除（ロイヤリティ・管理費）");
    expect(aoki.payableNet).toBe(357_555);
    // 登録の無い上田さんは経過措置 70% の税区分、修理代の負担分は 雑収入
    const ueda = slips.find((x) => x.driverName === "上田 健")!;
    expect(ueda.rows[0].debit.taxLabel).toBe("課対仕入込10%区分70%");
    // 登録の無い方：委託料 276,000 ＋ 消費税相当額 27,600 を税込の 1 行。税金額は空ける（経過措置の割合がかかるため）
    expect(ueda.rows[0]).toMatchObject({ amount: 303_600, debit: { account: "外注費", tax: null } });
    expect(ueda.rows[1]).toMatchObject({ amount: 42_600 + 4_260, credit: { account: "売上高", tax: 4_260 } });
    expect(ueda.rows.at(-1)).toMatchObject({ amount: 11_000, debit: { account: "未払金" }, credit: { account: "雑収入", taxLabel: "対象外" } });
    expect(ueda.payableNet).toBe(303_600 - 46_860 - 11_000);
  });

  it("汎用 CSV でも、登録の無い方の委託料は税込の 1 行（仮払消費税等の行を作らない）", async () => {
    const { slips } = await demoSlips("generic");
    const ueda = slips.find((x) => x.driverName === "上田 健")!;
    expect(ueda.rows.map((r) => [r.debit.account, r.credit.account, r.amount])).toEqual([
      ["外注費", "未払金", 303_600],
      ["未払金", "売上高", 42_600],
      ["未払金", "仮受消費税等", 4_260],
      ["未払金", "雑収入", 11_000],
    ]);
    expect(ueda.rows[0].debit.taxLabel).toBe("課税仕入10%（経過措置70%・税込）");
    expect(ueda.payableNet).toBe(245_740);
    // 税込の形の画面では、税額を空ける人を知らせる
    const view = await loadAccountingView(db, tenantId, DEMO_MONTH, "yayoi");
    expect(view.blankTaxDrivers).toEqual(["上田 健", "遠藤 大輔", "木村 誠"]);
    expect((await loadAccountingView(db, tenantId, DEMO_MONTH, "generic")).blankTaxDrivers).toEqual([]);
  });

  it("摘要の名前は長くなりすぎないようにまとめる", () => {
    expect(memoNames([{ name: "ロイヤリティ" }, { name: "管理費" }, { name: "車両リース" }])).toBe("ロイヤリティ・管理費・車両リース");
    const many = [{ name: "ロイヤリティ" }, { name: "管理費" }, { name: "車両リース" }, { name: "保険料" }, { name: "制服代" }];
    const short = memoNames(many);
    expect(short).toBe("ロイヤリティ・管理費ほか3件");
    expect(short.length).toBeLessThanOrEqual(MEMO_NAMES_MAX);
    expect(memoNames([{ label: "とても長い名前の控除の項目その一" }, { label: "とても長い名前の控除の項目その二" }])).toBe("とても長い名前の控除の項目その一ほか1件");
  });

  it("汎用 CSV は税抜で、消費税を別の行（仮払消費税等・仮受消費税等）にする", async () => {
    const { slips } = await demoSlips("generic");
    const aoki = slips.find((x) => x.driverName === "青木 翔太")!;
    expect(aoki.rows.map((r) => [r.debit.account, r.credit.account, r.amount])).toEqual([
      ["外注費", "未払金", 374_500],
      ["仮払消費税等", "未払金", 37_450],
      ["未払金", "売上高", 52_450],
      ["未払金", "仮受消費税等", 5_245],
      ["立替金", "未払金", 3_300],
    ]);
    expect(aoki.payableNet).toBe(357_555);
  });

  it("源泉徴収・消費税のかからない控除・消費税のかかる調整・マイナスの控除も、借方＝貸方と未払金＝振込額を保つ", () => {
    const base = {
      driverId: "x",
      month: "2026-10-01",
      period: { from: "2026-10-01", to: "2026-10-31" },
      payDate: "2026-11-25",
      company: { name: "c", registrationNo: null },
      driver: { name: "テスト 太郎", code: null, registrationNo: null, invoiceRegistered: false },
      lines: [],
      subtotal: 100_000,
      tax: 10_000,
      taxLabel: "消費税相当額",
      deductions: [
        { ruleId: "a", name: "管理費", amount: 5_000, taxable: true, agreedInWriting: true, how: "" },
        { ruleId: "c", name: "保険の返金", amount: -3_000, taxable: false, agreedInWriting: true, how: "" },
      ],
      deductionTotal: 2_000,
      deductionTax: 500,
      adjustments: [
        { label: "追加の作業", amount: 2_000, taxable: true, agreedInWriting: true },
        { label: "事故の負担", amount: -4_000, taxable: false, agreedInWriting: true },
      ],
      adjustmentTotal: -2_000,
      adjustmentTax: 200,
      withholding: { category: "x", amount: 10_210, formula: "" },
      total: 0,
      sales: 0,
      invoiceBurden: 0,
      deductibleRate: 0.7,
      hasWork: true,
      isPurchaseStatement: false,
      note: "",
    } satisfies StatementDraft;
    const draft: StatementDraft = { ...base, total: 100_000 + 10_000 - (2_000 + 500) - 2_000 + 200 - 10_210 };
    for (const soft of SOFTWARE_KEYS) {
      const info = SOFTWARE[soft];
      const [slip] = buildSlips([draft], resolveMapping({}, info.format), info.taxMode);
      expect(slip.payableNet).toBe(draft.total);
      expect(slip.debitTotal).toBe(slip.creditTotal);
      expect(slip.rows.some((r) => r.credit.account === "預り金" && r.amount === 10_210)).toBe(true);
    }
    // マイナスの控除（返金）は借方と貸方を入れ替えて、プラスの額で書く
    const rows = slipRows(draft, resolveMapping({}, "generic"), "separate");
    expect(rows.find((r) => r.memo.includes("保険の返金"))).toMatchObject({ amount: 3_000, debit: { account: "立替金" }, credit: { account: "未払金" } });
    // 登録の無い方への上乗せ（消費税の対象の調整）は、委託料と同じく税込の 1 行
    expect(rows.filter((r) => r.memo.includes("追加の作業"))).toMatchObject([{ amount: 2_200, debit: { account: "外注費" }, credit: { account: "未払金" } }]);
    expect(rows.find((r) => r.memo.includes("事故の負担"))).toMatchObject({ amount: 4_000, debit: { account: "未払金" }, credit: { account: "雑収入" } });
    expect(rows.every((r) => r.amount > 0)).toBe(true);
    // 登録の無い方への委託料は、この月の経過措置（70%）の税区分で、税込の 1 行
    expect(rows[0]).toMatchObject({ amount: 110_000, debit: { account: "外注費", taxLabel: "課税仕入10%（経過措置70%・税込）" } });
    expect(rows.some((r) => r.debit.account === "仮払消費税等")).toBe(false);

    // 登録のある方なら、消費税は別の行（仮払消費税等）
    const registered: StatementDraft = { ...draft, driver: { ...draft.driver, invoiceRegistered: true, registrationNo: "T1111111111111" }, taxLabel: "消費税" };
    const regRows = slipRows(registered, resolveMapping({}, "generic"), "separate");
    expect(regRows.slice(0, 2).map((r) => [r.debit.account, r.amount])).toEqual([["外注費", 100_000], ["仮払消費税等", 10_000]]);
    expect(regRows.filter((r) => r.memo.includes("追加の作業")).map((r) => [r.debit.account, r.amount])).toEqual([["外注費", 2_000], ["仮払消費税等", 200]]);
    const [regSlip] = buildSlips([registered], resolveMapping({}, "generic"), "separate");
    expect(regSlip.payableNet).toBe(registered.total);
    // 弥生（税込）：登録のある方は税金額つき、登録の無い方は空ける
    const yRows = slipRows(registered, resolveMapping({}, "yayoi"), "inclusive");
    expect(yRows[0]).toMatchObject({ amount: 110_000, debit: { tax: 10_000 } });
    expect(yRows.find((r) => r.memo.includes("追加の作業"))).toMatchObject({ amount: 2_200, debit: { tax: 200 } });
    const yExempt = slipRows(draft, resolveMapping({}, "yayoi"), "inclusive");
    expect(yExempt[0]).toMatchObject({ amount: 110_000, debit: { tax: null, taxLabel: "課対仕入込10%区分70%" } });
    expect(yExempt.find((r) => r.memo.includes("追加の作業"))).toMatchObject({ amount: 2_200, debit: { tax: null } });
  });

  it("明細と合わない数字なら作らない", () => {
    const bad = { driverId: "x", month: "2026-10-01", period: { from: "2026-10-01", to: "2026-10-31" }, driver: { name: "合わない 人", code: null, registrationNo: null, invoiceRegistered: true }, subtotal: 1000, tax: 100, taxLabel: "消費税", deductions: [], deductionTotal: 0, deductionTax: 0, adjustments: [], adjustmentTotal: 0, adjustmentTax: 0, withholding: null, total: 999, deductibleRate: 0.7 } as unknown as StatementDraft;
    expect(() => buildSlips([bad], resolveMapping({}, "yayoi"), "inclusive")).toThrow("合いません");
  });
});

describe("弥生会計のインポート形式", () => {
  it("見出しなし・1 行 25 項目・複数行の伝票は 2110 → 2100 → 2101、1 行なら 2000", async () => {
    const file = await buildAccountingFile(db, tenantId, DEMO_MONTH, "yayoi");
    expect(file.contentType).toContain("Shift_JIS");
    expect(file.fileName).toBe("仕訳_弥生会計_2026年10月.csv");
    const text = iconv.decode(Buffer.from(file.bytes), "cp932");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.includes("\n") && !/[^\r]\n/.test(text)).toBe(true);
    const rows = parseCsv(text);
    expect(rows.every((r) => r.length === 25)).toBe(true);
    expect(rows[0][0]).toBe("2110");
    // 伝票ごとに、最初 2110・途中 2100・最後 2101
    const bySlip = new Map<string, string[][]>();
    for (const r of rows) bySlip.set(r[1], [...(bySlip.get(r[1]) ?? []), r]);
    expect(bySlip.size).toBe(8);
    for (const slipRows of bySlip.values()) {
      const flags = slipRows.map((r) => r[0]);
      expect(flags[0]).toBe("2110");
      expect(flags.at(-1)).toBe("2101");
      expect(flags.slice(1, -1).every((f) => f === "2100")).toBe(true);
      // 伝票の中で借方と貸方の合計が同じ
      const debit = slipRows.reduce((a, r) => a + Number(r[8]), 0);
      const credit = slipRows.reduce((a, r) => a + Number(r[14]), 0);
      expect(debit).toBe(credit);
      for (const r of slipRows) {
        expect(r[3]).toBe("2026/10/31");
        expect(r.slice(19)).toEqual(["0", "", "", "0", "0", "no"]);
        expect(r[2]).toBe("");
      }
    }
    const aoki = rows.filter((r) => r[16].startsWith("青木 翔太"));
    expect(aoki.map((r) => r[0])).toEqual(["2110", "2100", "2101"]);
    expect(aoki[0].slice(4, 17)).toEqual(["外注費", "", "", "課対仕入込10%", "411950", "37450", "未払金", "", "", "対象外", "411950", "", "青木 翔太 2026年10月分 委託料"]);
    expect(yayoiFlag(0, 1)).toBe("2000");
    expect(yayoiFlag(1, 3)).toBe("2100");
    expect(file.unmappable).toEqual([]);
  });

  it("Shift_JIS にできない文字は ? になり、その文字を知らせる", async () => {
    const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D02")));
    await db.update(s.drivers).set({ name: "𠮷田 美咲" }).where(and(eq(s.drivers.id, d.id), eq(s.drivers.tenantId, tenantId)));
    try {
      const view = await loadAccountingView(db, tenantId, DEMO_MONTH, "yayoi");
      expect(view.unmappable).toEqual(["𠮷"]);
      const file = await buildAccountingFile(db, tenantId, DEMO_MONTH, "freee");
      expect(file.unmappable).toEqual(["𠮷"]);
      expect(iconv.decode(Buffer.from(file.bytes), "cp932")).toContain("?田 美咲");
      // UTF-8 の形では、そのまま出る
      const mf = await buildAccountingFile(db, tenantId, DEMO_MONTH, "mf");
      expect(utf8(mf.bytes)).toContain("𠮷田 美咲");
    } finally {
      await db.update(s.drivers).set({ name: "井上 美咲" }).where(and(eq(s.drivers.id, d.id), eq(s.drivers.tenantId, tenantId)));
    }
  });

  it("日本語の中身は Shift_JIS で行き来しても同じ", async () => {
    const file = await buildAccountingFile(db, tenantId, DEMO_MONTH, "yayoi");
    const text = iconv.decode(Buffer.from(file.bytes), "cp932");
    expect(new Uint8Array(iconv.encode(text, "cp932"))).toEqual(file.bytes);
    expect(text).toContain("課対仕入込10%区分70%");
  });
});

describe("マネーフォワードと汎用 CSV", () => {
  it("マネーフォワードの見出しは決めた並びのまま（UTF-8・BOM 付き）", async () => {
    const file = await buildAccountingFile(db, tenantId, DEMO_MONTH, "mf");
    expect(file.bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    const rows = parseCsv(utf8(file.bytes));
    expect(rows[0]).toEqual(MF_HEADER);
    expect(rows[0].join(",")).toBe(
      "取引No,取引日,借方勘定科目,借方補助科目,借方部門,借方取引先,借方税区分,借方インボイス,借方金額(円),借方税額,貸方勘定科目,貸方補助科目,貸方部門,貸方取引先,貸方税区分,貸方インボイス,貸方金額(円),貸方税額,摘要,仕訳メモ,タグ,MF仕訳タイプ,決算整理仕訳",
    );
    expect(rows.slice(1).every((r) => r.length === MF_HEADER.length)).toBe(true);
    const aoki = rows.filter((r) => r[18].startsWith("青木 翔太"));
    expect(aoki[0].slice(0, 10)).toEqual(["1", "2026/10/31", "外注費", "", "", "青木 翔太", "課税仕入 10%", "適格", "411950", "37450"]);
    const ueda = rows.find((r) => r[18] === "上田 健 2026年10月分 委託料")!;
    expect(ueda[7]).toBe("70%控除");
    // 登録の無い方の税額の列は空ける
    expect([ueda[8], ueda[9]]).toEqual(["303600", ""]);
  });

  it("汎用 CSV の見出しと、支払一覧", async () => {
    const generic = parseCsv(utf8((await buildAccountingFile(db, tenantId, DEMO_MONTH, "generic")).bytes));
    expect(generic[0]).toEqual(GENERIC_HEADER);
    expect(generic.slice(1).every((r) => r.length === 12)).toBe(true);
    const payments = await buildAccountingFile(db, tenantId, DEMO_MONTH, "payments");
    expect(payments.fileName).toBe("支払一覧_2026年10月.csv");
    const rows = parseCsv(utf8(payments.bytes));
    expect(rows[0]).toEqual(PAYMENT_HEADER);
    expect(rows).toHaveLength(9);
    const aoki = rows.find((r) => r[1] === "青木 翔太")!;
    expect(aoki).toEqual(["D01", "青木 翔太", "あり", "374500", "37450", "57695", "3300", "0", "357555", "2026/11/25"]);
    const endo = rows.find((r) => r[0] === "D04")!;
    // 遠藤さん：委託料 350,000 ＋ 35,000 − 控除（ロイヤリティ 35,000・管理費 15,000・リース 32,000 と消費税 8,200）
    expect(endo.slice(3, 9)).toEqual(["350000", "35000", String(82_000 + 8_200), "0", "0", String(350_000 + 35_000 - 90_200)]);
  });

  it("明細が無い月は作らない", async () => {
    await expect(buildAccountingFile(db, tenantId, "2026-05-01", "yayoi")).rejects.toThrow("明細がまだありません");
  });
});

describe("勘定科目・税区分の対応の保存", () => {
  it("accounting だけを書き換え、ほかの設定（振込依頼人）は残す。保存した科目で出す", async () => {
    const before = (await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId)))[0];
    await saveAccountingSettings(db, tenantId, {
      software: "mf",
      accounts: { outsourcing: "支払手数料", payable: "", deductionTaxable: "雑収入", bogus: "x" },
      taxLabels: { purchase: "課税仕入 10%", exempt70: "課税仕入 10%（経過）", invoiceExempt70: "", nope: "x" },
      payableSubByDriver: true,
    });
    const after = (await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId)))[0];
    expect(after.settings.requester).toEqual(before.settings.requester);
    expect(after.settings.accounting?.software).toBe("mf");
    expect(after.settings.accounting?.accounts).toMatchObject({ outsourcing: "支払手数料", payable: "未払金", deductionTaxable: "雑収入", payableSub: "driver" });
    expect(after.settings.accounting?.accounts).not.toHaveProperty("bogus");
    expect(after.settings.accounting?.taxLabels).toEqual({ "mf.purchase": "課税仕入 10%", "mf.exempt70": "課税仕入 10%（経過）", "mf.invoiceExempt70": "" });

    const view = await loadAccountingView(db, tenantId, DEMO_MONTH);
    expect(view.software).toBe("mf");
    expect(view.neverSaved).toBe(false);
    expect(view.accountFields.find((f) => f.key === "outsourcing")).toMatchObject({ value: "支払手数料", saved: true });
    expect(view.accountFields.find((f) => f.key === "withholding")).toMatchObject({ value: "預り金", saved: false });
    expect(view.check.ok).toBe(true);
    const rows = parseCsv(utf8((await buildAccountingFile(db, tenantId, DEMO_MONTH, "mf")).bytes));
    const ueda = rows.find((r) => r[18] === "上田 健 2026年10月分 委託料")!;
    expect(ueda.slice(2, 8)).toEqual(["支払手数料", "", "", "上田 健", "課税仕入 10%（経過）", ""]);
    // 未払金の補助科目にドライバーの名前
    expect(ueda[11]).toBe("上田 健");

    // 弥生の税区分は別に覚えているので、既定のまま
    const yayoi = await loadAccountingView(db, tenantId, DEMO_MONTH, "yayoi");
    expect(yayoi.taxFields.find((f) => f.key === "exempt70")).toMatchObject({ value: "課対仕入込10%区分70%", saved: false });

    // 長すぎる名前は保存しない
    await expect(
      saveAccountingSettings(db, tenantId, { software: "yayoi", accounts: { outsourcing: "あ".repeat(41) }, taxLabels: {}, payableSubByDriver: false }),
    ).rejects.toThrow("40 文字まで");
  });

  it("ほかの会社の対応は変わらず、ほかの会社の明細も出ない", async () => {
    const other = (await db.select().from(s.tenants).where(eq(s.tenants.id, otherId)))[0];
    expect(other.settings.accounting).toBeUndefined();
    const view = await loadAccountingView(db, otherId, DEMO_MONTH);
    expect(view.software).toBe("yayoi");
    expect(view.neverSaved).toBe(true);
    expect(view.accountFields.find((f) => f.key === "outsourcing")!.value).toBe("外注費");
    // ほかの会社の稼働を変えても、この会社のファイルは変わらない
    const mine = await buildAccountingFile(db, tenantId, DEMO_MONTH, "payments");
    await db.delete(s.adjustments).where(eq(s.adjustments.tenantId, otherId));
    const mineAgain = await buildAccountingFile(db, tenantId, DEMO_MONTH, "payments");
    expect(utf8(mineAgain.bytes)).toBe(utf8(mine.bytes));
    const theirs = parseCsv(utf8((await buildAccountingFile(db, otherId, DEMO_MONTH, "payments")).bytes));
    expect(theirs.find((r) => r[0] === "D01")![8]).toBe(String(357_555 - 3_300));
  });
});

describe("締めた月", () => {
  it("締めた月は明細の写しから出し、未払金の残りは保存した振込額と同じ", async () => {
    const { db: db2, client: c2 } = await createTestDb();
    const { tenantId: t } = await seedDemo(db2);
    await generateStatements(db2, t, DEMO_MONTH);
    await db2.insert(s.monthCloses).values({ tenantId: t, month: DEMO_MONTH, status: "closed", closedAt: new Date() });
    // 締めたあとで管理費を上げても、仕訳は変わらない
    await db2.update(s.deductionRules).set({ amount: 99_999 }).where(and(eq(s.deductionRules.tenantId, t), eq(s.deductionRules.name, "管理費")));
    const view = await loadAccountingView(db2, t, DEMO_MONTH, "yayoi");
    expect(view.source).toBe("snapshot");
    const saved = await db2.select().from(s.statements).where(and(eq(s.statements.tenantId, t), eq(s.statements.month, DEMO_MONTH)));
    for (const slip of view.slips) expect(slip.payableNet).toBe(saved.find((x) => x.driverId === slip.driverId)!.total);
    expect(view.check).toMatchObject({ ok: true, slips: 8 });
    expect(view.check.payableNet).toBe(saved.reduce((a, x) => a + x.total, 0));
    await c2.close();
  });

  it("締める前の月で、送った明細と今の計算が違う人を知らせる", async () => {
    const { db: db2, client: c2 } = await createTestDb();
    const { tenantId: t } = await seedDemo(db2);
    // 明細を作る前は知らせない（まだ送っていない）
    expect((await loadAccountingView(db2, t, DEMO_MONTH, "yayoi")).statementGap).toEqual([]);
    await generateStatements(db2, t, DEMO_MONTH);
    expect((await loadAccountingView(db2, t, DEMO_MONTH, "yayoi")).statementGap).toEqual([]);
    // 明細を作ったあとで、青木さんの立替を 3,300 → 5,500 円に直す
    await db2.update(s.adjustments).set({ amount: 5_500 }).where(and(eq(s.adjustments.tenantId, t), eq(s.adjustments.label, "駐車場代の立替")));
    const view = await loadAccountingView(db2, t, DEMO_MONTH, "yayoi");
    expect(view.statementGap).toEqual(["青木 翔太"]);
    // 仕訳は今の計算から（振込額 357,555 → 359,755）
    expect(view.slips.find((x) => x.driverName === "青木 翔太")!.payableNet).toBe(359_755);
    expect(view.check.ok).toBe(true);
    // ほかの会社には出ない
    const { tenantId: other } = await seedDemo(db2);
    expect((await loadAccountingView(db2, other, DEMO_MONTH, "yayoi")).statementGap).toEqual([]);
    await c2.close();
  });

  it("9 月（控除 80% の月）は経過措置 80% の税区分", async () => {
    const view = await loadAccountingView(db, otherId, DEMO_PREV_MONTH, "yayoi");
    expect(view.deductibleRate).toBe(0.8);
    expect(view.taxFields.map((f) => f.key)).toContain("exempt80");
    const ueda = view.slips.find((x) => x.driverName === "上田 健")!;
    expect(ueda.rows[0].debit.taxLabel).toBe("課対仕入込10%区分80%");
  });
});
