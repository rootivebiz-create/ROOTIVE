/**
 * GET /api/command-items — コマンドパレット（⌘K）の候補のうち、ドライバー・案件・取引先。
 *
 * これらは画面を 1 つ開くたびに読む必要が無い（⌘K を開いたときだけ要る）。
 * レイアウトから外して、**最初に ⌘K を開いた 1 回だけ**ここへ取りに来る。
 */
import { NextResponse } from "next/server";
import { getSessionContext, STAFF_ROLES } from "@/lib/auth/session";
import type { CommandItem } from "@/components/layout/command-palette";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx || !STAFF_ROLES.includes(ctx.profile.role)) {
    return NextResponse.json({ items: [] }, { status: 403 });
  }
  const { supabase, company } = ctx;
  const [driversRes, projectsRes, clientsRes] = await Promise.all([
    supabase.from("drivers").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("projects").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("clients").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
  ]);

  const byActive = (a: { is_active: boolean }, b: { is_active: boolean }) => Number(b.is_active) - Number(a.is_active);
  const drivers = [...(driversRes.error ? [] : (driversRes.data ?? []))].sort(byActive);
  const projects = [...(projectsRes.error ? [] : (projectsRes.data ?? []))].sort(byActive);
  const clients = [...(clientsRes.error ? [] : (clientsRes.data ?? []))].sort(byActive);

  const items: CommandItem[] = [
    ...drivers.map((d) => ({
      id: `driver:${d.id}`,
      group: "driver" as const,
      label: d.name,
      href: `/payouts/${d.id}/statement`,
      keywords: [d.name],
      hint: "支払明細",
      inactive: !d.is_active,
    })),
    ...drivers.map((d) => ({
      id: `driver-settings:${d.id}`,
      group: "driver" as const,
      label: `${d.name}（設定）`,
      href: `/settings/drivers/${d.id}`,
      keywords: [d.name, "設定", "単価", "ロイヤリティ"],
      hint: "ドライバー設定",
      inactive: !d.is_active,
    })),
    ...projects.map((p) => ({
      id: `project:${p.id}`,
      group: "project" as const,
      label: p.name,
      href: `/settings/projects/${p.id}`,
      keywords: [p.name, "案件", "単価"],
      hint: "案件・単価",
      inactive: !p.is_active,
    })),
    ...clients.map((c) => ({
      id: `client:${c.id}`,
      group: "client" as const,
      label: c.name,
      href: "/settings/clients",
      keywords: [c.name, "取引先", "請求先"],
      hint: "取引先",
      inactive: !c.is_active,
    })),
  ];

  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=60" } });
}
