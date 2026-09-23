import "server-only";
import { eq, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";

/**
 * 会社をまるごと消す（デモの会社の片付け・解約のあとの削除だけに使う）。
 * 締めた月・操作の記録の守り（DB の引き金）は、このトランザクションの中の、この会社に限って外れる。
 */
export async function purgeTenant(db: Db, tenantId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('shimebi.purge_tenant', ${tenantId}, true)`);
    await tx.delete(s.tenants).where(eq(s.tenants.id, tenantId));
  });
}
