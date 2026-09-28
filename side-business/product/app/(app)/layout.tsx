import { AppShell } from "~/components/app-shell";
import { requirePageUser } from "~/server/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser("viewer");
  return (
    <AppShell user={user} demo={process.env.DEMO_MODE === "1"}>
      {children}
    </AppShell>
  );
}
