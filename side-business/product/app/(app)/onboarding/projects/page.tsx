import { eq } from "drizzle-orm";
import Link from "next/link";
import { Card } from "@/components/ui";
import { ProjectsForm } from "~/components/onboarding/projects-form";
import { NextStepLink, StepHeader } from "~/components/onboarding/step-header";
import { getDb } from "~/db/client";
import * as s from "~/db/schema";
import { requirePageUser } from "~/server/auth";
import { loadOnboarding } from "~/server/features/onboarding";

export const metadata = { title: "最初の設定：元請と案件" };

/** ③ 元請と案件：表に書くように入れる。すでにある元請には名前で当てる */
export default async function OnboardingProjectsPage() {
  const user = await requirePageUser("staff");
  const db = await getDb();
  const [clients, projects, progress] = await Promise.all([
    db.select({ id: s.clients.id, name: s.clients.name }).from(s.clients).where(eq(s.clients.tenantId, user.tenantId)),
    db
      .select({ name: s.projects.name, clientId: s.projects.clientId, unit: s.projects.unit, billRate: s.projects.billRate, payRate: s.projects.payRate })
      .from(s.projects)
      .where(eq(s.projects.tenantId, user.tenantId)),
    loadOnboarding(db, user.tenantId),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const groups = new Map<string, typeof projects>();
  for (const p of projects) {
    const key = p.clientId ? clientName.get(p.clientId) ?? "（元請なし）" : "（元請なし）";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <StepHeader
        step="projects"
        state={progress.steps.find((x) => x.def.key === "projects")?.state}
        description={
          <>
            元請（荷主）ごとの仕事の種類と、標準の単価です。受注単価は利益と元請との突合に、支払単価は明細に使います（どちらも税抜）。
            元請の名前は「株式会社」や全角・半角の違いがあっても、すでにある元請に当てます。
          </>
        }
      />
      {projects.length > 0 && (
        <Card className="mb-4">
          <p className="text-sm font-bold">登録済みの案件（{projects.length} 件）</p>
          <ul className="mt-2 space-y-1 text-sm">
            {[...groups.entries()].map(([client, list]) => (
              <li key={client}>
                <span className="font-bold">{client}</span>：
                {list.map((p) => `${p.name}（${p.unit}・受注 ${p.billRate.toLocaleString("ja-JP")}円／支払 ${p.payRate.toLocaleString("ja-JP")}円）`).join("、")}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ProjectsForm clients={clients.map((c) => c.name)} />
      <div className="mt-8 space-y-2 text-sm text-muted-foreground">
        <p>
          あとで単価を変えるときや、ドライバーごとの単価は、メニューの <Link href="/settings/projects">設定 → 案件</Link> から入れられます。
        </p>
        <NextStepLink step="projects" />
      </div>
    </div>
  );
}
