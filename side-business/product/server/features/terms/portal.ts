import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { termsPdfFileName, termsReceivedText, toTermsDocument, type TermsRecordRow } from "~/server/features/terms";
import { termsSections, type TermsDocument, type TermsSection } from "~/server/features/terms/document";
import { jpDateTimeJst } from "~/server/features/terms/links";
import { isUuid } from "~/server/features/terms/schema";
import { tooMany } from "~/server/rate-limit";
import { verifyLink } from "~/server/tokens";

/**
 * ドライバーの取引条件のページ（ログインなし）。入口は署名つきのリンクだけ。
 * - 毎回 verifyLink("terms", …)（署名・期限）と、記録の link_nonce が同じかを確かめる（作り直したリンクは通さない）
 * - 画面から来た id は使わない。記録はリンクの中の id からだけ決め、そこから会社（tenant）を決める
 * - 「受け取りました」を押せるのは最新の版だけ。古い版のリンクには「新しい版があります」と出す
 */

export const TERMS_LINK_UNUSABLE = "このリンクは使えません（期限切れ・作り直し）。会社に新しいリンクをお願いしてください";
export const TERMS_NEWER_VERSION = "新しい版があります。会社から届いたリンクを開いてください";
export const TERMS_TOO_MANY = "短い時間に何度も送られました。少し時間をおいてから、もう一度お試しください";
export const TERMS_STALE = "画面が古くなっています。読み直してから、もう一度押してください";
export const TERMS_BY_STAFF = "会社の方のログイン中は押せません。「受け取りました」はドライバーご本人が押してください（ご本人が会社の方でもあるときは、ログアウトしてから開き直してください）";

export type TermsPortalContext = {
  now?: Date;
  ipHash?: string | null;
  userAgent?: string | null;
  /** 会社の人がログインしたまま開いている（本人の操作として記録しない） */
  byStaff?: boolean;
};

/** リンクの値から記録を探す。署名・期限・nonce のどれかが合わなければ null（どれが違ったかは返さない） */
export async function findTermsByToken(db: Db, token: string, now = new Date()): Promise<TermsRecordRow | null> {
  if (typeof token !== "string" || !token || token.length > 600) return null;
  const check = verifyLink("terms", token, Math.floor(now.getTime() / 1000));
  if (!check.ok || !isUuid(check.id)) return null;
  const rows = await db.select().from(s.termsRecords).where(eq(s.termsRecords.id, check.id)).limit(1);
  const rec = rows[0];
  if (!rec || rec.linkNonce !== check.nonce) return null;
  return rec;
}

async function latestVersionOf(db: Db, rec: Pick<TermsRecordRow, "tenantId" | "driverId">): Promise<number> {
  const [row] = await db
    .select({ v: sql<number | null>`max(${s.termsRecords.version})` })
    .from(s.termsRecords)
    .where(and(eq(s.termsRecords.tenantId, rec.tenantId), eq(s.termsRecords.driverId, rec.driverId)));
  return Number(row?.v ?? 0);
}

async function documentOf(db: Db, rec: TermsRecordRow): Promise<TermsDocument | null> {
  const [tenantRows, driverRows] = await Promise.all([
    db.select({ name: s.tenants.name, registrationNo: s.tenants.registrationNo }).from(s.tenants).where(eq(s.tenants.id, rec.tenantId)).limit(1),
    db
      .select({ name: s.drivers.name, code: s.drivers.code })
      .from(s.drivers)
      .where(and(eq(s.drivers.tenantId, rec.tenantId), eq(s.drivers.id, rec.driverId)))
      .limit(1),
  ]);
  if (!tenantRows[0] || !driverRows[0]) return null;
  return toTermsDocument(rec, tenantRows[0], driverRows[0]);
}

export type TermsPortalData = {
  companyName: string;
  doc: TermsDocument;
  sections: TermsSection[];
  /** このリンクの版が最新か（古い版は「受け取りました」を押せない） */
  isLatest: boolean;
  latestVersion: number;
  received: { at: string; version: number } | null;
  linkExpiresText: string;
};

export async function loadTermsPortal(db: Db, token: string, now = new Date()): Promise<TermsPortalData | null> {
  const rec = await findTermsByToken(db, token, now);
  if (!rec) return null;
  const check = verifyLink("terms", token, Math.floor(now.getTime() / 1000));
  const [doc, latestVersion] = await Promise.all([documentOf(db, rec), latestVersionOf(db, rec)]);
  if (!doc) return null;
  return {
    companyName: doc.company.name,
    doc,
    sections: termsSections(doc),
    isLatest: rec.version === latestVersion,
    latestVersion,
    received: rec.receivedAt ? { at: jpDateTimeJst(rec.receivedAt), version: rec.version } : null,
    linkExpiresText: check.ok ? jpDateTimeJst(new Date(check.expiresAt * 1000)) : "",
  };
}

export type ReceiveResult = { at: string; version: number; already: boolean };

/**
 * 「受け取りました」：画面に出ていた版が、この記録の版で、しかも最新の版のときだけ記録する。
 * 2 回押しても最初の日時のまま。
 */
export async function receiveTermsFromPortal(db: Db, token: string, input: { version: number }, ctx: TermsPortalContext = {}): Promise<ReceiveResult> {
  const now = ctx.now ?? new Date();
  if (ctx.byStaff) throw new UserError(TERMS_BY_STAFF);
  const rec = await findTermsByToken(db, token, now);
  if (!rec) throw new UserError(TERMS_LINK_UNUSABLE);
  if (tooMany(`terms:receive:${ctx.ipHash ?? "unknown"}:${rec.id}`, 10, 10 * 60_000, now.getTime())) throw new UserError(TERMS_TOO_MANY);
  if (!Number.isInteger(input.version) || input.version !== rec.version) throw new UserError(TERMS_STALE);

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(s.termsRecords)
      .where(and(eq(s.termsRecords.id, rec.id), eq(s.termsRecords.tenantId, rec.tenantId)))
      .for("update");
    if (!locked || locked.linkNonce !== rec.linkNonce) throw new UserError(TERMS_LINK_UNUSABLE);
    if ((await latestVersionOf(tx as unknown as Db, locked)) !== locked.version) throw new UserError(TERMS_NEWER_VERSION);
    if (locked.receivedAt) return { at: jpDateTimeJst(locked.receivedAt), version: locked.version, already: true };
    await tx
      .update(s.termsRecords)
      .set({ receivedAt: now, receivedIpHash: ctx.ipHash ?? null })
      .where(and(eq(s.termsRecords.id, locked.id), eq(s.termsRecords.tenantId, locked.tenantId), isNull(s.termsRecords.receivedAt)));
    const doc = await documentOf(tx as unknown as Db, locked);
    await audit(tx as unknown as Db, {
      tenantId: locked.tenantId,
      action: "terms.receive",
      entity: "terms_record",
      entityId: locked.id,
      detail: { by: "driver", driverId: locked.driverId, version: locked.version, hash: doc?.hash ?? null, ua: ctx.userAgent ? ctx.userAgent.slice(0, 200) : null },
    });
    return { at: jpDateTimeJst(now), version: locked.version, already: false };
  });
}

/** ドライバーの PDF の元。リンクが使えなければ null */
export async function termsPdfForToken(
  db: Db,
  token: string,
  ctx: TermsPortalContext = {},
): Promise<{ doc: TermsDocument; receivedText: string; fileName: string } | null> {
  const now = ctx.now ?? new Date();
  const rec = await findTermsByToken(db, token, now);
  if (!rec) return null;
  if (tooMany(`terms:file:${ctx.ipHash ?? "unknown"}`, 30, 10 * 60_000, now.getTime())) throw new UserError(TERMS_TOO_MANY);
  const doc = await documentOf(db, rec);
  if (!doc) return null;
  await audit(db, {
    tenantId: rec.tenantId,
    action: "terms.pdf",
    entity: "terms_record",
    entityId: rec.id,
    detail: { by: ctx.byStaff ? "staff_preview" : "driver", driverId: rec.driverId, version: rec.version },
  });
  return { doc, receivedText: termsReceivedText(rec), fileName: termsPdfFileName(doc) };
}

/** 会社の人が自分の会社の明示書のリンクを開いているか（リンクから会社を決めて比べる） */
export async function tokenTenantId(db: Db, token: string): Promise<string | null> {
  const rec = await findTermsByToken(db, token);
  return rec?.tenantId ?? null;
}

export { isUuid };
