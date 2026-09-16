import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";

// 環境変数未設定時でもビルド時に事前レンダリングされないようにする（常にリクエスト時に判定）
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  redirect(ctx.profile.role === "driver" ? "/driver" : "/dashboard");
}
