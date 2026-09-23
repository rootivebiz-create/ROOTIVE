import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { createTermsVersion, listTerms, recreateTermsLink, type TermsActor } from "~/server/features/terms";
import { termsLinkExpiresAt, termsLinkToken, termsShareMessage, TERMS_LINK_DAYS } from "~/server/features/terms/links";
import {
  findTermsByToken,
  loadTermsPortal,
  receiveTermsFromPortal,
  termsPdfForToken,
  TERMS_BY_STAFF,
  TERMS_LINK_UNUSABLE,
  TERMS_NEWER_VERSION,
  TERMS_STALE,
  TERMS_TOO_MANY,
} from "~/server/features/terms/portal";
import type { TermsVersionInput } from "~/server/features/terms/schema";
import { resetRateLimit } from "~/server/rate-limit";
import { seedDemo } from "~/server/seed-demo";
import { signLink, signStatementLink } from "~/server/tokens";
import { createTestDb } from "./helpers/db";

/**
 * ドライバーのリンク：署名・書き換え・期限・作り直し・古い版・「受け取りました」・会社の区切り。
 */
const NOW = new Date("2026-10-20T10:00:00+09:00");
const LATER = new Date("2026-10-21T08:30:00+09:00");

let db: Db;
let client: PGlite;
let tenantId: string;
let otherId: string;
let staff: TermsActor;
let otherStaff: TermsActor;
const D: Record<string, string> = {};
const OD: Record<string, string> = {};
const P: Record<string, string> = {};
const OP: Record<string, string> = {};

function input(driverId: string, projectIds: string[], patch: Partial<TermsVersionInput> = {}): TermsVersionInput {
  return {
    driverId,
    projectIds,
    serviceDescription: "貨物軽自動車を使った荷物の配送業務",
    place: "会社が指定する配送先",
    periodFrom: "2026-04-01",
    receipt: "業務を行った日ごとに受け取ったものとします。",
    deemed: false,
    isSubcontract: false,
    issuedOn: "2026-10-20",
    ...patch,
  };
}

async function recordsOf(driverId: string) {
  return db.select().from(s.termsRecords).where(eq(s.termsRecords.driverId, driverId));
}

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  client = t.client;
  ({ tenantId } = await seedDemo(db));
  ({ tenantId: otherId } = await seedDemo(db));
  for (const [tid, dMap, pMap] of [
    [tenantId, D, P],
    [otherId, OD, OP],
  ] as const) {
    for (const r of await db.select().from(s.drivers).where(eq(s.drivers.tenantId, tid))) dMap[r.code!] = r.id;
    for (const r of await db.select().from(s.projects).where(eq(s.projects.tenantId, tid))) pMap[r.name] = r.id;
  }
  const [u] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff")));
  const [ou] = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, otherId), eq(s.users.role, "staff")));
  staff = { userId: u.id, role: "staff" };
  otherStaff = { userId: ou.id, role: "staff" };
  await createTermsVersion(db, tenantId, staff, input(D.D01, [P["宅配（個建て）"], P["スポット便"]]), NOW);
  await createTermsVersion(db, otherId, otherStaff, input(OD.D01, [OP["宅配（個建て）"]]), NOW);
});
afterAll(async () => client.close());
beforeEach(() => resetRateLimit());

describe("リンクの署名", () => {
  it("期限は今日（日本時間）から 180 日後の日の終わり。同じ日なら同じリンク", async () => {
    const [rec] = await recordsOf(D.D01);
    const a = termsLinkToken(rec, NOW);
    const b = termsLinkToken(rec, new Date("2026-10-20T23:00:00+09:00"));
    expect(a.token).toBe(b.token);
    expect(TERMS_LINK_DAYS).toBe(180);
    expect(new Date(termsLinkExpiresAt(NOW) * 1000).toISOString()).toBe("2027-04-18T14:59:59.000Z");
    expect(termsShareMessage("青木 翔太", "サンプル運送", "https://x/t/abc")).toContain("「受け取りました」");
  });

  it("正しいリンクは開ける。1 文字でも書き換えたら・期限が過ぎたら・明細用の署名なら開けない", async () => {
    const [rec] = await recordsOf(D.D01);
    const { token } = termsLinkToken(rec, NOW);
    expect((await findTermsByToken(db, token, NOW))?.id).toBe(rec.id);

    // 署名の部分を書き換える
    const [payload, mac] = token.split(".");
    const tampered = `${payload}.${mac.slice(0, -2)}${mac.endsWith("AA") ? "BB" : "AA"}`;
    expect(await findTermsByToken(db, tampered, NOW)).toBeNull();
    // 中身（id）を別の人の記録に書き換える
    const [other] = await recordsOf(OD.D01);
    const swapped = `${Buffer.from(`${other.id}.${rec.linkNonce}.${termsLinkExpiresAt(NOW)}`).toString("base64url")}.${mac}`;
    expect(await findTermsByToken(db, swapped, NOW)).toBeNull();
    // 期限切れ
    const expired = signLink("terms", rec.id, rec.linkNonce, Math.floor(NOW.getTime() / 1000) - 1);
    expect(await findTermsByToken(db, expired, NOW)).toBeNull();
    expect(await findTermsByToken(db, token, new Date(termsLinkExpiresAt(NOW) * 1000 + 1000))).toBeNull();
    // 同じ id・nonce でも、明細用の署名では開けない
    expect(await findTermsByToken(db, signStatementLink(rec.id, rec.linkNonce, termsLinkExpiresAt(NOW)), NOW)).toBeNull();
    // 形の崩れ
    for (const bad of ["", "abc", "a.b.c", "x".repeat(700)]) expect(await findTermsByToken(db, bad, NOW)).toBeNull();
    expect(await loadTermsPortal(db, tampered, NOW)).toBeNull();
  });

  it("ほかの会社の記録のリンクは、その会社の書面だけを出す（名前・会社が混ざらない）", async () => {
    const [theirs] = await recordsOf(OD.D01);
    const { token } = termsLinkToken(theirs, NOW);
    const data = await loadTermsPortal(db, token, NOW);
    expect(data?.doc.recordId).toBe(theirs.id);
    expect(data?.doc.driver.name).toBe("青木 翔太");
    const [mine] = await recordsOf(D.D01);
    expect(data?.doc.recordId).not.toBe(mine.id);
  });
});

describe("ドライバーのページと「受け取りました」", () => {
  it("書面の中身・最新の版・リンクの期限が出る", async () => {
    const [rec] = await recordsOf(D.D01);
    const data = (await loadTermsPortal(db, termsLinkToken(rec, NOW).token, NOW))!;
    expect(data.companyName).toBe("サンプル運送株式会社（架空）");
    expect(data.isLatest).toBe(true);
    expect(data.received).toBeNull();
    expect(data.linkExpiresText).toBe("2027年4月18日 23:59");
    const labels = data.sections.map((x) => x.label);
    expect(labels).toContain("報酬の額・算定方法");
    const pay = data.sections.find((x) => x.key === "pay")!;
    expect(pay.table?.rows).toEqual([
      ["スポット便", "B商事（架空）", "7,000円", "1件あたり"],
      ["宅配（個建て）", "A物流（架空）", "150円", "1個あたり"],
    ]);
  });

  it("会社の人のログイン中・画面が古い版は記録しない。押すと日時と IP のハッシュが残り、2 回押しても最初の日時のまま", async () => {
    const [rec] = await recordsOf(D.D01);
    const { token } = termsLinkToken(rec, NOW);
    await expect(receiveTermsFromPortal(db, token, { version: 1 }, { now: LATER, byStaff: true })).rejects.toThrow(TERMS_BY_STAFF);
    await expect(receiveTermsFromPortal(db, token, { version: 2 }, { now: LATER, ipHash: "ip-1" })).rejects.toThrow(TERMS_STALE);
    expect((await recordsOf(D.D01))[0].receivedAt).toBeNull();

    const r = await receiveTermsFromPortal(db, token, { version: 1 }, { now: LATER, ipHash: "ip-1", userAgent: "iPhone" });
    expect(r).toEqual({ at: "2026年10月21日 8:30", version: 1, already: false });
    const [after] = await recordsOf(D.D01);
    expect(after.receivedAt?.toISOString()).toBe(LATER.toISOString());
    expect(after.receivedIpHash).toBe("ip-1");

    const again = await receiveTermsFromPortal(db, token, { version: 1 }, { now: new Date("2026-10-22T09:00:00+09:00"), ipHash: "ip-2" });
    expect(again).toEqual({ at: "2026年10月21日 8:30", version: 1, already: true });
    expect((await recordsOf(D.D01))[0].receivedIpHash).toBe("ip-1");

    const data = (await loadTermsPortal(db, token, LATER))!;
    expect(data.received).toEqual({ at: "2026年10月21日 8:30", version: 1 });
    const list = await listTerms(db, tenantId, LATER);
    expect(list.rows.find((x) => x.driverId === D.D01)!.status).toBe("received");

    const audits = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "terms.receive")));
    expect(audits).toHaveLength(1);
    expect(audits[0].detail).toMatchObject({ by: "driver", version: 1 });
  });

  it("新しい版ができると、前の版のリンクには「新しい版があります」と出て、受け取りは押せない", async () => {
    const [v1] = await recordsOf(D.D01);
    const oldToken = termsLinkToken(v1, NOW).token;
    const v2 = await createTermsVersion(db, tenantId, staff, input(D.D01, [P["宅配（個建て）"]], { place: "A物流 ○○センター" }), NOW);
    expect(v2.version).toBe(2);

    const old = (await loadTermsPortal(db, oldToken, LATER))!;
    expect(old.isLatest).toBe(false);
    expect(old.latestVersion).toBe(2);
    // 新しい版をまだ送っていないうちは、古いリンクから新しい版へは行けない
    expect(old.latestToken).toBeNull();
    await expect(receiveTermsFromPortal(db, oldToken, { version: 1 }, { now: LATER, ipHash: "ip-1" })).rejects.toThrow(TERMS_NEWER_VERSION);

    const [rec2] = (await recordsOf(D.D01)).filter((r) => r.version === 2);
    // 送ったあとは、古いリンクのページから新しい版を開ける（同じドライバーの最新の版だけ）
    await db.update(s.termsRecords).set({ sentAt: NOW }).where(eq(s.termsRecords.id, rec2.id));
    const oldAfterSend = (await loadTermsPortal(db, oldToken, LATER))!;
    expect(oldAfterSend.latestToken).toBeTruthy();
    const viaOld = (await loadTermsPortal(db, oldAfterSend.latestToken!, LATER))!;
    expect(viaOld.isLatest).toBe(true);
    expect(viaOld.doc.version).toBe(2);
    expect(viaOld.latestToken).toBeNull();
    const newToken = termsLinkToken(rec2, NOW).token;
    const cur = (await loadTermsPortal(db, newToken, LATER))!;
    expect(cur.isLatest).toBe(true);
    expect(cur.received).toBeNull();
    expect((await receiveTermsFromPortal(db, newToken, { version: 2 }, { now: LATER, ipHash: "ip-1" })).already).toBe(false);
  });

  it("リンクを作り直すと、前のリンクは開けない・押せない", async () => {
    const [rec] = (await recordsOf(D.D01)).filter((r) => r.version === 2);
    const before = termsLinkToken(rec, NOW).token;
    await recreateTermsLink(db, tenantId, staff, rec.id);
    expect(await loadTermsPortal(db, before, LATER)).toBeNull();
    await expect(receiveTermsFromPortal(db, before, { version: 2 }, { now: LATER })).rejects.toThrow(TERMS_LINK_UNUSABLE);
    const [fresh] = (await recordsOf(D.D01)).filter((r) => r.version === 2);
    expect(await loadTermsPortal(db, termsLinkToken(fresh, NOW).token, LATER)).not.toBeNull();
    // 受け取りの記録は残る
    expect(fresh.receivedAt).not.toBeNull();
  });

  it("短い時間に何度も押すと止める", async () => {
    await createTermsVersion(db, tenantId, staff, input(D.D02, [P["企業配（日当）"]]), NOW);
    const [rec] = await recordsOf(D.D02);
    const { token } = termsLinkToken(rec, NOW);
    for (let i = 0; i < 10; i++) await receiveTermsFromPortal(db, token, { version: 1 }, { now: LATER, ipHash: "ip-busy" });
    await expect(receiveTermsFromPortal(db, token, { version: 1 }, { now: LATER, ipHash: "ip-busy" })).rejects.toThrow(TERMS_TOO_MANY);
  });

  it("PDF の元：リンクが使えなければ null。持ち出しは記録に残る", async () => {
    const [rec] = await recordsOf(D.D02);
    const found = await termsPdfForToken(db, termsLinkToken(rec, NOW).token, { now: LATER, ipHash: "ip-pdf" });
    expect(found?.fileName).toBe("取引条件の明示書_井上 美咲_版1.pdf");
    expect(found?.receivedText).toContain("2026年10月21日 8:30");
    expect(await termsPdfForToken(db, "broken.token", { now: LATER })).toBeNull();
    const audits = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "terms.pdf")));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
