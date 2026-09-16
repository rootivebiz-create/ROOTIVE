import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/session";

export default async function RootPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  redirect(ctx.profile.role === "driver" ? "/driver" : "/dashboard");
}
