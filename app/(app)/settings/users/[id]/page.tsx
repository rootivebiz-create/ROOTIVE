import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePageRole } from "@/lib/auth/session";
import { toAccessOverrides } from "@/lib/auth/access";
import { ROLE_LABELS, toConfidentialScope } from "@/lib/db/types";
import { uuidSchema } from "@/lib/schemas/common";
import { startPageOf } from "@/lib/schemas/office";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { deviceText } from "@/components/executive/helpers";
import { UserDetail, type UserDetailData, type UserLoginRow } from "@/components/settings/users/user-detail";
import type { DriverOption } from "@/components/settings/users/invite-dialog";

export const metadata = { title: "ユーザーの設定" };

/**
 * ユーザー 1 人の設定（代表のみ）。基本・ロール・見せる範囲（0029）・状態・代表を譲る・最近のログイン。
 * 書き込みはすべて Server Action（requireOwnerAction）→ DB（RLS・protect_profile_columns・transfer_ownership）でも拒否する
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase, company, user: me } = await requirePageRole(["owner"]);

  const [profileRes, driversRes, loginsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).eq("company_id", company.id).maybeSingle(),
    supabase.from("drivers").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("login_events").select("id, at, kind, user_agent, ip").eq("company_id", company.id).eq("profile_id", id).order("at", { ascending: false }).limit(10),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (!profileRes.data) notFound();
  if (driversRes.error) throw driversRes.error;
  const p = profileRes.data;

  // 最終ログイン日時は auth 側にしかないため、サービスロールで 1 人ぶんだけ読む（キーが無い環境では出さない）
  let lastSignInAt: string | null = null;
  let lastSignInAvailable = false;
  if (hasServiceRoleKey()) {
    try {
      const { data, error } = await createAdminClient().auth.admin.getUserById(id);
      if (!error) {
        lastSignInAvailable = true;
        lastSignInAt = data.user?.last_sign_in_at ?? null;
      }
    } catch {
      /* 取れなくても画面は出す */
    }
  }

  const drivers: DriverOption[] = (driversRes.data ?? []).map((d) => ({ id: d.id, name: d.name, isActive: d.is_active }));
  const driverName = p.driver_id ? (drivers.find((d) => d.id === p.driver_id)?.name ?? null) : null;

  const data: UserDetailData = {
    id: p.id,
    email: p.email,
    displayName: p.display_name,
    role: p.role,
    driverId: p.driver_id,
    driverName,
    isActive: p.is_active,
    startPage: startPageOf(p.start_page),
    lastSignInAt,
    createdAt: p.created_at,
    overrides: toAccessOverrides(p.access_overrides),
  };
  const logins: UserLoginRow[] = (loginsRes.data ?? []).map((l) => ({ id: l.id, at: l.at, kind: l.kind, device: deviceText(l.user_agent), ip: l.ip }));
  const self = p.id === me.id;

  return (
    <div>
      <Link href="/settings/users" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        ユーザー管理
      </Link>
      <PageHeader
        title={p.display_name || p.email}
        description={`${p.email}${self ? "（自分）" : ""}${p.role === "driver" && driverName ? `・ドライバー「${driverName}」` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={p.role === "owner" ? "default" : p.role === "admin" ? "success" : p.role === "driver" ? "outline" : "secondary"}>{ROLE_LABELS[p.role]}</Badge>
            {p.is_active ? <Badge variant="success">有効</Badge> : <Badge variant="destructive">無効</Badge>}
          </div>
        }
      />
      <UserDetail
        user={data}
        self={self}
        drivers={drivers}
        scope={toConfidentialScope(company.confidential_scope)}
        lastSignInAvailable={lastSignInAvailable}
        logins={logins}
        loginsAvailable={!loginsRes.error}
      />
    </div>
  );
}
