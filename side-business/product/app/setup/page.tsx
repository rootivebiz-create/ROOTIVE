import { count } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthFrame } from "~/components/auth-frame";
import { SetupForm } from "~/components/auth-forms";
import { getDb } from "~/db/client";
import * as s from "~/db/schema";

export const dynamic = "force-dynamic";
export const metadata = { title: "はじめの設定" };

/** 利用者が 1 人もいないときだけ開ける。本番では SETUP_TOKEN（?token=）が要る */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(s.users);
  if (n > 0) redirect("/login");
  const token = (await searchParams).token ?? "";
  return (
    <AuthFrame title="はじめの設定">
      <p className="mb-4 text-sm text-muted-foreground">会社とオーナー（あなた）を登録します。あとから事務の方を招待できます。</p>
      <SetupForm token={token} />
    </AuthFrame>
  );
}
