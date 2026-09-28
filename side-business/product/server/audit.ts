import "server-only";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";

/** 操作の記録を 1 行足す（消せない表。失敗しても本来の操作は止めない） */
export async function audit(
  db: Db,
  entry: { tenantId: string; userId?: string | null; action: string; entity: string; entityId?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    await db.insert(s.auditLog).values({
      tenantId: entry.tenantId,
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      detail: entry.detail ?? {},
    });
  } catch (error) {
    console.error("audit failed", error instanceof Error ? error.message : error);
  }
}
