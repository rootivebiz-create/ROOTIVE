import { getDb } from "~/db/client";
import { UserError } from "~/server/action";
import { fileResponse } from "~/server/download";
import { TERMS_LINK_UNUSABLE, termsPdfForToken } from "~/server/features/terms/portal";
import { privateLinkHeaders, termsRequestContext } from "~/server/features/terms/request";
import { renderTermsPdf } from "~/server/pdf/terms-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ドライバーの明示書の PDF（ログインなし。リンクの署名・期限・作り直しを確かめる） */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  try {
    const found = await termsPdfForToken(db, token, await termsRequestContext(db, token));
    if (!found) return privateLinkHeaders(text(TERMS_LINK_UNUSABLE, 404));
    const bytes = await renderTermsPdf([{ doc: found.doc, receivedText: found.receivedText }]);
    return privateLinkHeaders(fileResponse(bytes, found.fileName, "application/pdf"));
  } catch (error) {
    if (error instanceof UserError) return privateLinkHeaders(text(error.message, 429));
    throw error;
  }
}

function text(body: string, status: number) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
