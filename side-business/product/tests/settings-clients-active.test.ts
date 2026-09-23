import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { audit } from "~/server/audit";
import { buildStatementDrafts } from "~/server/calc/statement";
import { loadBuildInput } from "~/server/repo";
import {
  CLIENT_DEACTIVATE_ACTION,
  clientPickerOptions,
  deactivateClient,
  deleteClient,
  listClients,
  projectsTurnedOffWith,
  restorableProjectCount,
  restoreClient,
} from "~/server/features/settings/clients";
import { firstIssue } from "~/server/features/settings/errors";
import { settingsOverview } from "~/server/features/settings/overview";
import { createProject, setProjectActive, updateProject } from "~/server/features/settings/projects";
import { projectSchema } from "~/server/features/settings/schemas";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 元請の「取引をやめる（無効にする）」と「戻す」。
 * 無効の元請は案件の元請を選ぶところに出ない（いま結びついている案件を直すときだけ残す）。記録と明細の数字は変わらない。
 */

let db: Db;
let client: PGlite;
let A: string;
let B: string;

async function clientByName(tenantId: string, name: string) {
  const [c] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.name, name)));
  return c;
}
async function projectsOf(tenantId: string, clientId: string) {
  return db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.clientId, clientId)));
}
async function failure(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return firstIssue(e);
  }
}
async function aokiTotal(tenantId: string) {
  const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
  return buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH)).find((x) => x.driverId === d.id)!.total;
}
/** Server Action と同じように、取引をやめた記録を残す */
async function deactivateAndRecord(tenantId: string, id: string, withProjects: boolean) {
  const r = await deactivateClient(db, tenantId, id, { withProjects });
  await audit(db, { tenantId, action: CLIENT_DEACTIVATE_ACTION, entity: "client", entityId: id, detail: { name: r.before.name, projectIds: r.projectIds } });
  return r;
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  client = t.client;
  A = (await seedDemo(db)).tenantId;
  B = (await seedDemo(db)).tenantId;
});
afterAll(async () => client.close());

describe("元請を無効にする・戻す", () => {
  it("取引をやめる：案件も一緒に「使わない」にできる。前から使わない案件は数えない。明細の数字は変わらない（青木 357,555円）", async () => {
    const a = await clientByName(A, "A物流（架空）");
    expect(await aokiTotal(A)).toBe(357_555);
    // 夜間便だけ、前から「使わない」にしておく（戻すときに戻らないこと）
    const night = (await projectsOf(A, a.id)).find((p) => p.name === "夜間便")!;
    await setProjectActive(db, A, night.id, false);

    const r = await deactivateAndRecord(A, a.id, true);
    expect(r.after.active).toBe(false);
    expect(r.projectIds).toHaveLength(2);
    expect(r.projectIds).not.toContain(night.id);
    expect((await projectsOf(A, a.id)).every((p) => !p.active)).toBe(true);
    // 記録は残る（案件・お支払通知は消えない）。数字も変わらない
    expect((await listClients(db, A)).find((c) => c.id === a.id)).toMatchObject({ active: false, projects: 3, activeProjects: 0, notices: 1 });
    expect(await aokiTotal(A)).toBe(357_555);
    // 2 回目は止める
    expect(await failure(deactivateClient(db, A, a.id, { withProjects: true }))).toContain("もう無効");
    // 使われている元請は、無効にしても消せない
    expect(await failure(deleteClient(db, A, a.id))).toContain("取引をやめる");
  });

  it("一覧：有効な元請が先・無効は後ろ。status で絞れる。設定のはじめに「無効 1社」", async () => {
    const all = await listClients(db, A);
    expect(all.map((c) => [c.name, c.active])).toEqual([
      ["B商事（架空）", true],
      ["A物流（架空）", false],
    ]);
    expect((await listClients(db, A, { status: "active" })).map((c) => c.name)).toEqual(["B商事（架空）"]);
    expect((await listClients(db, A, { status: "inactive" })).map((c) => c.name)).toEqual(["A物流（架空）"]);
    expect((await settingsOverview(db, A)).clients).toEqual({ total: 2, active: 1 });
    // 別の会社には何も起きていない
    expect((await listClients(db, B, { status: "active" })).map((c) => c.name).sort()).toEqual(["A物流（架空）", "B商事（架空）"]);
  });

  it("案件の元請を選ぶところ：無効の元請は出さない。いま結びついている案件を直すときだけ、印を付けて残す", async () => {
    const a = await clientByName(A, "A物流（架空）");
    const clients = await listClients(db, A);
    expect(clientPickerOptions(clients).map((c) => c.name)).toEqual(["B商事（架空）"]);
    expect(clientPickerOptions(clients, a.id).map((c) => c.name)).toEqual(["B商事（架空）", "A物流（架空）（取引をやめた元請）"]);

    // 新しい案件には結びつけられない
    const bad = projectSchema.parse({ clientId: a.id, name: "チャーター便", unit: "便", billRate: "30000", payRate: "24000", active: "on" });
    expect(await failure(createProject(db, A, bad))).toContain("取引をやめた");
    // いま A物流 の案件は、元請をそのままにして直せる（単価を直すなど）
    const takuhai = (await projectsOf(A, a.id)).find((p) => p.name === "宅配（個建て）")!;
    const keep = await updateProject(db, A, takuhai.id, projectSchema.parse({ clientId: a.id, name: "宅配（個建て）", unit: "個", billRate: "190", payRate: "150" }));
    expect(keep.after.clientId).toBe(a.id);
    // 別の元請の案件を、無効の元請へ付け替えることはできない
    const b = await clientByName(A, "B商事（架空）");
    const bProject = (await projectsOf(A, b.id))[0];
    expect(
      await failure(updateProject(db, A, bProject.id, projectSchema.parse({ clientId: a.id, name: bProject.name, unit: bProject.unit, billRate: String(bProject.billRate), payRate: String(bProject.payRate) }))),
    ).toContain("取引をやめた");
    expect((await projectsOf(A, b.id)).map((p) => p.id)).toContain(bProject.id);
  });

  it("別の会社からは、無効にも戻しにもできない。戻す案件の記録も読めない", async () => {
    const a = await clientByName(A, "A物流（架空）");
    expect(await failure(restoreClient(db, B, a.id, { withProjects: true }))).toContain("見つかりません");
    expect(await failure(deactivateClient(db, B, a.id, { withProjects: true }))).toContain("見つかりません");
    expect(await projectsTurnedOffWith(db, B, a.id)).toEqual([]);
    expect(await restorableProjectCount(db, B, a.id)).toBe(0);
    expect((await clientByName(A, "A物流（架空）")).active).toBe(false);
    // B の同じ名前の元請は有効なまま・案件もそのまま
    const bSame = await clientByName(B, "A物流（架空）");
    expect(bSame.active).toBe(true);
    expect((await projectsOf(B, bSame.id)).every((p) => p.active)).toBe(true);
  });

  it("戻す：やめたときに一緒に「使わない」にした案件だけを戻す（前から使わない夜間便はそのまま）", async () => {
    const a = await clientByName(A, "A物流（架空）");
    expect(await restorableProjectCount(db, A, a.id)).toBe(2);
    const r = await restoreClient(db, A, a.id, { withProjects: true });
    expect(r.after.active).toBe(true);
    expect(r.projectIds).toHaveLength(2);
    const projects = await projectsOf(A, a.id);
    expect(projects.filter((p) => p.active).map((p) => p.name).sort()).toEqual(["企業配（日当）", "宅配（個建て）"].sort());
    expect(projects.find((p) => p.name === "夜間便")!.active).toBe(false);
    expect(await failure(restoreClient(db, A, a.id, { withProjects: false }))).toContain("もう有効");
    expect(await aokiTotal(A)).toBe(357_555);
  });

  it("案件をそのままにして無効にし、案件は戻さずに戻すこともできる", async () => {
    const b = await clientByName(A, "B商事（架空）");
    const before = (await projectsOf(A, b.id)).map((p) => [p.id, p.active]);
    const r = await deactivateAndRecord(A, b.id, false);
    expect(r.projectIds).toEqual([]);
    expect((await projectsOf(A, b.id)).map((p) => [p.id, p.active])).toEqual(before);
    expect(await restorableProjectCount(db, A, b.id)).toBe(0);
    const back = await restoreClient(db, A, b.id, { withProjects: true });
    expect(back.projectIds).toEqual([]);
    expect((await clientByName(A, "B商事（架空）")).active).toBe(true);
  });
});
