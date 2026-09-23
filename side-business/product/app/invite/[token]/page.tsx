import { and, eq, gt, isNull } from "drizzle-orm";
import { AuthFrame } from "~/components/auth-frame";
import { InviteForm } from "~/components/auth-forms";
import { getDb } from "~/db/client";
import * as s from "~/db/schema";
import { sha256 } from "~/server/tokens";

export const dynamic = "force-dynamic";
export const metadata = { title: "招待" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = await getDb();
  const rows = await db
    .select()
    .from(s.invites)
    .where(and(eq(s.invites.tokenHash, sha256(token)), isNull(s.invites.usedAt), gt(s.invites.expiresAt, new Date())))
    .limit(1);
  const invite = rows[0];
  return (
    <AuthFrame title="しめ日ラボへようこそ">
      {invite ? (
        <InviteForm token={token} email={invite.email} />
      ) : (
        <p className="text-sm">この招待リンクは無効か、期限（7 日）が切れています。招待した方に作り直してもらってください。</p>
      )}
    </AuthFrame>
  );
}
