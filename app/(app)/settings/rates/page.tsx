import { Download, FileSpreadsheet } from "lucide-react";
import { requireStaff, canEdit } from "@/lib/auth/session";
import { isMonthClosed, loadMasters, loadRateDiffs } from "@/lib/db/queries";
import { exportUrls } from "@/lib/exports/urls";
import { monthFromParam } from "@/lib/month";
import { uuidSchema } from "@/lib/schemas/common";
import { PageHeader } from "@/components/ui/page-header";
import { buttonVariants } from "@/components/ui/button";
import { RatesEditor } from "@/components/settings/rates/rates-editor";
import { toRateMasters } from "@/components/settings/rates/helpers";
import { checkApprovalRequired } from "@/lib/executive/queries";
import { RequestApprovalDialog } from "@/components/approvals/request-approval-dialog";

export const metadata = { title: "ドライバー別単価" };

/** クエリの id（uuid でなければ null） */
function idParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && uuidSchema.safeParse(s).success ? s : null;
}

export default async function RatesSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const initialDriverId = idParam(sp.driver);
  const initialItemId = idParam(sp.item);
  const { supabase, profile, company } = await requireStaff();

  const [masters, closed] = await Promise.all([loadMasters(supabase, company.id), isMonthClosed(supabase, company.id, month)]);
  const diffs = await loadRateDiffs(supabase, month, { closed });

  // 単価の変更に代表の決裁が要るか（しきい値は DB の approval_rules）。申請できるのは admin 以上
  const editable = canEdit(profile.role);
  const approval = editable ? await checkApprovalRequired(supabase, "rate_change", null) : null;

  return (
    <div>
      <PageHeader
        title="ドライバー別単価"
        description="ドライバー × 案件内容ごとに受注単価・支払単価を設定します。空欄は案件内容の標準単価を使います。"
        actions={
          <>
            <a href={exportUrls.ratesCsv()} download className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Download /> 単価表 CSV
            </a>
            <a href={exportUrls.ratesXlsx()} download className={buttonVariants({ variant: "outline", size: "sm" })}>
              <FileSpreadsheet /> 単価表 Excel
            </a>
          </>
        }
      />
      {approval && (
        <RequestApprovalDialog
          className="mb-4"
          kind="rate_change"
          notice={{ required: approval.required, label: approval.label, dueOn: approval.due_on }}
          description="単価を変えるときは、先に代表へ申請してください。代表の承認後にこの画面で変更して保存できます。"
          defaultTitle="ドライバー別単価の変更"
          refTable="driver_pay_overrides"
          href={`/settings/rates?m=${month}`}
        />
      )}
      <RatesEditor
        masters={toRateMasters(masters)}
        month={month}
        closed={closed}
        canEdit={canEdit(profile.role)}
        diffs={diffs}
        initialView={initialItemId && !initialDriverId ? "item" : "driver"}
        initialDriverId={initialDriverId}
        initialItemId={initialItemId}
      />
    </div>
  );
}
