import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";
import { staffHome } from "@/lib/auth/access";
import { startPageOf } from "@/lib/schemas/office";

// 環境変数未設定時でもビルド時に事前レンダリングされないようにする（常にリクエスト時に判定）
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  // ドライバーはポータル、事務員（0027）はいつも事務。経営の数字を見せない設定の人（0029）はホームへ行かない。
  // それ以外は最初に開く画面（0026）。事務は登録・編集ができる人だけ
  redirect(staffHome(ctx.profile.role, ctx.access, startPageOf(ctx.profile.start_page)));
}
