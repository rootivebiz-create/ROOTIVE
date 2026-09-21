import { describe, expect, it } from "vitest";
import {
  alertsText,
  approvalsText,
  cashText,
  detectLineIntent,
  entriesText,
  helpText,
  notAllowedText,
  notLinkedText,
  payoutText,
  summaryText,
} from "@/lib/line/ask";

/**
 * LINE でそのまま数字を聞けるようにするための純関数のテスト。
 * 判定（何を聞かれたか）と文面だけを固める。DB の読み取りと権限は lib/line/answer.ts 側。
 */

describe("detectLineIntent", () => {
  it("言い方が違っても同じ意図として拾う", () => {
    for (const t of ["今月どう？", "売上は？", "利益おしえて", "着地は", "調子どう", "今月の数字"]) {
      expect(detectLineIntent(t)).toBe("summary");
    }
    for (const t of ["資金繰りは？", "現金いくら", "残高", "キャッシュ足りてる？"]) {
      expect(detectLineIntent(t)).toBe("cash");
    }
    for (const t of ["決裁ある？", "承認まち", "申請きてる？", "稟議"]) {
      expect(detectLineIntent(t)).toBe("approvals");
    }
    for (const t of ["支払いくら", "振込日は？", "ふりこみ"]) {
      expect(detectLineIntent(t)).toBe("payout");
    }
    for (const t of ["稼働は？", "入力漏れ", "日報でてる？", "点呼"]) {
      expect(detectLineIntent(t)).toBe("entries");
    }
    for (const t of ["気になることある？", "アラート", "異常ない？"]) {
      expect(detectLineIntent(t)).toBe("alerts");
    }
  });

  it("全角・カタカナ・ひらがなの違いを吸収する", () => {
    expect(detectLineIntent("ｼｷﾝｸﾞﾘ")).toBe("cash");
    expect(detectLineIntent("シキングリ")).toBe("cash");
    expect(detectLineIntent("しきんぐり")).toBe("cash");
  });

  it("使い方を聞かれたら help", () => {
    for (const t of ["ヘルプ", "なにができる？", "？", "使い方"]) {
      expect(detectLineIntent(t)).toBe("help");
    }
  });

  it("分からないものは unknown（空文字も）", () => {
    expect(detectLineIntent("おはようございます")).toBe("unknown");
    expect(detectLineIntent("")).toBe("unknown");
    expect(detectLineIntent("   ")).toBe("unknown");
  });
});

describe("summaryText", () => {
  const base = {
    month: "2026-09",
    bill: 2559573,
    operatingProfit: 400000,
    billForecast: 3000000,
    operatingProfitForecast: 500000,
    profitTarget: 600000,
    profitTargetRate: 0.8333,
    isClosed: false,
    entryCount: 10,
  };

  it("未締めなら着地見込みと目標との差を出す", () => {
    const t = summaryText(base);
    expect(t).toContain("2026年9月");
    expect(t).toContain("¥2,559,573");
    expect(t).toContain("見込み");
    expect(t).toContain("足りません");
  });

  it("目標を上回る見込みなら「上回る」と書く", () => {
    const t = summaryText({ ...base, profitTarget: 300000, profitTargetRate: 1.6667 });
    expect(t).toContain("上回る見込み");
  });

  it("締め済みなら見込みを出さない", () => {
    const t = summaryText({ ...base, isClosed: true });
    expect(t).toContain("締め済み");
    expect(t).not.toContain("このままいくと");
  });

  it("稼働が無ければそれだけ伝える", () => {
    expect(summaryText({ ...base, entryCount: 0 })).toBe("2026年9月はまだ稼働が入っていません。");
  });

  it("目標が未設定なら達成率に触れない", () => {
    const t = summaryText({ ...base, profitTarget: 0, profitTargetRate: null });
    expect(t).not.toContain("目標");
  });
});

describe("cashText", () => {
  it("足りなくなる日があれば、その日と不足額を出す", () => {
    const t = cashText({
      balance: 1000000,
      minBalance: -200000,
      minBalanceOn: "2026-11-30",
      zeroOn: "2026-11-25",
      holdDays: 65,
      shortfall: 200000,
      status: "danger",
    });
    expect(t).toContain("¥1,000,000");
    expect(t).toContain("11月25日");
    expect(t).toContain("¥200,000");
    expect(t).toContain("あと 65 日");
  });

  it("足りなくならないなら、いちばん少なくなる日を出す", () => {
    const t = cashText({
      balance: 5000000,
      minBalance: 2000000,
      minBalanceOn: "2026-10-31",
      zeroOn: null,
      holdDays: 120,
      shortfall: 0,
      status: "safe",
    });
    expect(t).toContain("10月31日");
    expect(t).toContain("余裕があります");
    expect(t).not.toContain("足りなく");
  });
});

describe("approvalsText", () => {
  it("0 件ならそれだけ", () => {
    expect(approvalsText({ pending: 0, overdue: 0, oldestDays: null, titles: [] })).toBe("決裁待ちはありません。");
  });

  it("期限切れと最古の滞留日数、件名を 3 件まで出す", () => {
    const t = approvalsText({ pending: 5, overdue: 2, oldestDays: 10, titles: ["A", "B", "C", "D"] });
    expect(t).toContain("5 件");
    expect(t).toContain("2 件は期限切れ");
    expect(t).toContain("10 日前");
    expect(t).toContain("・C");
    expect(t).not.toContain("・D");
  });
});

describe("alertsText", () => {
  it("0 件ならそれだけ", () => {
    expect(alertsText([], 0)).toBe("いまは気になることはありません。");
  });

  it("重要なものに印を付け、4 件目からは件数でまとめる", () => {
    const t = alertsText(
      [
        { title: "休息が足りない", severity: "high" },
        { title: "数量 0 の稼働", severity: "medium" },
        { title: "口座が未入力", severity: "low" },
        { title: "その他", severity: "low" },
      ],
      5,
    );
    expect(t).toContain("未対応が 5 件");
    expect(t).toContain("【重要】休息が足りない");
    expect(t).toContain("ほか 2 件");
  });
});

describe("payoutText", () => {
  it("人数・金額・振込予定日を出す", () => {
    const t = payoutText({ month: "2026-09", total: 1907083, driverCount: 8, payoutDate: "2026-10-31", isClosed: false });
    expect(t).toContain("8 名");
    expect(t).toContain("¥1,907,083");
    expect(t).toContain("10月31日");
    expect(t).toContain("締めると確定");
  });

  it("支払が無ければそれだけ", () => {
    expect(payoutText({ month: "2026-09", total: 0, driverCount: 0, payoutDate: null, isClosed: false })).toContain("まだありません");
  });
});

describe("entriesText", () => {
  it("入力漏れが無ければそう言う", () => {
    const t = entriesText({ month: "2026-09", entryCount: 10, zeroQtyCount: 0, pendingDayEntries: 0, missingReports: 0 });
    expect(t).toContain("10 行");
    expect(t).toContain("入力漏れは見当たりません");
  });

  it("漏れがあれば内訳を出す", () => {
    const t = entriesText({ month: "2026-09", entryCount: 10, zeroQtyCount: 2, pendingDayEntries: 3, missingReports: 1 });
    expect(t).toContain("数量が 0 の行が 2 件");
    expect(t).toContain("承認待ち");
    expect(t).toContain("点呼の記録が無い日が 1 日");
    expect(t).not.toContain("入力漏れは見当たりません");
  });
});

describe("helpText", () => {
  it("見られないものは案内にも出さない", () => {
    const viewer = helpText({ canSeeCash: false, isOwner: false });
    expect(viewer).not.toContain("資金繰り");
    expect(viewer).not.toContain("決裁");
    const owner = helpText({ canSeeCash: true, isOwner: true });
    expect(owner).toContain("資金繰り");
    expect(owner).toContain("決裁");
  });
});

describe("断りの文面", () => {
  it("日本語で理由が分かる", () => {
    expect(notAllowedText("資金繰り")).toContain("資金繰り");
    expect(notLinkedText()).toContain("8 桁");
  });
});
