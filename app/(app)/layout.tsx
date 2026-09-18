import { AppShell } from "@/components/layout/app-shell";
import type { CommandItem } from "@/components/layout/command-palette";
import { requireStaff } from "@/lib/auth/session";
import { loadMonthList } from "@/lib/db/queries";
import { dateToMonth, formatMonthJa } from "@/lib/month";
import type { Role } from "@/lib/db/types";

/** 設定のサブナビ（サイドナビ・スマホのメニューシート・コマンドパレットで共用） */
const SETTINGS_SUBNAV: { href: string; label: string; keywords?: string[]; ownerOnly?: boolean; adminOnly?: boolean }[] = [
  { href: "/settings/drivers", label: "ドライバー", keywords: ["driver", "どらいばー", "運転手"] },
  { href: "/settings/projects", label: "案件・単価", keywords: ["project", "あんけん", "たんか", "単価"] },
  { href: "/settings/rates", label: "ドライバー別単価", keywords: ["rate", "たんか", "個別単価"] },
  { href: "/settings/clients", label: "取引先", keywords: ["client", "とりひきさき", "顧客", "請求先"] },
  { href: "/settings/expenses", label: "経費カテゴリ", keywords: ["expense", "category", "けいひ", "かてごり", "毎月かかる経費"] },
  { href: "/settings/months", label: "月締め", keywords: ["close", "つきじめ", "締め"] },
  { href: "/settings/company", label: "会社設定", keywords: ["company", "かいしゃ", "消費税", "振込"], ownerOnly: true },
  { href: "/settings/users", label: "ユーザー管理", keywords: ["user", "ゆーざー", "権限", "招待"], ownerOnly: true },
  { href: "/settings/data", label: "データ", keywords: ["data", "csv", "backup", "ばっくあっぷ", "取り込み"] },
  { href: "/settings/audit", label: "監査ログ", keywords: ["audit", "log", "かんさ", "履歴"], adminOnly: true },
  { href: "/settings/account", label: "アカウント", keywords: ["account", "あかうんと", "ぱすわーど"] },
];

/** コマンドパレットの「画面」候補（サイドナビと同じ 8 項目） */
const MAIN_PAGES: { href: string; label: string; keywords: string[] }[] = [
  { href: "/dashboard", label: "ホーム", keywords: ["home", "dashboard", "ほーむ", "だっしゅぼーど", "売上", "利益"] },
  { href: "/entries", label: "稼働", keywords: ["entries", "work", "かどう", "稼働入力"] },
  { href: "/payouts", label: "支払", keywords: ["payout", "しはらい", "支払明細", "振込"] },
  { href: "/invoices", label: "請求", keywords: ["invoice", "せいきゅう", "請求書"] },
  { href: "/expenses", label: "経費", keywords: ["expense", "けいひ", "経費入力"] },
  { href: "/cashflow", label: "資金繰り", keywords: ["cashflow", "しきんぐり", "入金", "残高", "資金"] },
  { href: "/projects", label: "案件", keywords: ["project", "あんけん", "案件別"] },
  { href: "/drivers-pl", label: "ドライバー別の採算", keywords: ["driver", "どらいばー", "採算", "利益", "シミュレーション", "単価"] },
  { href: "/reports", label: "レポート", keywords: ["report", "れぽーと", "年次", "分析"] },
  { href: "/settings", label: "設定", keywords: ["settings", "せってい", "マスタ"] },
];

const visibleForRole = (role: Role, s: { ownerOnly?: boolean; adminOnly?: boolean }) =>
  s.ownerOnly ? role === "owner" : s.adminOnly ? role !== "viewer" : true;

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, company } = await requireStaff();
  const role = profile.role;

  // コマンドパレットの候補（停止中も含める。0009 未適用の環境でもナビを壊さないようエラーは無視する）
  const [months, driversRes, projectsRes, clientsRes] = await Promise.all([
    loadMonthList(supabase, company.id),
    supabase.from("drivers").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("projects").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("clients").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
  ]);

  const settingsItems = SETTINGS_SUBNAV.filter((s) => visibleForRole(role, s));
  const subItems = settingsItems.map(({ href, label }) => ({ href, label }));

  const monthOptions = months.map((m) => ({
    month: dateToMonth(m.month ?? ""),
    status: (m.status ?? "open") as "open" | "closed",
    bill: m.bill,
    entry_count: m.entry_count,
  }));

  const byName = (a: { is_active: boolean }, b: { is_active: boolean }) => Number(b.is_active) - Number(a.is_active);
  const drivers = [...(driversRes.error ? [] : (driversRes.data ?? []))].sort(byName);
  const projects = [...(projectsRes.error ? [] : (projectsRes.data ?? []))].sort(byName);
  const clients = [...(clientsRes.error ? [] : (clientsRes.data ?? []))].sort(byName);

  const commandItems: CommandItem[] = [
    ...MAIN_PAGES.map((p) => ({ id: `page:${p.href}`, group: "page" as const, label: p.label, href: p.href, keywords: p.keywords, hint: "画面" })),
    ...settingsItems.map((s) => ({
      id: `page:${s.href}`,
      group: "page" as const,
      label: `設定 / ${s.label}`,
      href: s.href,
      keywords: [s.label, ...(s.keywords ?? []), "設定"],
      hint: "設定",
    })),
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
    ...monthOptions
      .filter((m) => m.month)
      .map((m) => ({
        id: `month:${m.month}`,
        group: "month" as const,
        label: formatMonthJa(m.month),
        month: m.month,
        keywords: [m.month, formatMonthJa(m.month)],
        hint: m.status === "closed" ? "締め済み" : "未締め",
      })),
  ];

  return (
    <AppShell
      companyName={company.name}
      displayName={profile.display_name}
      email={profile.email}
      role={role}
      months={monthOptions}
      subNav={{ parent: "/settings", items: subItems }}
      commandItems={commandItems}
    >
      {children}
    </AppShell>
  );
}
