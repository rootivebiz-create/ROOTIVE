import { describe, expect, it } from "vitest";
import { filterCommands, normalizeText, COMMAND_GROUP_ORDER, type CommandItem } from "@/components/layout/command-palette";
import { BOTTOM_NAV, BOTTOM_NAV_HREFS, BOTTOM_TABS_MAX, DRIVER_NAV, MAIN_NAV, MORE_NAV, badgeText, bottomItemsFor, navItemsFor } from "@/components/layout/nav";

const item = (id: string, label: string, extra: Partial<CommandItem> = {}): CommandItem => ({ id, group: "page", label, ...extra });

const ITEMS: CommandItem[] = [
  item("p1", "ホーム", { keywords: ["home", "dashboard"], href: "/dashboard" }),
  item("p2", "稼働", { keywords: ["entries", "かどう"], href: "/entries" }),
  item("p3", "請求", { keywords: ["invoice", "せいきゅう"], href: "/invoices" }),
  item("d1", "田中 太郎", { group: "driver", href: "/payouts/1/statement" }),
  item("d2", "田中 次郎", { group: "driver", href: "/payouts/2/statement", inactive: true }),
  item("d3", "佐藤 ドライバー", { group: "driver", href: "/payouts/3/statement" }),
  item("m1", "2026年9月", { group: "month", month: "2026-09", keywords: ["2026-09"] }),
];

describe("コマンドパレットの検索（filterCommands）", () => {
  it("空のクエリは全件をそのままの順で返す", () => {
    const res = filterCommands(ITEMS, "");
    expect(res).toHaveLength(ITEMS.length);
    expect(res.map((r) => r.id)).toEqual(ITEMS.map((r) => r.id));
  });

  it("空白だけのクエリも全件を返す（全角の空白を含む）", () => {
    expect(filterCommands(ITEMS, "  　 ")).toHaveLength(ITEMS.length);
  });

  it("前方一致は部分一致より上位に並ぶ", () => {
    const items: CommandItem[] = [item("a", "支払明細"), item("b", "明細")];
    expect(filterCommands(items, "明細").map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("部分一致でも候補に入る", () => {
    expect(filterCommands(ITEMS, "太郎").map((r) => r.id)).toEqual(["d1"]);
  });

  it("かな（ひらがな・カタカナ・半角カナ）を区別しない", () => {
    expect(filterCommands(ITEMS, "ドライバー").map((r) => r.id)).toEqual(["d3"]);
    expect(filterCommands(ITEMS, "どらいばー").map((r) => r.id)).toEqual(["d3"]);
    expect(filterCommands(ITEMS, "ﾄﾞﾗｲﾊﾞｰ").map((r) => r.id)).toEqual(["d3"]);
  });

  it("英字の大文字・小文字と全角英数を区別しない", () => {
    expect(filterCommands(ITEMS, "HOME").map((r) => r.id)).toEqual(["p1"]);
    expect(filterCommands(ITEMS, "Ｈｏｍｅ").map((r) => r.id)).toEqual(["p1"]);
  });

  it("別名（keywords）でも一致する", () => {
    expect(filterCommands(ITEMS, "invoice").map((r) => r.id)).toEqual(["p3"]);
    expect(filterCommands(ITEMS, "かどう").map((r) => r.id)).toEqual(["p2"]);
    expect(filterCommands(ITEMS, "2026-09").map((r) => r.id)).toEqual(["m1"]);
  });

  it("空白区切りのクエリは AND 条件になる", () => {
    expect(filterCommands(ITEMS, "田中 次郎").map((r) => r.id)).toEqual(["d2"]);
    expect(filterCommands(ITEMS, "田中 花子")).toEqual([]);
  });

  it("該当が無ければ空配列を返す", () => {
    expect(filterCommands(ITEMS, "存在しない候補")).toEqual([]);
    expect(filterCommands([], "ホーム")).toEqual([]);
  });

  it("停止中の候補も出すが、同じ一致度なら稼働中を先に並べる", () => {
    const res = filterCommands(ITEMS, "田中");
    expect(res.map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(res.map((r) => r.inactive ?? false)).toEqual([false, true]);
  });

  it("元の配列を壊さない", () => {
    const before = ITEMS.map((i) => i.id);
    filterCommands(ITEMS, "田中");
    expect(ITEMS.map((i) => i.id)).toEqual(before);
  });

  it("normalizeText は空白・長音・中黒を無視して比較できる形にする", () => {
    expect(normalizeText("ドライバー 別 単価")).toBe("どらいば別単価");
    expect(normalizeText("ＡＢＣ")).toBe("abc");
    expect(normalizeText("案件・単価")).toBe("案件単価");
  });
});

describe("ナビの定義", () => {
  it("PC のサイドナビは 17 項目（入力・経営・管理・相談のまとまり ＋ ホームと設定）", () => {
    expect(MAIN_NAV).toHaveLength(17);
    expect(MAIN_NAV.map((i) => i.href)).toEqual([
      "/dashboard", "/entries", "/daily", "/intake", "/payouts", "/invoices", "/expenses", "/bank",
      "/cashflow", "/projects", "/reports", "/alerts", "/fleet", "/hr", "/ai", "/chat", "/settings",
    ]);
    expect(MAIN_NAV.map((i) => i.label)).toEqual([
      "ホーム", "稼働", "日報・点呼", "取り込み", "支払", "請求", "経費", "入金",
      "資金繰り", "案件", "レポート", "気になること", "車両と書類", "採用と契約", "AI 相談", "チャット", "設定",
    ]);
  });

  it("見出し（group）は 入力・経営・管理・相談 の 4 つで、ホームと設定には付かない", () => {
    const groups = MAIN_NAV.map((i) => i.group);
    expect(groups[0]).toBeUndefined();
    expect(groups[groups.length - 1]).toBeUndefined();
    expect([...new Set(groups.filter(Boolean))]).toEqual(["入力", "経営", "管理", "相談"]);
    // 同じ見出しは連続していること（サイドナビが見出しを 1 回だけ出すため）
    const seen: string[] = [];
    for (const g of groups) {
      if (!g) continue;
      if (seen[seen.length - 1] !== g) seen.push(g);
    }
    expect(seen).toEqual([...new Set(groups.filter(Boolean))]);
  });

  it("重複したパス・ラベルが無い", () => {
    expect(new Set(MAIN_NAV.map((i) => i.href)).size).toBe(MAIN_NAV.length);
    expect(new Set(MAIN_NAV.map((i) => i.label)).size).toBe(MAIN_NAV.length);
  });

  it("スマホの下タブは 4 項目 ＋ メニューで 5 つ", () => {
    expect(BOTTOM_NAV).toHaveLength(4);
    expect(BOTTOM_NAV.length + 1).toBe(BOTTOM_TABS_MAX);
    expect(BOTTOM_TABS_MAX).toBe(5);
    expect(BOTTOM_NAV.map((i) => i.href)).toEqual(BOTTOM_NAV_HREFS);
    expect(BOTTOM_NAV.map((i) => i.label)).toEqual(["ホーム", "稼働", "支払", "請求"]);
  });

  it("メニューシートには下タブに入らない 13 項目が入り、合計はサイドナビと一致する", () => {
    expect(MORE_NAV.map((i) => i.href)).toEqual([
      "/daily", "/intake", "/expenses", "/bank", "/cashflow", "/projects", "/reports", "/alerts",
      "/fleet", "/hr", "/ai", "/chat", "/settings",
    ]);
    expect(BOTTOM_NAV.length + MORE_NAV.length).toBe(MAIN_NAV.length);
    expect(MORE_NAV.some((m) => BOTTOM_NAV.some((b) => b.href === m.href))).toBe(false);
  });

  it("バッジの件数は 0 なら出さず、100 以上は 99+ にする", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(undefined)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(1)).toBe("1");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
  });

  it("ドライバーポータルは 3 項目で、下タブにもメニューを出さない", () => {
    expect(DRIVER_NAV.map((i) => i.href)).toEqual(["/driver/today", "/driver", "/driver/account"]);
    expect(navItemsFor("driver")).toEqual(DRIVER_NAV);
    expect(bottomItemsFor("driver")).toEqual(DRIVER_NAV);
    expect(navItemsFor("staff")).toEqual(MAIN_NAV);
    expect(navItemsFor(undefined)).toEqual(MAIN_NAV);
    expect(bottomItemsFor(undefined)).toEqual(BOTTOM_NAV);
  });

  it("コマンドパレットのグループはすべて定義されている", () => {
    expect(COMMAND_GROUP_ORDER).toEqual(["page", "driver", "project", "client", "month"]);
  });
});
