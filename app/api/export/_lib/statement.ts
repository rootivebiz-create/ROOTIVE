/**
 * 個人明細（CSV / PDF）の共通ロード：ロール別の制限を適用する
 * - スタッフ（owner/admin/viewer）：任意のドライバー・任意の月
 * - driver：自分（profile.driver_id）かつ締め済み月のみ。ロイヤリティ率の表示は会社設定に従う
 */
import "server-only";
import type { NextRequest } from "next/server";
import { loadStatementData, type StatementData } from "@/lib/statement";
import { ExportError, driverParam, monthParam, requireExportRole } from "./guard";

export interface StatementExport {
  data: StatementData;
  showRoyaltyRate: boolean;
}

export async function loadStatementForExport(req: NextRequest): Promise<StatementExport> {
  const ctx = await requireExportRole(["owner", "admin", "viewer", "driver"]);
  const month = monthParam(req);
  const driverId = driverParam(req);
  const isDriver = ctx.profile.role === "driver";

  if (isDriver && ctx.profile.driver_id !== driverId) throw new ExportError(403, "自分の明細のみ出力できます。");

  const data = await loadStatementData(ctx.supabase, ctx.company, month, driverId);
  if (!data) throw new ExportError(404, "ドライバーが見つかりません。");
  if (isDriver && !data.isClosed) throw new ExportError(403, "この月はまだ集計中です。締め処理が完了すると出力できます。");

  return { data, showRoyaltyRate: isDriver ? ctx.company.driver_portal_show_royalty : true };
}
