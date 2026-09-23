import { describe, expect, it } from "vitest";
import { filterCommands, normalizeText, COMMAND_GROUP_ORDER, type CommandItem } from "@/components/layout/command-palette";
import {
  BOTTOM_NAV,
  BOTTOM_NAV_HREFS,
  BOTTOM_TABS_MAX,
  DRIVER_NAV,
  MAIN_NAV,
  MORE_NAV,
  badgeText,
  bottomHrefsFor,
  bottomItemsFor,
  groupNavItems,
  isGroupOpen,
  moreItemsFor,
  navItemsFor,
  readCollapsedGroups,
  toggleNavGroup,
  notificationRows,
} from "@/components/layout/nav";
import { NAV_ADMIN_ROLES, NAV_MANAGER_ROLES, isVisibleForRole, visibleForRole } from "@/lib/nav/visibility";

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
  it("PC のサイドナビは 24 項目（代表 ＋ ホーム・事務 ＋ 入力・経営・管理・相談のまとまり ＋ 設定）", () => {
    expect(MAIN_NAV).toHaveLength(24);
    expect(MAIN_NAV.map((i) => i.href)).toEqual([
      "/executive", "/dashboard", "/office", "/dispatch", "/entries", "/daily", "/intake", "/payouts", "/invoices", "/expenses", "/bank",
      "/cashflow", "/projects", "/finance", "/reports", "/alerts", "/fleet", "/compliance", "/hr", "/records", "/exports", "/ai", "/chat", "/settings",
    ]);
    expect(MAIN_NAV.map((i) => i.label)).toEqual([
      "代表", "ホーム", "事務", "配車", "稼働", "日報・点呼", "取り込み", "支払", "請求", "経費", "入金",
      "資金繰り", "案件", "財務", "レポート", "気になること", "車両と書類", "法令対応", "採用と契約", "書類の検索", "出力", "AI 相談", "チャット", "設定",
    ]);
  });

  it("事務だけ adminOnly（owner・admin に出し、閲覧者・ドライバーには出さない）", () => {
    expect(MAIN_NAV.filter((i) => i.adminOnly).map((i) => i.href)).toEqual(["/office"]);
    expect(navItemsFor("staff", "admin").map((i) => i.href)).toContain("/office");
    expect(navItemsFor("staff", "viewer").map((i) => i.href)).not.toContain("/office");
    expect(moreItemsFor("viewer").map((i) => i.href)).not.toContain("/office");
  });

  it("代表だけ ownerOnly で、ほかの項目には付かない", () => {
    expect(MAIN_NAV.filter((i) => i.ownerOnly).map((i) => i.href)).toEqual(["/executive"]);
    expect(DRIVER_NAV.some((i) => i.ownerOnly)).toBe(false);
  });

  it("見出し（group）は 代表・入力・経営・管理・相談 の 5 つで、ホームと設定には付かない", () => {
    const groups = MAIN_NAV.map((i) => i.group);
    expect(groups[0]).toBe("代表");
    expect(groups[1]).toBeUndefined(); // ホーム
    expect(groups[groups.length - 1]).toBeUndefined();
    expect([...new Set(groups.filter(Boolean))]).toEqual(["代表", "入力", "経営", "管理", "相談"]);
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

  it("メニューシートには下タブに入らない 20 項目が入り、合計はサイドナビと一致する", () => {
    expect(MORE_NAV.map((i) => i.href)).toEqual([
      "/executive", "/office", "/dispatch", "/daily", "/intake", "/expenses", "/bank", "/cashflow", "/projects", "/finance", "/reports", "/alerts",
      "/fleet", "/compliance", "/hr", "/records", "/exports", "/ai", "/chat", "/settings",
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

  it("ドライバーポータルは 4 項目で、下タブにもメニューを出さない", () => {
    expect(DRIVER_NAV.map((i) => i.href)).toEqual(["/driver/today", "/driver/schedule", "/driver", "/driver/account"]);
    expect(navItemsFor("driver")).toEqual(DRIVER_NAV);
    expect(bottomItemsFor("driver")).toEqual(DRIVER_NAV);
    expect(navItemsFor("staff")).toEqual(MAIN_NAV);
    expect(navItemsFor(undefined)).toEqual(MAIN_NAV);
    expect(bottomItemsFor(undefined)).toEqual(BOTTOM_NAV);
    expect(navItemsFor("driver", "driver")).toEqual(DRIVER_NAV);
    expect(bottomItemsFor("driver", "driver")).toEqual(DRIVER_NAV);
  });

  it("「代表」はオーナーのときだけナビに出る（下タブは今までどおり 4 項目）", () => {
    expect(navItemsFor("staff", "owner").map((i) => i.href)).toEqual(MAIN_NAV.map((i) => i.href));
    for (const role of ["admin", "viewer", "driver"] as const) {
      expect(navItemsFor("staff", role).map((i) => i.href)).not.toContain("/executive");
      // 閲覧者・ドライバーには「事務」も出さない
      expect(navItemsFor("staff", role)).toHaveLength(MAIN_NAV.length - (role === "admin" ? 1 : 2));
      expect(moreItemsFor(role).map((i) => i.href)).not.toContain("/executive");
    }
    expect(moreItemsFor("owner").map((i) => i.href)).toEqual(MORE_NAV.map((i) => i.href));
    expect(moreItemsFor()).toEqual(MORE_NAV);
    // 下タブ（ホーム・稼働・支払・請求）はロールで変わらない
    for (const role of ["owner", "admin", "viewer"] as const) {
      expect(bottomItemsFor("staff", role).map((i) => i.href)).toEqual(BOTTOM_NAV_HREFS);
    }
  });

  it("最初に開く画面が事務の人は、下タブの先頭が事務になり、ホームはメニューへ移る", () => {
    expect(bottomHrefsFor()).toEqual(BOTTOM_NAV_HREFS);
    expect(bottomHrefsFor("dashboard")).toEqual(BOTTOM_NAV_HREFS);
    expect(bottomHrefsFor("office")).toEqual(["/office", "/entries", "/payouts", "/invoices"]);
    for (const role of ["owner", "admin"] as const) {
      expect(bottomItemsFor("staff", role, "office").map((i) => i.label)).toEqual(["事務", "稼働", "支払", "請求"]);
      const more = moreItemsFor(role, "office").map((i) => i.href);
      expect(more).toContain("/dashboard");
      expect(more).not.toContain("/office");
      // 下タブとメニューを合わせるとサイドナビと同じ数
      expect(bottomItemsFor("staff", role, "office").length + more.length).toBe(navItemsFor("staff", role).length);
    }
  });

  it("事務を使えない閲覧者は、事務を選んでいても今までの下タブ", () => {
    expect(bottomItemsFor("staff", "viewer", "office").map((i) => i.href)).toEqual(BOTTOM_NAV_HREFS);
    expect(moreItemsFor("viewer", "office").map((i) => i.href)).not.toContain("/office");
  });

  it("コマンドパレットのグループはすべて定義されている", () => {
    expect(COMMAND_GROUP_ORDER).toEqual(["page", "driver", "project", "client", "month"]);
  });
});

describe("ロールごとの出し分け（visibleForRole）", () => {
  const ITEMS = [
    { href: "/settings/drivers", label: "ドライバー" },
    { href: "/settings/safety", label: "安全管理", adminOnly: true },
    { href: "/settings/company", label: "会社設定", ownerOnly: true },
  ];

  it("role を省略すると今までどおり全部返す", () => {
    expect(visibleForRole(ITEMS)).toEqual(ITEMS);
    expect(visibleForRole(ITEMS, undefined).map((i) => i.href)).toEqual(ITEMS.map((i) => i.href));
  });

  it("owner はすべて、admin は ownerOnly 以外、viewer は制限の無いものだけ", () => {
    expect(visibleForRole(ITEMS, "owner").map((i) => i.label)).toEqual(["ドライバー", "安全管理", "会社設定"]);
    expect(visibleForRole(ITEMS, "admin").map((i) => i.label)).toEqual(["ドライバー", "安全管理"]);
    expect(visibleForRole(ITEMS, "viewer").map((i) => i.label)).toEqual(["ドライバー"]);
  });

  it("driver は adminOnly を通さない（以前の role !== \"viewer\" では通っていた）", () => {
    expect(visibleForRole(ITEMS, "driver").map((i) => i.label)).toEqual(["ドライバー"]);
    expect(isVisibleForRole({ adminOnly: true }, "driver")).toBe(false);
    expect(isVisibleForRole({ adminOnly: true }, "viewer")).toBe(false);
    expect(isVisibleForRole({ adminOnly: true }, "admin")).toBe(true);
    expect(isVisibleForRole({ adminOnly: true }, "owner")).toBe(true);
    expect(NAV_ADMIN_ROLES).toEqual(["owner", "admin", "clerk"]);
  });

  it("事務員（clerk）は adminOnly を通すが、managerOnly・ownerOnly・noClerk は通さない", () => {
    expect(isVisibleForRole({ adminOnly: true }, "clerk")).toBe(true);
    expect(isVisibleForRole({ managerOnly: true }, "clerk")).toBe(false);
    expect(isVisibleForRole({ managerOnly: true }, "admin")).toBe(true);
    expect(isVisibleForRole({ managerOnly: true }, "viewer")).toBe(false);
    expect(isVisibleForRole({ ownerOnly: true }, "clerk")).toBe(false);
    expect(isVisibleForRole({ noClerk: true }, "clerk")).toBe(false);
    expect(isVisibleForRole({ noClerk: true }, "viewer")).toBe(true);
    expect(isVisibleForRole({ noClerk: true }, "admin")).toBe(true);
    expect(NAV_MANAGER_ROLES).toEqual(["owner", "admin"]);
  });

  it("事務員のナビに経営の画面（ホーム・資金繰り・案件・財務・レポート・AI）は出ず、事務は出る", () => {
    const hrefs = navItemsFor("staff", "clerk").map((i) => i.href);
    for (const h of ["/dashboard", "/cashflow", "/projects", "/finance", "/reports", "/ai", "/executive"]) expect(hrefs).not.toContain(h);
    for (const h of ["/office", "/entries", "/daily", "/dispatch", "/payouts", "/invoices", "/expenses"]) expect(hrefs).toContain(h);
  });

  it("事務員の下タブは先頭が事務で、ホームは入らない", () => {
    const tabs = bottomItemsFor("staff", "clerk", "dashboard").map((i) => i.href);
    expect(tabs[0]).toBe("/office");
    expect(tabs).not.toContain("/dashboard");
    expect(moreItemsFor("clerk", "dashboard").map((i) => i.href)).not.toContain("/dashboard");
  });

  it("ownerOnly と adminOnly が両方付いていたら owner だけ", () => {
    const item = { ownerOnly: true, adminOnly: true };
    expect(isVisibleForRole(item, "owner")).toBe(true);
    expect(isVisibleForRole(item, "admin")).toBe(false);
  });

  it("元の配列と順番を壊さない", () => {
    const before = ITEMS.map((i) => i.href);
    visibleForRole(ITEMS, "viewer");
    expect(ITEMS.map((i) => i.href)).toEqual(before);
    expect(visibleForRole(ITEMS, "owner")).not.toBe(ITEMS);
  });
});

describe("ヘッダーのベルの行（notificationRows）", () => {
  it("0 件の行は出さない", () => {
    expect(notificationRows({ "/alerts": 0, "/chat": 0 }, "owner")).toEqual([]);
    expect(notificationRows(undefined, "admin")).toEqual([]);
    expect(notificationRows({}, "viewer")).toEqual([]);
  });

  it("気になること・未読のチャットを件数つきで出す", () => {
    expect(notificationRows({ "/alerts": 3, "/chat": 2 }, "admin")).toEqual([
      { href: "/alerts", label: "気になること", count: 3 },
      { href: "/chat", label: "未読のチャット", count: 2 },
    ]);
    expect(notificationRows({ "/chat": 1 }, "viewer")).toEqual([{ href: "/chat", label: "未読のチャット", count: 1 }]);
  });

  it("「決裁待ち」は代表のときだけ（件数は /executive のバッジ、行き先は決裁の一覧）", () => {
    expect(notificationRows({ "/executive": 2 }, "owner")).toEqual([{ href: "/executive/approvals", label: "決裁待ち", count: 2 }]);
    expect(notificationRows({ "/executive": 2 }, "admin")).toEqual([]);
    expect(notificationRows({ "/executive": 2 })).toEqual([]);
    expect(notificationRows({ "/alerts": 1, "/chat": 1, "/executive": 1 }, "owner").map((r) => r.href)).toEqual(["/alerts", "/chat", "/executive/approvals"]);
  });

  it("「事務の承認待ち」は owner・admin だけ（閲覧者には出さない）", () => {
    expect(notificationRows({ "/office": 3 }, "admin")).toEqual([{ href: "/office", label: "事務の承認待ち", count: 3 }]);
    expect(notificationRows({ "/office": 3 }, "owner").map((r) => r.href)).toEqual(["/office"]);
    expect(notificationRows({ "/office": 3 }, "viewer")).toEqual([]);
    expect(notificationRows({ "/office": 0 }, "admin")).toEqual([]);
    expect(notificationRows({ "/office": 2 }, "clerk")).toEqual([{ href: "/office", label: "事務の承認待ち", count: 2 }]);
  });
});

describe("サイドナビのまとまり（畳める見出し）", () => {
  const groups = groupNavItems(MAIN_NAV);

  it("見出しごとにまとまり、並びは変わらない", () => {
    expect(groups.map((g) => g.group)).toEqual(["代表", undefined, "入力", "経営", "管理", "相談", undefined]);
    expect(groups.flatMap((g) => g.items.map((i) => i.href))).toEqual(MAIN_NAV.map((i) => i.href));
  });

  it("見出しの無いまとまり（ホーム・設定）は畳めない（常に開く）", () => {
    const home = groups.find((g) => g.items.some((i) => i.href === "/dashboard"))!;
    expect(home.group).toBeUndefined();
    expect(isGroupOpen(home, ["入力", "経営"], "/entries")).toBe(true);
  });

  it("畳んだ見出しは閉じるが、いま開いている画面が入っていれば開く", () => {
    const input = groups.find((g) => g.group === "入力")!;
    expect(isGroupOpen(input, [], "/dashboard")).toBe(true);
    expect(isGroupOpen(input, ["入力"], "/dashboard")).toBe(false);
    // 「稼働」を開いているときは、入力を畳んでいても開く（居場所を見失わないため）
    expect(isGroupOpen(input, ["入力"], "/entries")).toBe(true);
    expect(isGroupOpen(input, ["入力"], undefined)).toBe(false);
  });

  it("切り替えは足し引きで、並びは安定する", () => {
    expect(toggleNavGroup([], "管理")).toEqual(["管理"]);
    expect(toggleNavGroup(["管理"], "管理")).toEqual([]);
    expect(toggleNavGroup(["管理"], "入力")).toEqual(["入力", "管理"]);
    // 元の配列は変えない
    const before = ["管理"];
    toggleNavGroup(before, "入力");
    expect(before).toEqual(["管理"]);
  });

  it("覚えた値が読めないときは「全部開く」に倒す", () => {
    expect(readCollapsedGroups(null)).toEqual([]);
    expect(readCollapsedGroups("")).toEqual([]);
    expect(readCollapsedGroups("こわれた")).toEqual([]);
    expect(readCollapsedGroups('{"入力":true}')).toEqual([]);
    expect(readCollapsedGroups('["入力","管理"]')).toEqual(["入力", "管理"]);
    expect(readCollapsedGroups('["入力",3,null]')).toEqual(["入力"]);
  });
});
