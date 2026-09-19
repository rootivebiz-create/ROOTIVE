import { headers } from "next/headers";
import { isOwner, requirePageRole } from "@/lib/auth/session";
import { loadIntegrationLogs, loadIntegrations } from "@/lib/db/queries";
import { hasServiceRoleKey } from "@/lib/supabase/admin";
import { loadSecrets, maskSecrets } from "@/lib/integrations/secrets";
import { appUrl } from "@/lib/env";
import {
  DRIVE_SECRET_KEYS,
  LINE_SECRET_KEYS,
  LINE_WEBHOOK_PATH,
  findIntegration,
  parseDriveConfig,
  parseLineConfig,
  toIntegrationView,
  type DriveSecretsMask,
  type LineSecretsMask,
  type LinkedPerson,
} from "@/lib/integrations/types";
import { PageHeader } from "@/components/ui/page-header";
import { LineCard } from "@/components/integrations/line-card";
import { DriveCard } from "@/components/integrations/drive-card";
import { LogsCard } from "@/components/integrations/logs-card";

export const metadata = { title: "外部連携" };

const EMPTY_LINE_MASK: LineSecretsMask = { channelAccessToken: "", channelSecret: "" };
const EMPTY_DRIVE_MASK: DriveSecretsMask = { clientId: "", clientSecret: "", refreshToken: "", folderId: "" };

/** 実際にアクセスされているホストから Webhook URL を組み立てる（取れなければ NEXT_PUBLIC_APP_URL） */
async function baseUrl(): Promise<string> {
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host")?.trim();
    if (host) return `${proto || "https"}://${host}`;
  } catch {
    // ヘッダが取れない場合は環境変数へ
  }
  return appUrl();
}

export default async function IntegrationsSettingsPage() {
  const { supabase, company, profile } = await requirePageRole(["owner", "admin"]);
  const canEdit = isOwner(profile.role);
  const secretsAvailable = hasServiceRoleKey();

  const [integrations, logs, driversRes, staffRes, base] = await Promise.all([
    loadIntegrations(supabase, company.id),
    loadIntegrationLogs(supabase, company.id, 20),
    supabase.from("drivers").select("*").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("profiles").select("id, display_name, email, role, line_user_id, line_linked_at").eq("company_id", company.id),
    baseUrl(),
  ]);
  if (driversRes.error) throw driversRes.error;
  if (staffRes.error) throw staffRes.error;

  let lineMask = EMPTY_LINE_MASK;
  let driveMask = EMPTY_DRIVE_MASK;
  if (secretsAvailable) {
    try {
      const [lineSecrets, driveSecrets] = await Promise.all([loadSecrets(company.id, "line"), loadSecrets(company.id, "google_drive")]);
      lineMask = maskSecrets(lineSecrets, LINE_SECRET_KEYS);
      driveMask = maskSecrets(driveSecrets, DRIVE_SECRET_KEYS);
    } catch {
      // 機密が読めなくても画面は表示する（保存時にエラーを出す）
    }
  }

  const lineRow = findIntegration(integrations, "line");
  const driveRow = findIntegration(integrations, "google_drive");

  // 連携済みの人（LINE のユーザー ID は画面へ渡さない）
  const people: LinkedPerson[] = [
    ...(driversRes.data ?? [])
      .filter((d) => (d.line_user_id ?? "").trim().length > 0)
      .map((d) => ({ id: d.id, kind: "driver" as const, name: d.name, linkedAt: d.line_linked_at, canUnlink: true })),
    ...(staffRes.data ?? [])
      .filter((s) => s.role !== "driver" && (s.line_user_id ?? "").trim().length > 0)
      .map((s) => ({
        id: s.id,
        kind: "staff" as const,
        name: s.display_name || s.email,
        linkedAt: s.line_linked_at,
        // スタッフの連携解除は本人のみ（RPC line_unlink の仕様に合わせる）
        canUnlink: s.id === profile.id,
      })),
  ];

  return (
    <div>
      <PageHeader
        title="外部連携"
        description="LINE 公式アカウントでの連絡と、Google ドライブへのバックアップ保存。設定の変更はオーナーのみ行えます。"
      />
      <div className="space-y-4">
        <LineCard
          canEdit={canEdit}
          status={toIntegrationView("line", lineRow)}
          config={parseLineConfig(lineRow?.config)}
          mask={lineMask}
          webhookUrl={`${base}${LINE_WEBHOOK_PATH}`}
          people={people}
          secretsAvailable={secretsAvailable}
        />
        <DriveCard
          canEdit={canEdit}
          status={toIntegrationView("google_drive", driveRow)}
          config={parseDriveConfig(driveRow?.config)}
          mask={driveMask}
          secretsAvailable={secretsAvailable}
        />
        <LogsCard rows={logs} />
      </div>
    </div>
  );
}
