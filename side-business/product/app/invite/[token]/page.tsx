import { and, eq, gt, isNull } from "drizzle-orm";
import Link from "next/link";
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
        <div className="space-y-3 text-sm">
          <p>このリンクは無効か、期限が切れています（招待のリンクは 7 日、入り直しのリンクは作ったときに決めた時間まで）。一度使ったリンクも、もう使えません。</p>
          <p>リンクを作った方（社内のオーナーなど）に、作り直してもらってください。</p>
          <p>
            <Link href="/login" className="inline-flex min-h-11 items-center font-bold">
              ログインの画面へ
            </Link>
          </p>
        </div>
      )}
    </AuthFrame>
  );
}
