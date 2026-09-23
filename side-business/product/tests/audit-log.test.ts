import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { audit } from "~/server/audit";
import { auditCategoryOf, auditCsvRows, auditLabel, auditSummary, closeMonth, searchAuditLog } from "~/server/features/close";
import { createTransferBatch } from "~/server/features/transfer";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

/** ほかの機能が操作の記録に書いている名前（grep で集めたもの）。どれも「◯◯の操作」ではなく、読める言葉で出す */
const KNOWN_ACTIONS = [
  "accounting.settings",
  "adjustment.add",
  "adjustment.delete",
  "adjustment.update",
  "client.create",
  "client.delete",
  "client.update",
  "data.export",
  "data.import",
  "deduction_rule.activate",
  "deduction_rule.create",
  "deduction_rule.deactivate",
  "deduction_rule.delete",
  "deduction_rule.update",
  "driver.activate",
  "driver.bulk_create",
  "driver.create",
  "driver.deactivate",
  "driver.delete",
  "driver.update",
  "export.accounting",
  "export.audit_csv",
  "export.ceo_pdf",
  "export.payments_csv",
  "export.reconcile_items",
  "export.statement_confirmations",
  "export.statement_pdf",
  "export.statements_pdf",
  "import.apply",
  "import.discard",
  "import.header",
  "import.mapping",
  "import.month",
  "import.profile.delete",
  "import.name.match",
  "import.name.skip",
  "import.name.unskip",
  "import.name.create",
  "import.name.createAllDrivers",
  "terms.receive",
  "terms.pdf",
  "export.terms_pdf",
  "import.sheet",
  "import.undo",
  "import.upload",
  "invite.accept",
  "invite.create",
  "invite.revoke",
  "login",
  "month.close",
  "month.reopen",
  "onboarding.company",
  "onboarding.finish",
  "onboarding.reopen",
  "onboarding.step",
  "parallel.clear",
  "parallel.golive",
  "parallel.golive_undo",
  "parallel.save",
  "project.activate",
  "project.bulk_create",
  "project.create",
  "project.deactivate",
  "project.delete",
  "project.update",
  "rate_override.create",
  "rate_override.delete",
  "rate_override.update",
  "reconcile.columns",
  "reconcile.driver_mapping",
  "reconcile.item_removed",
  "reconcile.item_status",
  "reconcile.items_asked",
  "reconcile.line_mapping",
  "reconcile.notice_delete",
  "reconcile.notice_import",
  "reconcile.notice_meta",
  "reconcile.notice_replace",
  "reconcile.run",
  "rule.bulk_create",
  "settings.ai_consent",
  "settings.company.update",
  "setup",
  "statement.annual_csv",
  "statement.confirm",
  "statement.generate",
  "statement.pdf",
  "statement.question",
  "statement.relink",
  "statement.remove",
  "statement.reopen_question",
  "statement.reply",
  "statement.resolve",
  "statement.send",
  "statement.view",
  "terms.bulk_create",
  "terms.create",
  "terms.relink",
  "terms.send",
  "transfer.create",
  "transfer.delete",
  "transfer.download",
  "transfer.executed",
  "user.disable",
  "user.enable",
  "user.role",
  "watch.ack",
  "watch.unack",
  "work.add",
  "work.delete",
  "work.update",
  // 2 回目の組み立てで増えた操作
  "import.reapply",
  "import.export",
  "import.bank.upload",
  "import.bank.assign",
  "import.bank.apply",
  "import.bank.discard",
  "export.parallel_pdf",
  "export.reconcile_letter",
  "export.terms_csv",
  "export.terms_pdf_all",
  "user.password_change",
  "user.sign_out_others",
  // 振り込んだあとに明細が変わったときの、差の精算
  "transfer.settle",
  "transfer.settle_undo",
  // 読むための PDF の書き出し（年ごと）
  "data.export_pdfs",
  // 明細の検索（/records）の索引
  "export.records_csv",
];

/** いまのソースが操作の記録に書いている名前（action: "…" と *_ACTION = "…"）を集める */
function actionsInSource(): string[] {
  const root = path.resolve(__dirname, "..");
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(e.name) && !full.endsWith(path.join("features", "close.ts"))) {
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/action:\s*(?:[^,}\n]*\?\s*)?"([a-z_]+(?:\.[A-Za-z_]+)+|setup|login)"(?:\s*:\s*"([a-z_]+(?:\.[A-Za-z_]+)+)")?/g)) {
          found.add(m[1]);
          if (m[2]) found.add(m[2]);
        }
        for (const m of src.matchAll(/_ACTION\s*=\s*"([a-z_]+(?:\.[A-Za-z_]+)+)"/g)) found.add(m[1]);
      }
    }
  };
  for (const dir of ["server", "app"]) walk(path.join(root, dir));
  return [...found].sort();
}

describe("操作の記録の読み替え", () => {
  it("ほかの機能が書く操作は、すべて読める日本語の名前になる", () => {
    for (const a of KNOWN_ACTIONS) {
      const label = auditLabel(a);
      expect(label, a).not.toBe("操作");
      expect(label.endsWith("の操作"), `${a} → ${label}`).toBe(false);
    }
    expect(auditLabel("import.name.other")).toBe("取り込みの名前の対応の操作");
    expect(auditLabel("unknown.thing")).toBe("操作");
  });

  it("ソースに書かれている操作は、どれも種類が決まり、読める名前になる（あとから足された操作も）", () => {
    const found = actionsInSource();
    // grep で集められているか（少なすぎれば探し方が壊れている）
    expect(found.length).toBeGreaterThan(80);
    for (const a of ["transfer.create", "statement.confirm", "import.bank.apply", "user.password_change", "import.reapply"]) expect(found, a).toContain(a);
    for (const a of found) {
      expect(auditCategoryOf(a), a).not.toBe("other");
      expect(auditLabel(a), a).not.toBe("操作");
    }
    // いまある操作は、すべて専用の名前がある
    const missing = found.filter((a) => !KNOWN_ACTIONS.includes(a) && auditLabel(a).endsWith("の操作"));
    expect(missing).toEqual([]);
  });

  it("種類：設定・出力・その他", () => {
    expect(auditCategoryOf("driver.update")).toBe("settings");
    expect(auditCategoryOf("login")).toBe("settings");
    expect(auditCategoryOf("data.export")).toBe("export");
    expect(auditCategoryOf("terms.send")).toBe("terms");
    expect(auditCategoryOf("reconcile.run")).toBe("reconcile");
    expect(auditCategoryOf("misc.thing")).toBe("other");
    // いちばん長く当てはまる頭で決める
    expect(auditCategoryOf("import.export")).toBe("export");
    expect(auditCategoryOf("import.bank.apply")).toBe("import");
    expect(auditCategoryOf("import.apply")).toBe("import");
  });

  it("1 行のまとめ：設定の変更は項目の名前だけ（値は出さない）", () => {
    expect(auditSummary("driver.update", { name: "青木 翔太", changed: { accountNumber: { from: "1234567", to: "7654321" }, branchCode: { from: "101", to: "102" } } })).toBe(
      "青木 翔太：変えたところ：口座番号・支店コード",
    );
    expect(auditSummary("import.apply", { mode: "replace", confirmDuplicates: false, entries: 11, removedEntries: 3, replacedBatches: 1, month: DEMO_MONTH })).toBe(
      "同じ形の取り込みを入れ替え・11件を入れた・3件を消した",
    );
    expect(auditSummary("import.undo", { deleted: 11, restored: 0, month: DEMO_MONTH })).toBe("11件を消した");
    expect(auditSummary("user.role", { name: "山田", from: "staff", to: "owner" })).toBe("山田：事務 → オーナー");
    expect(auditSummary("statement.confirm", { by: "driver", version: 2, total: 357555 })).toBe("第2版・振込額 357,555円");
    expect(auditSummary("transfer.create", { fileName: "振込.txt", count: 4, total: 100, bankChanged: [{}, {}] })).toBe("振込.txt・4人・100円・口座が変わった人 2人を確かめた");
    expect(auditSummary("reconcile.item_status", { label: "宅配", diff: -9500, recoveredAmount: 9500 })).toBe("宅配・差 -9,500円・取り戻せた額 9,500円");
    expect(auditSummary("data.export", { fileName: "a.zip", rows: 120, versions: 9 })).toBe("a.zip・120行・明細の版 9件");
  });
});

describe("操作の記録を探す（範囲・種類・人・ページ）", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherTenantId: string;
  let ownerId: string;
  let staffId: string;
  let d01: string;

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherTenantId } = await seedDemo(db));
    const users = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    ownerId = users.find((u) => u.role === "owner")!.id;
    staffId = users.find((u) => u.role === "staff")!.id;
    [{ id: d01 }] = await db.select({ id: s.drivers.id }).from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));

    await generateStatements(db, tenantId, DEMO_MONTH, staffId);
    const [st] = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.driverId, d01)));
    // ドライバーが開いて確認した（ログインなし）・事務が返事をした（中身に月が無い記録）
    await audit(db, { tenantId, action: "statement.view", entity: "statement", entityId: st.id, detail: { by: "driver", month: DEMO_MONTH, driverId: d01, version: 1 } });
    await audit(db, { tenantId, action: "statement.confirm", entity: "statement", entityId: st.id, detail: { by: "driver", month: DEMO_MONTH, driverId: d01, version: 1, total: st.total } });
    await audit(db, { tenantId, userId: staffId, action: "statement.reply", entity: "statement", entityId: st.id, detail: { lineKey: null, length: 12 } });
    // 取り込み（中身に月が無い記録も、その月の取り込みなら入る）
    const [batch] = await db.insert(s.importBatches).values({ tenantId, month: DEMO_MONTH, fileName: "10月.xlsx", status: "applied" }).returning();
    await audit(db, { tenantId, userId: staffId, action: "import.sheet", entity: "import_batch", entityId: batch.id, detail: { sheet: "10月" } });
    await audit(db, { tenantId, userId: staffId, action: "import.name.match", entity: "driver", entityId: d01, detail: { batchId: batch.id, key: "あおき" } });
    // 元請の支払通知（その月の通知）
    const [notice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId));
    await audit(db, { tenantId, userId: ownerId, action: "reconcile.items_asked", entity: "payment_notice", entityId: notice.id, detail: { itemIds: [] } });
    await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" }, staffId);
    await closeMonth(db, tenantId, DEMO_MONTH, staffId, { runWatch: async () => [] });
    // 9 月の記録（混ざらないこと）
    await audit(db, { tenantId, userId: staffId, action: "watch.ack", entity: "watch", entityId: "x", detail: { month: DEMO_PREV_MONTH, title: "9 月の指摘" } });
    // 設定の変更（月の無い記録）：10 月 31 日 23:59（日本時間）と、11 月 1 日 0:30（日本時間）
    await db.insert(s.auditLog).values([
      { tenantId, userId: ownerId, action: "driver.update", entity: "driver", entityId: d01, detail: { name: "青木 翔太", changed: { phone: { from: null, to: "090" } } }, createdAt: new Date("2026-10-31T14:59:00Z") },
      { tenantId, userId: ownerId, action: "settings.company.update", entity: "tenant", entityId: tenantId, detail: { changed: { payDay: { from: 25, to: 20 } } }, createdAt: new Date("2026-10-31T15:30:00Z") },
      { tenantId, action: "misc.thing", entity: "x", detail: { month: DEMO_MONTH } },
    ]);
    // 他社の 10 月の記録
    await generateStatements(db, otherTenantId, DEMO_MONTH);
  });
  afterAll(async () => client.close());

  it("この月の分：中身に月が無い記録も、その月の明細・取り込み・支払通知・振込データのものなら入る。9 月のものは入らない", async () => {
    const res = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, pageSize: 100 });
    const actions = res.rows.map((r) => r.action);
    for (const a of ["statement.generate", "statement.view", "statement.confirm", "statement.reply", "import.sheet", "import.name.match", "reconcile.items_asked", "transfer.create", "month.close", "misc.thing"]) {
      expect(actions, a).toContain(a);
    }
    expect(actions).not.toContain("watch.ack");
    expect(actions).not.toContain("driver.update");
    expect(res.total).toBe(res.rows.length);
    // 新しい順
    expect(res.rows.map((r) => r.id)).toEqual([...res.rows.map((r) => r.id)].sort((a, b) => b - a));
    // ドライバーの操作は、ドライバーの名前で
    const view = res.rows.find((r) => r.action === "statement.view")!;
    expect(view.actor).toBe("青木 翔太さん（ドライバー）");
    expect(view.userName).toBe("ドライバー");
    expect(res.rows.find((r) => r.action === "month.close")!.actor).toBe("デモ 事務さん");
    expect(res.rows.find((r) => r.action === "misc.thing")!.actor).toBe("自動");
  });

  it("この月に行った操作（日本時間の暦の月）：設定の変更も入る。月の境目は日本時間で分ける", async () => {
    const oct = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, scope: "period", kind: "settings", pageSize: 100 });
    expect(oct.rows.map((r) => r.action)).toEqual(["driver.update"]);
    expect(oct.rows[0].summary).toBe("青木 翔太：変えたところ：電話");
    const nov = await searchAuditLog(db, tenantId, { month: "2026-11-01", scope: "period", kind: "settings", pageSize: 100 });
    expect(nov.rows.map((r) => r.action)).toEqual(["settings.company.update"]);
  });

  it("種類と人で絞る。候補には件数を付ける", async () => {
    const transfer = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, kind: "transfer" });
    expect(transfer.rows.map((r) => r.action)).toEqual(["transfer.create"]);
    const other = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, kind: "other" });
    expect(other.rows.map((r) => r.action)).toEqual(["misc.thing"]);
    const drivers = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, who: "driver" });
    expect(drivers.rows.map((r) => r.action).sort()).toEqual(["statement.confirm", "statement.view"]);
    const staff = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, who: `user:${staffId}` });
    expect(staff.rows.every((r) => r.actor === "デモ 事務さん")).toBe(true);
    expect(staff.rows.map((r) => r.action)).toContain("statement.reply");
    const system = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, who: "system" });
    expect(system.rows.map((r) => r.action)).toEqual(["misc.thing"]);
    // おかしな値は 0 件（全部を返さない）
    expect((await searchAuditLog(db, tenantId, { month: DEMO_MONTH, who: "user:not-a-uuid" })).total).toBe(0);
    expect((await searchAuditLog(db, tenantId, { month: DEMO_MONTH, kind: "nope" })).total).toBe(0);

    const all = await searchAuditLog(db, tenantId, { month: DEMO_MONTH });
    expect(all.kinds.find((k) => k.key === "transfer")?.count).toBe(1);
    // 明細：作った（事務が 1 回・締めるときに 1 回）・開いた・確認した・返事をした
    expect(all.kinds.find((k) => k.key === "statement")?.count).toBe(5);
    expect(all.people.find((p) => p.key === "driver")).toMatchObject({ label: "ドライバー", count: 2 });
    expect(all.people.find((p) => p.key === `user:${staffId}`)?.label).toBe("デモ 事務さん");
  });

  it("ページで区切る（新しい順）", async () => {
    const all = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, pageSize: 100 });
    const p1 = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, pageSize: 3, page: 1 });
    const p2 = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, pageSize: 3, page: 2 });
    expect(p1.pages).toBe(Math.ceil(all.total / 3));
    expect(p1.rows.map((r) => r.id)).toEqual(all.rows.slice(0, 3).map((r) => r.id));
    expect(p2.rows.map((r) => r.id)).toEqual(all.rows.slice(3, 6).map((r) => r.id));
    // ページが大きすぎれば最後のページ
    const last = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, pageSize: 3, page: 999 });
    expect(last.page).toBe(p1.pages);
  });

  it("CSV：見出し＋絞り込んだ全件（日本時間・した人・中身の JSON）", async () => {
    const rows = await auditCsvRows(db, tenantId, { month: DEMO_MONTH, who: "driver" });
    expect(rows[0]).toEqual(["番号", "日時（日本時間）", "した人", "操作", "内容", "種類", "操作の名前", "対象", "対象の id", "記録の中身（JSON）"]);
    expect(rows).toHaveLength(3);
    const confirm = rows.find((r) => r[6] === "statement.confirm")!;
    expect(confirm[2]).toBe("青木 翔太さん（ドライバー）");
    expect(confirm[3]).toBe("ドライバーが明細を確認した");
    expect(confirm[5]).toBe("明細とドライバーの確認");
    expect(String(confirm[1])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(JSON.parse(String(confirm[9]))).toMatchObject({ by: "driver", version: 1 });
  });

  it("口座番号は、画面にも CSV にも下 3 桁だけを出す（記録そのものは変えない）", async () => {
    const DEC = "2026-12-01";
    await db.insert(s.auditLog).values({
      tenantId,
      userId: staffId,
      action: "driver.update",
      entity: "driver",
      entityId: d01,
      detail: { name: "青木 翔太", changed: { accountNumber: { from: "1234567", to: "7654321" }, branchCode: { from: "101", to: "102" } } },
      createdAt: new Date("2026-12-03T01:00:00Z"),
    });
    const res = await searchAuditLog(db, tenantId, { month: DEC, scope: "period" });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].detail).toEqual({ name: "青木 翔太", changed: { accountNumber: { from: "****567", to: "****321" }, branchCode: { from: "101", to: "102" } } });
    // 項目の並びは DB（jsonb）の並びのまま。値は出さない
    expect(res.rows[0].summary).toMatch(/^青木 翔太：変えたところ：(口座番号・支店コード|支店コード・口座番号)$/);
    const csv = await auditCsvRows(db, tenantId, { month: DEC, scope: "period" });
    expect(csv.flat().join("|")).not.toContain("1234567");
    expect(csv.flat().join("|")).not.toContain("7654321");
    expect(String(csv[1][9])).toContain("****321");
    // 記録そのものは元のまま（全データの書き出しには元のまま入る）
    const [raw] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "driver.update"), eq(s.auditLog.userId, staffId)));
    expect(JSON.stringify(raw.detail)).toContain("7654321");
  });

  it("他社の記録は、どの絞り込みでも出ない", async () => {
    const mine = await searchAuditLog(db, tenantId, { month: DEMO_MONTH, pageSize: 500 });
    const theirs = await searchAuditLog(db, otherTenantId, { month: DEMO_MONTH, pageSize: 500 });
    expect(theirs.rows.map((r) => r.action)).toEqual(["statement.generate"]);
    expect(theirs.rows.some((r) => mine.rows.some((m) => m.id === r.id))).toBe(false);
    expect((await searchAuditLog(db, otherTenantId, { month: DEMO_MONTH, who: `user:${staffId}` })).total).toBe(0);
    expect((await searchAuditLog(db, otherTenantId, { month: DEMO_MONTH, scope: "period", pageSize: 500 })).rows.some((r) => r.action === "driver.update")).toBe(false);
    expect((await auditCsvRows(db, otherTenantId, { month: DEMO_MONTH })).length).toBe(2);
  });
});

describe("入り直しのリンク（scripts/reset-access.ts）の記録", () => {
  it("画面の招待と見分けられる", () => {
    expect(auditSummary("invite.create", { name: "山田", role: "owner", via: "reset-access" })).toContain("入り直しのリンク");
    expect(auditSummary("invite.create", { name: "山田", role: "owner" })).not.toContain("入り直し");
    expect(auditSummary("invite.revoke", { name: "山田", role: "owner", via: "reset-access" })).not.toContain("入り直し");
  });
});
