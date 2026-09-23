import { AppShell } from "~/components/app-shell";
import { getDb } from "~/db/client";
import { ensureDemoSeeded } from "~/server/seed-demo";
import { requirePageUser } from "~/server/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (process.env.DEMO_MODE === "1") await ensureDemoSeeded(await getDb());
  const user = await requirePageUser("viewer");
  return (
    <AppShell user={user} demo={process.env.DEMO_MODE === "1"}>
      {children}
    </AppShell>
  );
}
