import { canEdit, requireStaff } from "@/lib/auth/session";
import { loadDocuments, loadMasters, loadVehicles } from "@/lib/db/queries";
import { fleetTabFromParam } from "@/lib/schemas/fleet";
import { todayJST, toFleetDocument, toFleetVehicle } from "@/lib/fleet/helpers";
import { FleetView } from "@/components/fleet/fleet-view";
import type { FleetChoices } from "@/components/fleet/choices";

export const metadata = { title: "車両と書類" };

/**
 * 車両と書類（/fleet）
 * 稼動月には依存しない（全期間）。?tab=vehicles|documents でタブを切り替える。
 * 期限の判定は日本時間の今日を基準に lib/fleet/helpers で計算し直す（DB ビューと同じルール）。
 */
export default async function FleetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = fleetTabFromParam(sp.tab);
  const { supabase, profile, company } = await requireStaff();
  const editable = canEdit(profile.role);
  const today = todayJST();

  const [vehicleRows, documentRows, masters] = await Promise.all([
    loadVehicles(supabase, company.id),
    // 停止中の書類も一覧には出す（件数・案内は画面側で稼働中だけを数える）
    loadDocuments(supabase, company.id, { activeOnly: false }),
    // ダイアログの選択肢は編集できるときだけ読み込む（停止中も含めて読み、選択肢は画面側で絞る）
    editable ? loadMasters(supabase, company.id) : null,
  ]);

  const vehicles = vehicleRows.map((v) => toFleetVehicle(v, today));
  const documents = documentRows.map((d) => toFleetDocument(d, today));
  const choices: FleetChoices | null = masters
    ? {
        drivers: masters.drivers.map((d) => ({ id: d.id, name: d.name, is_active: d.is_active })),
        vehicles: vehicles.map((v) => ({ id: v.id, name: v.plate, is_active: v.isActive })),
      }
    : null;

  return <FleetView tab={tab} vehicles={vehicles} documents={documents} today={today} editable={editable} choices={choices} />;
}
