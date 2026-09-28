import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { buildExportSheet, plainSheet, type ExportLayout } from "~/server/features/import/export-layout";
import { buildWorkExport, loadExportLayout } from "~/server/features/import/export";
import { applyBatch, createDraftFromFile, loadDraftView, readSampleFile } from "~/server/features/import/service";
import { readTable } from "~/server/tabular";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 「Excel に戻す」（SPEC P0-7.8）：月の稼働を、取り込んだときと同じ列の並び（読み方を逆にたどる）の xlsx にする。
 * 取り込みが無ければ、ふつうの形（日付・ドライバー・案件・数量・単位・備考）。書き出した表をそのまま取り込み直すと、同じ数量になる。
 */

const state: { db?: Db; user?: SessionUser } = {};
vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  class AuthError extends Error {}
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async () => {
      if (!state.user) throw new AuthError("ログインしてください");
      return state.user;
    },
    AuthError,
  };
});

const drivers = [
  { id: "a", name: "青木 翔太", code: "D01", kana: "アオキ ショウタ", aliases: [] },
  { id: "b", name: "井上 美咲", code: "D02", kana: "イノウエ ミサキ", aliases: [] },
];
const projects = [
  { id: "p1", name: "宅配（個建て）", aliases: ["宅配"], unit: "個" },
  { id: "p2", name: "企業配（日当）", aliases: ["企業配"], unit: "日" },
  { id: "p3", name: "スポット便", aliases: ["スポット"], unit: "件" },
];

describe("表の形を逆にたどる（純関数）", () => {
  it("取り込みが無ければ、ふつうの形（日付・ドライバー・案件・数量・単位・備考）。フリガナ順・日付順", () => {
    const sheet = plainSheet(
      [
        { driverId: "b", projectId: "p2", qty: 21, workDate: null, note: null },
        { driverId: "a", projectId: "p1", qty: 2310, workDate: "2026-10-05", note: "午前" },
      ],
      drivers,
      projects,
    );
    expect(sheet.header).toEqual([["日付", "ドライバー", "案件", "数量", "単位", "備考"]]);
    expect(sheet.rows).toEqual([
      ["2026/10/05", "青木 翔太", "宅配（個建て）", 2310, "個", "午前"],
      [null, "井上 美咲", "企業配（日当）", 21, "日", null],
    ]);
  });

  it("1 行 1 件の表：元の見出しの位置に入れ、No の列は通し番号、最後に合計の行", () => {
    const layout: ExportLayout = {
      source: "profile",
      fileName: "稼働_縦持ち_2026年10月.xlsx",
      labels: ["No", "日付", "ドライバー", "コース", "個数・日数", "備考"],
      roles: ["ignore", "date", "driver", "project", "qty", "note"],
      headerDepth: 1,
      fixedProjectId: null,
    };
    const sheet = buildExportSheet(
      layout,
      DEMO_MONTH,
      [
        { driverId: "a", projectId: "p1", qty: 2310, workDate: null, note: null },
        { driverId: "a", projectId: "p3", qty: 4, workDate: null, note: null },
        { driverId: "b", projectId: "p2", qty: 21, workDate: null, note: "応援" },
      ],
      drivers,
      projects,
    );
    expect(sheet.header).toEqual([["No", "日付", "ドライバー", "コース", "個数・日数", "備考"]]);
    expect(sheet.rows).toEqual([
      [1, null, "青木 翔太", "スポット便", 4, null],
      [2, null, "青木 翔太", "宅配（個建て）", 2310, null],
      [3, null, "井上 美咲", "企業配（日当）", 21, "応援"],
    ]);
    expect(sheet.total).toEqual([null, null, "合計", null, 2335, null]);
    expect(sheet.notes).toEqual([]);
  });

  it("人 × 案件の表：元の案件の見出しの列に数量、「計」の列に行の合計。元の表に無い案件は右に列を足す", () => {
    const layout: ExportLayout = {
      source: "profile",
      fileName: "稼働_横持ち_2026年10月.xlsx",
      labels: ["氏名", "宅配（個）", "企業配（日）", "計"],
      roles: ["driver", "value", "value", "ignore"],
      headerDepth: 1,
      fixedProjectId: null,
    };
    const sheet = buildExportSheet(
      layout,
      DEMO_MONTH,
      [
        { driverId: "a", projectId: "p1", qty: 2310, workDate: null, note: null },
        { driverId: "a", projectId: "p3", qty: 4, workDate: null, note: null },
        { driverId: "b", projectId: "p2", qty: 21, workDate: null, note: null },
      ],
      drivers,
      projects,
    );
    expect(sheet.header).toEqual([["氏名", "宅配（個）", "企業配（日）", "計", "スポット便"]]);
    expect(sheet.rows).toEqual([
      ["青木 翔太", 2310, 0, 2314, 4],
      ["井上 美咲", 0, 21, 21, 0],
    ]);
    expect(sheet.total).toEqual(["合計", 2310, 21, 2335, 4]);
    expect(sheet.notes).toEqual(["元の表に無い案件（スポット便）の列を右に足しました"]);
  });

  it("日付が横に並ぶ表（21 日〜20 日の 2 段の見出し）：書き出す月の締めの期間で日付の列を作り直し、日付の無い稼働は「日付なし」の列に", () => {
    const labels = ["氏名", "コース", ...Array.from({ length: 30 }, (_, i) => String(((i + 20) % 30) + 1)), "計"];
    const layout: ExportLayout = {
      source: "profile",
      fileName: "9月.xlsx",
      labels,
      roles: ["driver", "project", ...labels.slice(2, -1).map(() => "value" as const), "ignore"],
      headerDepth: 2,
      fixedProjectId: null,
    };
    const sheet = buildExportSheet(
      layout,
      DEMO_MONTH,
      [
        { driverId: "a", projectId: "p1", qty: 100, workDate: "2026-09-21", note: null },
        { driverId: "a", projectId: "p1", qty: 120, workDate: "2026-10-20", note: null },
        { driverId: "a", projectId: "p1", qty: 7, workDate: null, note: null },
      ],
      drivers,
      projects,
    );
    const [top, bottom] = sheet.header;
    // 9/21〜10/20 の 30 日（見出しは 21, 22, …, 30, 1, …, 20）
    expect(bottom.slice(2, 32)).toEqual([...Array.from({ length: 10 }, (_, i) => String(21 + i)), ...Array.from({ length: 20 }, (_, i) => String(i + 1))]);
    expect(top.slice(0, 3)).toEqual(["氏名", "コース", "10月"]);
    expect(top.at(-1)).toBe("日付なし");
    expect(sheet.rows).toHaveLength(1);
    const row = sheet.rows[0];
    expect(row[0]).toBe("青木 翔太");
    expect(row[1]).toBe("宅配（個建て）");
    expect(row[2]).toBe(100);
    expect(row[31]).toBe(120);
    expect(row[32]).toBe(227);
    expect(row.at(-1)).toBe(7);
  });
});

describe("Excel に戻す（DB・画面のボタン）", () => {
  let client: PGlite;
  let tenantId = "";
  let otherTenant = "";
  const userIds = new Map<string, string>();
  beforeAll(async () => {
    const t = await createTestDb();
    state.db = t.db;
    client = t.client;
    tenantId = (await seedDemo(t.db)).tenantId;
    otherTenant = (await seedDemo(t.db)).tenantId;
    for (const u of await t.db.select().from(s.users)) if (u.role === "staff") userIds.set(u.tenantId, u.id);
  });
  afterAll(async () => {
    await client.close();
  });

  async function get(m: string, role: SessionUser["role"] | null, tenant = tenantId) {
    state.user = role ? { id: userIds.get(tenant)!, tenantId: tenant, email: "x@example.com", name: "テスト", role } : undefined;
    const { GET } = await import("~/app/api/import/export/route");
    return GET(new Request(`http://localhost/api/import/export?m=${m}`));
  }

  it("取り込みが無い会社はふつうの形。10 月の手入力の 11 行がそのまま出る（閲覧の役割でも出せる・記録が残る）", async () => {
    expect((await loadExportLayout(state.db!, tenantId)).source).toBe("plain");
    const res = await get("2026-10", "viewer");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(decodeURIComponent(res.headers.get("Content-Disposition") ?? "")).toContain("稼働_2026年10月分.xlsx");
    const { sheets } = await readTable("x.xlsx", new Uint8Array(await res.arrayBuffer()));
    expect(sheets).toHaveLength(1);
    const rows = sheets[0].rows;
    expect(rows[0][0]).toBe("2026年10月分 稼働");
    expect(rows[1]).toEqual(["日付", "ドライバー", "案件", "数量", "単位", "備考"]);
    expect(rows.slice(2)).toHaveLength(11);
    expect(rows.slice(2).reduce((a, r) => a + Number(r[3]), 0)).toBe(5205);
    const [log] = await state
      .db!.select()
      .from(s.auditLog)
      .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "import.export")));
    expect(log.detail).toMatchObject({ layout: "plain", entries: 11 });
    // 稼働の無い月は、ファイルの代わりに理由
    expect((await get("2026-12", "viewer")).status).toBe(404);
    // ログインしていなければ出さない
    expect((await get("2026-10", null)).status).toBe(403);
  });

  it("取り込んだあとは、その Excel と同じ列の並び。書き出した表を取り込み直すと、覚えた読み方で読めて数量も同じ（別の会社の稼働は混ざらない）", async () => {
    const db = state.db!;
    const { fileName, bytes } = await readSampleFile("long");
    const d = await createDraftFromFile(db, tenantId, { id: null }, { fileName, bytes, pageMonth: DEMO_MONTH });
    await applyBatch(db, tenantId, { id: null }, d.id, { mode: "replaceAll", confirmDuplicates: false });
    const layout = await loadExportLayout(db, tenantId);
    expect(layout).toMatchObject({ source: "profile", fileName, labels: ["No", "日付", "ドライバー", "コース", "個数・日数", "備考"] });
    // 別の会社はまだふつうの形
    expect((await loadExportLayout(db, otherTenant)).source).toBe("plain");

    const file = await buildWorkExport(db, tenantId, DEMO_MONTH);
    expect(file).toMatchObject({ rows: 11, entries: 11, notes: [] });
    const { sheets } = await readTable(file.fileName, file.bytes);
    const rows = sheets[0].rows;
    expect(rows[1]).toEqual(["No", "日付", "ドライバー", "コース", "個数・日数", "備考"]);
    expect(rows[2]).toEqual(["1", "", "青木 翔太", "スポット便", "4", ""]);
    expect(rows.at(-1)).toEqual(["", "", "合計", "", "5205", ""]);

    // 取り込み直す：同じ形なので前回の読み方で読み、合計の行とも一致
    const again = await createDraftFromFile(db, tenantId, { id: null }, { fileName: file.fileName, bytes: file.bytes, pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(db, tenantId, again.id))!;
    expect(view.summary.mappingFrom).toBe("profile");
    expect(again.month).toBe(DEMO_MONTH);
    expect(view.computed.parse.checks[0]).toMatchObject({ expected: 5205, actual: 5205, ok: true });
    expect(view.stats).toMatchObject({ records: 11, totalQty: 5205, drivers: 8, projects: 5, unresolved: 0 });

    // 別の会社で出しても、この会社の取り込みは使わず、その会社の稼働だけ
    const other = await get("2026-10", "staff", otherTenant);
    const otherRows = (await readTable("o.xlsx", new Uint8Array(await other.arrayBuffer()))).sheets[0].rows;
    expect(otherRows[1]).toEqual(["日付", "ドライバー", "案件", "数量", "単位", "備考"]);
    expect(otherRows.slice(2)).toHaveLength(11);
  });

  it("人 × 案件の表で取り込んだ会社は、同じ横持ちの形で出て、取り込み直すと同じ数量", async () => {
    const t = await createTestDb();
    const { tenantId: tid } = await seedDemo(t.db);
    const { fileName, bytes } = await readSampleFile("wide");
    const d = await createDraftFromFile(t.db, tid, { id: null }, { fileName, bytes, pageMonth: DEMO_MONTH });
    await applyBatch(t.db, tid, { id: null }, d.id, { mode: "replaceAll", confirmDuplicates: false });
    const file = await buildWorkExport(t.db, tid, DEMO_MONTH);
    const rows = (await readTable(file.fileName, file.bytes)).sheets[0].rows;
    expect(rows[1]).toEqual(["氏名", "宅配（個）", "企業配（日）", "スポット（件）", "ルート（時間）", "夜間便（便）", "計"]);
    expect(rows[2]).toEqual(["青木 翔太", "2310", "0", "4", "0", "0", "2314"]);
    expect(rows.at(-1)).toEqual(["合計", "4950", "61", "6", "168", "20", "5205"]);
    const again = await createDraftFromFile(t.db, tid, { id: null }, { fileName: file.fileName, bytes: file.bytes, pageMonth: DEMO_MONTH });
    const view = (await loadDraftView(t.db, tid, again.id))!;
    expect(view.summary.mappingFrom).toBe("profile");
    expect(view.stats).toMatchObject({ records: 11, totalQty: 5205 });
    expect(view.computed.parse.checks.every((c) => c.ok)).toBe(true);

    // 11 月は別の形（1 行 1 件の CSV）で取り込んだ：10 月を出すときは 10 月に取り込んだ形のまま、11 月は 11 月の形
    const nov = new TextEncoder().encode("日付,ドライバー,コース,個数\n2026/11/02,青木 翔太,宅配,10\n2026/11/03,上田 健,宅配,12\n");
    const n = await createDraftFromFile(t.db, tid, { id: null }, { fileName: "応援_11月.csv", bytes: nov, pageMonth: DEMO_MONTH });
    expect(n.month).toBe("2026-11-01");
    await applyBatch(t.db, tid, { id: null }, n.id, { mode: "add", confirmDuplicates: false });
    expect((await loadExportLayout(t.db, tid, DEMO_MONTH)).labels).toEqual(["氏名", "宅配（個）", "企業配（日）", "スポット（件）", "ルート（時間）", "夜間便（便）", "計"]);
    expect((await loadExportLayout(t.db, tid, "2026-11-01")).labels).toEqual(["日付", "ドライバー", "コース", "個数"]);
    // 取り込みの無い月は、いちばん最近の取り込みの形
    expect((await loadExportLayout(t.db, tid, "2026-12-01")).fileName).toBe("応援_11月.csv");
    const octRows = (await readTable("r.xlsx", (await buildWorkExport(t.db, tid, DEMO_MONTH)).bytes)).sheets[0].rows;
    expect(octRows[1][0]).toBe("氏名");
    expect(octRows.at(-1)).toEqual(["合計", "4950", "61", "6", "168", "20", "5205"]);
    const novRows = (await readTable("r.xlsx", (await buildWorkExport(t.db, tid, "2026-11-01")).bytes)).sheets[0].rows;
    expect(novRows[1]).toEqual(["日付", "ドライバー", "コース", "個数"]);
    expect(novRows.slice(2, 4)).toEqual([
      // 日付は Excel の日付のセルで出す（読み直すと YYYY-MM-DD）
      ["2026-11-02", "青木 翔太", "宅配（個建て）", "10"],
      ["2026-11-03", "上田 健", "宅配（個建て）", "12"],
    ]);
    await t.client.close();
  });
});
