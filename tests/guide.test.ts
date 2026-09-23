import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DRIVER_NAV, MAIN_NAV } from "@/components/layout/nav";
import { faqForRole, guideForPath, guidesForRole, normalizePath, roleNoteFor, sectionsForRole } from "@/lib/guide/match";
import { DRIVER_FAQ, DRIVER_OVERVIEW, STAFF_FAQ, STAFF_OVERVIEW } from "@/lib/guide/overview";
import { PAGE_GUIDES } from "@/lib/guide/pages";

/** app/<dir> の page.tsx をパスにする（(app) などのグループは外す） */
function pagePaths(dir: string): string[] {
  const root = path.resolve(__dirname, "..", "app");
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "page.tsx") {
        const rel = path.relative(root, path.dirname(full)).split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
        out.push(`/${rel.join("/")}`.replace(/\/$/, "") || "/");
      }
    }
  };
  walk(path.join(root, dir));
  // 動的な部分（[id] など）は適当な値に置き換える
  return out.map((p) => p.replace(/\[[^\]]+\]/g, "x"));
}

describe("すべての画面にガイドがある", () => {
  it("スタッフの画面（オーナーで見て）", () => {
    const missing = pagePaths("(app)").filter((p) => !guideForPath(PAGE_GUIDES, p, "owner"));
    expect(missing).toEqual([]);
  });

  it("ドライバーの画面", () => {
    const missing = pagePaths("driver").filter((p) => !guideForPath(PAGE_GUIDES, p, "driver"));
    expect(missing).toEqual([]);
  });

  it("ナビの項目はすべて、その画面そのもののガイドがあり、出し分けもナビと同じ", () => {
    for (const item of MAIN_NAV) {
      const g = PAGE_GUIDES.find((x) => x.href === item.href);
      expect(g, item.href).toBeTruthy();
      expect(Boolean(g?.ownerOnly), `${item.href} ownerOnly`).toBe(Boolean(item.ownerOnly));
      expect(Boolean(g?.adminOnly), `${item.href} adminOnly`).toBe(Boolean(item.adminOnly));
      expect(Boolean(g?.management), `${item.href} management`).toBe(Boolean(item.management));
    }
    for (const item of DRIVER_NAV) expect(PAGE_GUIDES.find((x) => x.href === item.href && x.driver), item.href).toBeTruthy();
  });

  it("名前（slug）とパスは重ならない", () => {
    const slugs = PAGE_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const hrefs = PAGE_GUIDES.map((g) => g.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it("どのガイドにも目的と 1 つ以上の手順があり、文章は日本語", () => {
    for (const g of PAGE_GUIDES) {
      expect(g.purpose.length, g.href).toBeGreaterThan(10);
      expect(g.steps.length, g.href).toBeGreaterThan(0);
      expect(g.purpose).toMatch(/[ぁ-んァ-ン一-龥]/);
    }
  });
});

describe("guideForPath", () => {
  it("いちばん長く当たるものを選び、?m や # は無視する", () => {
    expect(guideForPath(PAGE_GUIDES, "/payouts/transfer?m=2026-08", "owner")?.slug).toBe("transfer");
    expect(guideForPath(PAGE_GUIDES, "/payouts/abc/statement", "owner")?.slug).toBe("payouts");
    expect(guideForPath(PAGE_GUIDES, "/invoices/notices/1", "owner")?.slug).toBe("notices");
    expect(guideForPath(PAGE_GUIDES, "/settings/drivers/new", "owner")?.slug).toBe("settings-drivers");
    expect(guideForPath(PAGE_GUIDES, "/office#closing", "admin")?.slug).toBe("office");
    // "/payoutsx" は "/payouts" に当たらない
    expect(guideForPath(PAGE_GUIDES, "/payoutsx", "owner")).toBeNull();
    expect(normalizePath("/entries/?m=2026-08")).toBe("/entries");
  });

  it("見られない画面のガイドは出さない", () => {
    expect(guideForPath(PAGE_GUIDES, "/office", "viewer")).toBeNull();
    expect(guideForPath(PAGE_GUIDES, "/dashboard", "clerk")).toBeNull();
    expect(guideForPath(PAGE_GUIDES, "/executive", "admin")).toBeNull();
    // 見られない設定の画面は、親の「設定」のガイドに倒れる（その画面のガイドは出さない）
    expect(guideForPath(PAGE_GUIDES, "/settings/audit", "clerk")?.slug).toBe("settings");
    expect(guideForPath(PAGE_GUIDES, "/settings/company", "admin")?.slug).toBe("settings");
    // ドライバーはポータルのガイドだけ
    expect(guideForPath(PAGE_GUIDES, "/entries", "driver")).toBeNull();
    expect(guideForPath(PAGE_GUIDES, "/driver/today", "driver")?.slug).toBe("driver-today");
    expect(guideForPath(PAGE_GUIDES, "/driver/statements/2026-08", "driver")?.slug).toBe("driver-statements");
    expect(guideForPath(PAGE_GUIDES, "/driver/today", "owner")).toBeNull();
  });

  it("事務員の一覧に経営の画面は入らず、事務は入る", () => {
    const hrefs = guidesForRole(PAGE_GUIDES, "clerk").map((g) => g.href);
    for (const h of ["/dashboard", "/cashflow", "/projects", "/finance", "/reports", "/ai", "/executive", "/settings/audit", "/settings/integrations"]) expect(hrefs).not.toContain(h);
    for (const h of ["/office", "/entries", "/payouts", "/invoices", "/settings/months"]) expect(hrefs).toContain(h);
  });

  it("ロールごとの注意はその人にだけ出す", () => {
    const entries = PAGE_GUIDES.find((g) => g.href === "/entries")!;
    expect(roleNoteFor(entries, "clerk")).toContain("事務員");
    expect(roleNoteFor(entries, "owner")).toBe("");
    expect(roleNoteFor(entries)).toBe("");
  });
});

describe("全体ガイド", () => {
  it("最初の設定はオーナー・管理者だけ、月締めの流れは編集できる人だけ", () => {
    expect(sectionsForRole(STAFF_OVERVIEW, "owner").map((s) => s.slug)).toContain("setup");
    expect(sectionsForRole(STAFF_OVERVIEW, "clerk").map((s) => s.slug)).not.toContain("setup");
    expect(sectionsForRole(STAFF_OVERVIEW, "clerk").map((s) => s.slug)).toContain("monthly");
    expect(sectionsForRole(STAFF_OVERVIEW, "viewer").map((s) => s.slug)).not.toContain("monthly");
    expect(sectionsForRole(DRIVER_OVERVIEW, "driver")).toHaveLength(DRIVER_OVERVIEW.length);
  });

  it("月締めの流れは「締める → 明細を送る → 振り込む」の順", () => {
    const steps = STAFF_OVERVIEW.find((s) => s.slug === "monthly")!.steps!;
    const at = (word: string) => steps.findIndex((s) => s.includes(word));
    expect(at("月を締めます")).toBeGreaterThan(at("請求書"));
    expect(at("支払明細")).toBeGreaterThan(at("月を締めます"));
    expect(at("振込")).toBeGreaterThan(at("支払明細"));
  });

  it("よくある質問はロールで絞る（代表向けの質問は代表だけ）", () => {
    expect(faqForRole(STAFF_FAQ, "owner").some((f) => f.q.includes("事務員に振込データ"))).toBe(true);
    expect(faqForRole(STAFF_FAQ, "clerk").some((f) => f.q.includes("事務員に振込データ"))).toBe(false);
    expect(faqForRole(DRIVER_FAQ, "driver").length).toBeGreaterThan(0);
  });
});
