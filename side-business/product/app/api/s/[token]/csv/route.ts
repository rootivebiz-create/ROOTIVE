import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { fileResponse, utf8WithBom } from "~/server/download";
import { LINK_UNUSABLE, annualCsvForToken } from "~/server/features/portal";
import { portalHeaders, portalRequestContext } from "~/server/features/statements/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 今年の支払の一覧（CSV・UTF-8 BOM）。このドライバー・この会社の、締めた月とこの明細だけ。
 * ドライバーはリンクの中の明細から決める（画面から来た値は使わない）。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  try {
    const found = await annualCsvForToken(db, token, await portalRequestContext(db, token));
    if (!found) return portalHeaders(text(LINK_UNUSABLE, 404));
    return portalHeaders(fileResponse(utf8WithBom(found.text), found.fileName, "text/csv; charset=utf-8"));
  } catch (error) {
    if (error instanceof UserError) return portalHeaders(text(error.message, 429));
    throw error;
  }
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
