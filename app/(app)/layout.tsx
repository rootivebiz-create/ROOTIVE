import { AppShell } from "@/components/layout/app-shell";
import type { CommandItem } from "@/components/layout/command-palette";
import { requireStaff } from "@/lib/auth/session";
import { loadChatUnreadTotal, loadMonthList } from "@/lib/db/queries";
import { loadPendingApprovalCount } from "@/lib/executive/queries";
import { dateToMonth, formatMonthJa } from "@/lib/month";
import { visibleForRole, type RoleVisibility } from "@/lib/nav/visibility";

/** 設定のサブナビ（サイドナビ・スマホのメニューシート・コマンドパレットで共用） */
const SETTINGS_SUBNAV: ({ href: string; label: string; keywords?: string[] } & RoleVisibility)[] = [
  { href: "/settings/drivers", label: "ドライバー", keywords: ["driver", "どらいばー", "運転手"] },
  { href: "/settings/projects", label: "案件・単価", keywords: ["project", "あんけん", "たんか", "単価"] },
  { href: "/settings/rates", label: "ドライバー別単価", keywords: ["rate", "たんか", "個別単価"] },
  { href: "/settings/clients", label: "取引先", keywords: ["client", "とりひきさき", "顧客", "請求先"] },
  { href: "/settings/expenses", label: "経費カテゴリ", keywords: ["expense", "category", "けいひ", "かてごり", "毎月かかる経費"] },
  { href: "/settings/months", label: "月締め", keywords: ["close", "つきじめ", "締め"] },
  { href: "/settings/safety", label: "安全管理", keywords: ["safety", "あんぜん", "安全管理者", "指導", "事故", "点呼"], adminOnly: true },
  { href: "/settings/integrations", label: "外部連携", keywords: ["line", "らいん", "google", "drive", "ばっくあっぷ", "ai", "連携"], adminOnly: true },
  { href: "/settings/company", label: "会社設定", keywords: ["company", "かいしゃ", "消費税", "振込"], ownerOnly: true },
  { href: "/settings/users", label: "ユーザー管理", keywords: ["user", "ゆーざー", "権限", "招待"], ownerOnly: true },
  { href: "/settings/data", label: "データ", keywords: ["data", "csv", "backup", "ばっくあっぷ", "取り込み"] },
  { href: "/settings/audit", label: "監査ログ", keywords: ["audit", "log", "かんさ", "履歴"], adminOnly: true },
  { href: "/settings/account", label: "アカウント", keywords: ["account", "あかうんと", "ぱすわーど"] },
];

/** コマンドパレットの「画面」候補（サイドナビと同じ項目 ＋ 一覧に出さない画面。出し分けは visibleForRole） */
const MAIN_PAGES: ({ href: string; label: string; keywords: string[] } & RoleVisibility)[] = [
  { href: "/executive", label: "代表", keywords: ["executive", "だいひょう", "代表", "経営", "owner", "オーナー"], ownerOnly: true },
  { href: "/executive/approvals", label: "決裁（承認）", keywords: ["approval", "けっさい", "決裁", "承認", "申請", "稟議"], ownerOnly: true },
  { href: "/executive/decisions", label: "意思決定ログ", keywords: ["decision", "いしけってい", "意思決定", "判断", "振り返り", "見直し"], ownerOnly: true },
  { href: "/executive/company", label: "会社の台帳（登記・役員・株主・保険）", keywords: ["company", "とうき", "登記", "やくいん", "役員", "かぶぬし", "株主", "ほけん", "保険", "顧問", "保証"], ownerOnly: true },
  { href: "/executive/plan", label: "中期計画", keywords: ["plan", "ちゅうきけいかく", "中期", "計画", "3 か年", "目標"], ownerOnly: true },
  { href: "/executive/rules", label: "決裁のルールと委任", keywords: ["rule", "delegation", "るーる", "ルール", "いにん", "委任", "代理", "しきい値"], ownerOnly: true },
  { href: "/executive/security", label: "ログインと持ち出しの記録", keywords: ["security", "login", "ろぐいん", "ログイン", "もちだし", "持ち出し", "出力", "きろく", "記録"], ownerOnly: true },
  { href: "/dashboard", label: "ホーム", keywords: ["home", "dashboard", "ほーむ", "だっしゅぼーど", "売上", "利益"] },
  { href: "/entries", label: "稼働", keywords: ["entries", "work", "かどう", "稼働入力"] },
  { href: "/daily", label: "日報・点呼", keywords: ["daily", "にっぽう", "てんこ", "点呼", "アルコール", "業務記録", "承認"] },
  { href: "/daily?tab=labor", label: "労務（拘束時間・休息）", keywords: ["labor", "ろうむ", "こうそく", "拘束", "休息", "残業", "連続勤務", "長時間", "2024"] },
  { href: "/intake", label: "取り込み", keywords: ["intake", "import", "とりこみ", "元請", "実績", "excel", "csv"] },
  { href: "/payouts", label: "支払", keywords: ["payout", "しはらい", "支払明細", "振込"] },
  { href: "/invoices", label: "請求", keywords: ["invoice", "せいきゅう", "請求書"] },
  { href: "/invoices/notices", label: "支払通知の突合", keywords: ["notice", "しはらいつうち", "支払明細", "とつごう", "突合", "差額", "元請", "請求漏れ"] },
  { href: "/expenses", label: "経費", keywords: ["expense", "けいひ", "経費入力"] },
  { href: "/bank", label: "入金の消込", keywords: ["bank", "ぎんこう", "csv", "にゅうきん", "消込", "口座"] },
  { href: "/cashflow", label: "資金繰り", keywords: ["cashflow", "しきんぐり", "入金", "残高", "資金"] },
  { href: "/projects", label: "案件", keywords: ["project", "あんけん", "案件別"] },
  { href: "/projects?tab=quote", label: "見積の採算シミュレーション", keywords: ["quote", "みつもり", "見積", "単価交渉", "採算", "赤字", "損益分岐"] },
  { href: "/drivers-pl", label: "ドライバー別の採算", keywords: ["driver", "どらいばー", "採算", "利益", "シミュレーション", "単価"] },
  { href: "/ai?tab=draft", label: "AI で文章を作る", keywords: ["draft", "ぶんしょう", "案内", "督促", "お知らせ", "作文"] },
  { href: "/finance", label: "財務（予算・借入・税務）", keywords: ["finance", "ざいむ", "よさん", "予算", "予実", "かりいれ", "借入", "返済", "ぜいむ", "税務", "決算", "しんこく"] },
  { href: "/records", label: "書類の検索（電子帳簿保存法）", keywords: ["records", "しょるい", "書類", "けんさく", "検索", "領収書", "レシート", "電子帳簿", "保存", "索引"] },
  { href: "/exports", label: "出力（Excel・振込・月次パック）", keywords: ["export", "しゅつりょく", "excel", "えくせる", "csv", "振込", "ふりこみ", "全銀", "zip", "ぱっく", "pdf"] },
  { href: "/reports", label: "レポート", keywords: ["report", "れぽーと", "年次", "分析"] },
  { href: "/alerts", label: "気になること", keywords: ["alert", "あらーと", "異常", "警告", "けんさ", "注意"] },
  { href: "/fleet", label: "車両と書類", keywords: ["fleet", "vehicle", "しゃりょう", "車検", "保険", "免許", "期限", "しょるい"] },
  { href: "/hr", label: "採用と契約", keywords: ["hr", "さいよう", "応募", "面談", "けいやく", "契約"] },
  { href: "/ai", label: "AI 相談", keywords: ["ai", "えーあい", "そうだん", "分析", "改善", "claude", "ちゃっと"] },
  { href: "/ai?tab=weekly", label: "週次サマリー", keywords: ["weekly", "しゅうじ", "週次", "先週", "サマリー", "line"] },
  { href: "/chat", label: "チャット", keywords: ["chat", "ちゃっと", "社内", "連絡", "めっせーじ"] },
  { href: "/settings", label: "設定", keywords: ["settings", "せってい", "マスタ"] },
];

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, profile, company } = await requireStaff();
  const role = profile.role;

  // コマンドパレットの候補（停止中も含める。0009 未適用の環境でもナビを壊さないようエラーは無視する）
  const [months, driversRes, projectsRes, clientsRes, unread, alertsRes] = await Promise.all([
    loadMonthList(supabase, company.id),
    supabase.from("drivers").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("projects").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
    supabase.from("clients").select("id, name, is_active").eq("company_id", company.id).order("sort_order").order("name"),
    loadChatUnreadTotal(supabase),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("status", "open"),
  ]);

  const settingsItems = visibleForRole(SETTINGS_SUBNAV, role);
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
    ...visibleForRole(MAIN_PAGES, role).map((p) => ({ id: `page:${p.href}`, group: "page" as const, label: p.label, href: p.href, keywords: p.keywords, hint: "画面" })),
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

  // 決裁待ちの件数は代表だけ（ナビの「代表」とヘッダーのベルで使う。0019・0020 未適用の環境では 0）
  const pendingApprovals = role === "owner" ? await loadPendingApprovalCount(supabase, company.id).catch(() => 0) : 0;

  // ナビのバッジ（0011 未適用の環境でも壊さないようエラーは 0 として扱う）
  const badges: Record<string, number> = {
    "/chat": unread,
    "/alerts": alertsRes.error ? 0 : (alertsRes.count ?? 0),
    "/executive": pendingApprovals,
  };

  return (
    <AppShell
      companyName={company.name}
      displayName={profile.display_name}
      email={profile.email}
      role={role}
      months={monthOptions}
      subNav={{ parent: "/settings", items: subItems }}
      commandItems={commandItems}
      badges={badges}
    >
      {children}
    </AppShell>
  );
}
