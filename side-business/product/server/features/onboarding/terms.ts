import "server-only";
import { eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";

/**
 * ドライバーごとに「取引条件を明示した記録があるか」を 1 回の問い合わせで読む（会社で絞る）。
 * 記録は、取引条件の記録（terms_records）か、ドライバーの設定の「明示した日」（drivers.terms_issued_on）のどちらか。
 * 見張り番と同じ見方にする（紙で渡して日付だけ入れている会社もあるため）。
 * ホーム（この月に稼働した人）と最初の設定の案内（有効な人の全員）が使う。
 */
export type DriverTermsFlag = { id: string; name: string; kana: string | null; code: string | null; active: boolean; hasTerms: boolean };

export async function driverTermsFlags(db: Db, tenantId: string): Promise<DriverTermsFlag[]> {
  // 明示書のある人（この会社の記録だけ）を 1 人 1 行にしてから、ドライバーに左からつなぐ
  const recorded = db
    .selectDistinct({ driverId: s.termsRecords.driverId })
    .from(s.termsRecords)
    .where(eq(s.termsRecords.tenantId, tenantId))
    .as("recorded");
  const rows = await db
    .select({
      id: s.drivers.id,
      name: s.drivers.name,
      kana: s.drivers.kana,
      code: s.drivers.code,
      active: s.drivers.active,
      termsIssuedOn: s.drivers.termsIssuedOn,
      recordedId: recorded.driverId,
    })
    .from(s.drivers)
    .leftJoin(recorded, eq(recorded.driverId, s.drivers.id))
    .where(eq(s.drivers.tenantId, tenantId));
  return rows.map((r) => ({ id: r.id, name: r.name, kana: r.kana, code: r.code, active: r.active, hasTerms: !!r.termsIssuedOn || !!r.recordedId }));
}

/** 読みの順（無ければ名前の順）に並べる */
export function byKana<T extends { name: string; kana?: string | null }>(a: T, b: T): number {
  return (a.kana || a.name).normalize("NFKC").localeCompare((b.kana || b.name).normalize("NFKC"), "ja");
}
