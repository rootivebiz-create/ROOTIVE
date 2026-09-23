import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { startPageHref, startPageOf } from "@/lib/schemas/office";

// 環境変数未設定時でもビルド時に事前レンダリングされないようにする（常にリクエスト時に判定）
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.profile.role === "driver") redirect("/driver");
  // 最初に開く画面（0026）。事務は登録・編集ができる人だけ（閲覧者はいつもホーム）
  const start = startPageOf(ctx.profile.start_page);
  redirect(start === "office" && (ctx.profile.role === "owner" || ctx.profile.role === "admin") ? startPageHref(start) : "/dashboard");
}
