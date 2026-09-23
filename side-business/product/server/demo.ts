import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { purgeTenant } from "~/server/purge";
import { seedDemo } from "~/server/seed-demo";

/**
 * デモ（DEMO_MODE=1）：来た人ごとに、架空の会社を 1 つ作って渡す。
 * ほかの人の操作は見えない。作ってから 24 時間で消える（毎日もとに戻る）。
 */
export const DEMO_TTL_HOURS = 24;
/** 同時に置いておけるデモの会社の数（超えたら「混み合っています」。使っている途中の人のデモは消さない） */
export const MAX_DEMO_TENANTS = 300;
/** 10 分間に作れるデモの会社の数（全部のサーバーで数える。回数の制限 tooMany はサーバー 1 台の中だけなので、DB で数える） */
export const MAX_DEMO_STARTS_PER_10_MIN = 60;
/** デモの DB の大きさの上限（無料の小さな Postgres をいっぱいにしない。DEMO_DB_LIMIT_MB で変えられる） */
export function demoDbLimitBytes(): number {
  const mb = Number(process.env.DEMO_DB_LIMIT_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 400) * 1024 * 1024;
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

/** デモに入ったあとに開く画面（同じサイトの中のパスだけ。それ以外はホーム） */
export function safeDemoNext(next: string | null | undefined): string {
  const v = (next ?? "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.startsWith("/demo/start")) return "/";
  return v.slice(0, 500);
}

/** デモが混み合っていて、新しいデモの会社を作れない（画面に「少し時間をおいて」と出す） */
export class DemoBusyError extends Error {}

const isDemoTenant = sql`(${s.tenants.settings} ->> 'demo') = 'true'`;

/** 24 時間を過ぎたデモの会社を片付ける（期限の前のものは、数が多くても消さない） */
export async function cleanupDemoTenants(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - DEMO_TTL_HOURS * 3600 * 1000);
  const expired = await db.select({ id: s.tenants.id }).from(s.tenants).where(and(isDemoTenant, lt(s.tenants.createdAt, cutoff)));
  for (const t of expired) await purgeTenant(db, t.id);
  return expired.length;
}

/**
 * 新しいデモの会社を作ってよいか。だめなら理由（画面に出す文）を返す。
 * 数が多い・短い間にたくさん作られた・DB が大きい、のどれかなら作らない（古いデモを押しのけない）
 */
export async function demoBusyReason(db: Db, now = new Date(), limitBytes = demoDbLimitBytes()): Promise<string | null> {
  const busy = "いまデモが混み合っています。少し時間をおいてから、もう一度お試しください。";
  const [{ live }] = await db.select({ live: sql<number>`count(*)::int` }).from(s.tenants).where(isDemoTenant);
  if (Number(live) >= MAX_DEMO_TENANTS) return busy;
  const since = new Date(now.getTime() - 10 * 60_000);
  const [{ recent }] = await db
    .select({ recent: sql<number>`count(*)::int` })
    .from(s.tenants)
    .where(and(isDemoTenant, gte(s.tenants.createdAt, since)));
  if (Number(recent) >= MAX_DEMO_STARTS_PER_10_MIN) return busy;
  try {
    // 会社が 1 つも無ければ行が返らない（そのときは大きさを気にしなくてよい）
    const [row] = await db.select({ size: sql<string>`pg_database_size(current_database())::text` }).from(s.tenants).limit(1);
    if (Number(row?.size ?? 0) > limitBytes) return busy;
  } catch {
    // 大きさを読めない DB（権限など）では、数だけで決める
  }
  return null;
}

/** 新しいデモの会社を作り、オーナーの利用者を返す */
export async function startDemoTenant(db: Db, now = new Date()): Promise<{ tenantId: string; userId: string }> {
  await cleanupDemoTenants(db, now);
  const busy = await demoBusyReason(db, now);
  if (busy) throw new DemoBusyError(busy);
  const { tenantId } = await seedDemo(db);
  await db
    .update(s.tenants)
    .set({ settings: sql`${s.tenants.settings} || '{"demo": true}'::jsonb` })
    .where(eq(s.tenants.id, tenantId));
  const [owner] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")))
    .limit(1);
  return { tenantId, userId: owner.id };
}
