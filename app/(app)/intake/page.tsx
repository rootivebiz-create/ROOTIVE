import { canEdit, requireStaff } from "@/lib/auth/session";
import { isMonthClosed, loadImportProfiles, loadImportRuns, loadMasters } from "@/lib/db/queries";
import { monthFromParam } from "@/lib/month";
import { IntakeView } from "@/components/intake/intake-view";
import { toProfileRow, toRunRow } from "@/components/intake/helpers";

export const metadata = { title: "実績ファイルの取り込み" };

/**
 * 元請の実績ファイルの取り込み（/intake）
 * 稼動月 ?m=YYYY-MM の稼働として取り込む。閲覧者は見るだけ。
 */
export default async function IntakePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const { supabase, profile, company } = await requireStaff();

  const [profiles, runs, masters, closed] = await Promise.all([
    loadImportProfiles(supabase, company.id, { activeOnly: true }),
    loadImportRuns(supabase, company.id, 10),
    loadMasters(supabase, company.id),
    isMonthClosed(supabase, company.id, month),
  ]);

  const editable = canEdit(profile.role) && !closed;

  return (
    <IntakeView
      month={month}
      profiles={profiles.map(toProfileRow)}
      runs={runs.map(toRunRow)}
      drivers={masters.drivers.map((d) => ({ id: d.id, name: d.name, isActive: d.is_active }))}
      items={masters.projects.flatMap((p) =>
        p.items.map((i) => ({ id: i.id, name: i.name, projectId: p.id, projectName: p.name, isActive: i.is_active && p.is_active })),
      )}
      editable={editable}
      closed={closed}
    />
  );
}
