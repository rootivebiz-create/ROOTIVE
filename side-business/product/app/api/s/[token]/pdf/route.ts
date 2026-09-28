import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { fileResponse } from "~/server/download";
import { LINK_UNUSABLE, portalPdfSource } from "~/server/features/portal";
import { portalHeaders, portalRequestContext } from "~/server/features/statements/request";
import { renderStatementsPdf } from "~/server/pdf/statement-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ドライバーの PDF（ログインなし。リンクの署名・期限・作り直しを確かめる） */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  try {
    const found = await portalPdfSource(db, token, await portalRequestContext(db, token));
    if (!found) return portalHeaders(text(LINK_UNUSABLE, 404));
    const bytes = await renderStatementsPdf([found.source]);
    return portalHeaders(fileResponse(bytes, found.fileName, "application/pdf"));
  } catch (error) {
    if (error instanceof UserError) return portalHeaders(text(error.message, 429));
    throw error;
  }
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
