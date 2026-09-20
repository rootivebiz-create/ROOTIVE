import { describe, expect, it } from "vitest";
import {
  ALERT_CODES,
  ALERT_CODE_INFO,
  alertCodeInfo,
  alertSummaryText,
  countsOf,
  detectMessage,
  groupBySeverity,
  isStale,
  severityRank,
  sortAlerts,
  STALE_MINUTES,
  totalCount,
  UNKNOWN_ALERT_CODE_INFO,
  ZERO_COUNTS,
  type SeverityCounts,
} from "@/lib/alerts/helpers";
import { ALERTS_CSV_HEADERS, alertToCsvRow, alertsCsv, alertsCsvFilename, alertsCsvUrl, type AlertCsvSource } from "@/lib/exports/alerts-csv";
import { CSV_BOM } from "@/lib/exports/csv";
import { ALERT_FILTERS, alertFilterFromParam, alertFilterSchema, alertStatusSchema, detectAnomaliesSchema, setAlertStatusSchema } from "@/lib/schemas/alerts";
import type { Alert, AlertSeverity } from "@/lib/db/types";

/** テスト用のアラート 1 件 */
function mk(over: Partial<Alert> & { id: string; severity: AlertSeverity; detected_at: string }): Alert {
  return {
    company_id: "11111111-1111-4111-8111-111111111111",
    month: "2026-09-01",
    code: "qty_zero",
    title: "数量が 0 の稼働が 2 件あります",
    detail: "数量を入れ忘れている可能性があります。",
    amount: null,
    ref_table: "work_entries",
    ref_id: "",
    href: "/entries?m=2026-09",
    status: "open",
    fingerprint: `qty_zero:2026-09:${over.id}`,
    resolved_at: null,
    resolved_by: null,
    note: "",
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("ALERT_CODE_INFO", () => {
  const CODES = [
    "qty_zero",
    "rate_diff",
    "mgmt_fee_mismatch",
    "no_entry",
    "margin_drop",
    "driver_loss",
    "target_miss",
    "invoice_overdue",
    "invoice_missing",
    "expense_missing",
    "cash_short",
    // 0012：運行管理と法令対応
    "document_expired",
    "document_expiring",
    "roll_call_missing",
    "safety_manager_missing",
    "day_entry_pending",
    // 0014：法人の経営管理
    "tax_due",
    "tax_overdue",
    "contract_renewal",
    "contract_expired",
    "bank_account_missing",
    // 0018：労務と支払通知
    "duty_long",
    "rest_short",
    "consecutive_days",
    "notice_diff",
  ];

  it("RPC detect_anomalies が作る 25 種類の code を、その並び順で持つ（24 ルール。契約は更新時期と期限切れの 2 種類を出す）", () => {
    expect(ALERT_CODES).toEqual(CODES);
    expect(Object.keys(ALERT_CODE_INFO)).toHaveLength(25);
  });

  it("どの種類にも日本語の表示名・説明とアイコン名がある", () => {
    for (const code of CODES) {
      const info = ALERT_CODE_INFO[code];
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.hint.length).toBeGreaterThan(0);
      expect(info.icon).toMatch(/^[A-Z][A-Za-z0-9]*$/);
    }
  });

  it("未知の種類でも表示できる（画面が壊れない）", () => {
    expect(alertCodeInfo("qty_zero").label).toBe("数量 0 の稼働");
    expect(alertCodeInfo("unknown_code")).toBe(UNKNOWN_ALERT_CODE_INFO);
    expect(alertCodeInfo("")).toBe(UNKNOWN_ALERT_CODE_INFO);
    expect(alertCodeInfo(null)).toBe(UNKNOWN_ALERT_CODE_INFO);
    expect(alertCodeInfo(undefined)).toBe(UNKNOWN_ALERT_CODE_INFO);
  });
});

describe("sortAlerts", () => {
  it("重さ（重要 → 注意 → 参考）→ 検知日時の新しい順", () => {
    const rows = [
      mk({ id: "a", severity: "low", detected_at: "2026-09-19T10:00:00.000Z" }),
      mk({ id: "b", severity: "high", detected_at: "2026-09-19T08:00:00.000Z" }),
      mk({ id: "c", severity: "medium", detected_at: "2026-09-19T09:00:00.000Z" }),
      mk({ id: "d", severity: "high", detected_at: "2026-09-19T09:30:00.000Z" }),
    ];
    expect(sortAlerts(rows).map((r) => r.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("元の配列を変更しない", () => {
    const rows = [
      mk({ id: "a", severity: "low", detected_at: "2026-09-19T10:00:00.000Z" }),
      mk({ id: "b", severity: "high", detected_at: "2026-09-19T08:00:00.000Z" }),
    ];
    const sorted = sortAlerts(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(sorted).not.toBe(rows);
  });

  it("同じ重さ・同じ日時なら元の並びを保つ（安定）", () => {
    const at = "2026-09-19T10:00:00.000Z";
    const rows = [
      mk({ id: "1", severity: "medium", detected_at: at }),
      mk({ id: "2", severity: "medium", detected_at: at }),
      mk({ id: "3", severity: "medium", detected_at: at }),
    ];
    expect(sortAlerts(rows).map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("空配列・1 件でも落ちない", () => {
    expect(sortAlerts([])).toEqual([]);
    const one = [mk({ id: "a", severity: "high", detected_at: "2026-09-19T10:00:00.000Z" })];
    expect(sortAlerts(one).map((r) => r.id)).toEqual(["a"]);
  });

  it("severityRank は 重要 < 注意 < 参考", () => {
    expect(severityRank("high")).toBeLessThan(severityRank("medium"));
    expect(severityRank("medium")).toBeLessThan(severityRank("low"));
  });
});

describe("groupBySeverity / countsOf", () => {
  const rows = [
    mk({ id: "a", severity: "high", detected_at: "2026-09-19T10:00:00.000Z" }),
    mk({ id: "b", severity: "low", detected_at: "2026-09-19T09:00:00.000Z" }),
    mk({ id: "c", severity: "high", detected_at: "2026-09-19T08:00:00.000Z" }),
    mk({ id: "d", severity: "medium", detected_at: "2026-09-19T07:00:00.000Z" }),
  ];

  it("重さで 3 つに分け、各グループは渡された順のまま", () => {
    const g = groupBySeverity(rows);
    expect(g.high.map((r) => r.id)).toEqual(["a", "c"]);
    expect(g.medium.map((r) => r.id)).toEqual(["d"]);
    expect(g.low.map((r) => r.id)).toEqual(["b"]);
  });

  it("空配列なら 3 つとも空", () => {
    expect(groupBySeverity([])).toEqual({ high: [], medium: [], low: [] });
    expect(countsOf([])).toEqual(ZERO_COUNTS);
  });

  it("件数を数える", () => {
    expect(countsOf(rows)).toEqual({ high: 2, medium: 1, low: 1 });
    expect(totalCount(countsOf(rows))).toBe(4);
    expect(totalCount(ZERO_COUNTS)).toBe(0);
  });
});

describe("alertSummaryText", () => {
  it("0 件の区分は出さない", () => {
    expect(alertSummaryText({ high: 2, medium: 5, low: 0 })).toBe("重要 2 件・注意 5 件");
    expect(alertSummaryText({ high: 0, medium: 0, low: 3 })).toBe("参考 3 件");
    expect(alertSummaryText({ high: 1, medium: 1, low: 1 })).toBe("重要 1 件・注意 1 件・参考 1 件");
  });

  it("全部 0 なら「問題なし」", () => {
    expect(alertSummaryText(ZERO_COUNTS)).toBe("問題なし");
    expect(alertSummaryText({ high: 0, medium: 0, low: 0 })).toBe("問題なし");
  });

  it("マイナス・小数は 0 として扱う", () => {
    expect(alertSummaryText({ high: -1, medium: 0, low: 0 })).toBe("問題なし");
    expect(alertSummaryText({ high: 1.7, medium: 0.4, low: 0 })).toBe("重要 1 件");
  });

  it("並びは 重要 → 注意 → 参考", () => {
    const counts: SeverityCounts = { high: 1, medium: 2, low: 3 };
    expect(alertSummaryText(counts).indexOf("重要")).toBeLessThan(alertSummaryText(counts).indexOf("注意"));
    expect(alertSummaryText(counts).indexOf("注意")).toBeLessThan(alertSummaryText(counts).indexOf("参考"));
  });
});

describe("isStale", () => {
  const now = new Date("2026-09-19T12:00:00.000Z");

  it("一度も検査していなければ古い扱い", () => {
    expect(isStale(null, now, 60)).toBe(true);
    expect(isStale(undefined, now, 60)).toBe(true);
    expect(isStale("", now, 60)).toBe(true);
    expect(isStale("これは日時ではない", now, 60)).toBe(true);
  });

  it("ちょうど 60 分は「古い」ではない（境界）", () => {
    expect(isStale("2026-09-19T11:00:00.000Z", now, 60)).toBe(false);
    expect(isStale("2026-09-19T10:59:59.999Z", now, 60)).toBe(true);
    expect(isStale("2026-09-19T11:00:00.001Z", now, 60)).toBe(false);
  });

  it("新しければ false、古ければ true", () => {
    expect(isStale("2026-09-19T11:59:00.000Z", now, 60)).toBe(false);
    expect(isStale("2026-09-19T06:00:00.000Z", now, 60)).toBe(true);
  });

  it("未来の日時は古くない", () => {
    expect(isStale("2026-09-19T13:00:00.000Z", now, 60)).toBe(false);
  });

  it("minutes を変えられる（0 なら同時刻以外はすべて古い）", () => {
    expect(isStale("2026-09-19T11:59:59.000Z", now, 0)).toBe(true);
    expect(isStale("2026-09-19T12:00:00.000Z", now, 0)).toBe(false);
    expect(isStale("2026-09-19T11:50:00.000Z", now, 15)).toBe(false);
    expect(isStale("2026-09-19T11:40:00.000Z", now, 15)).toBe(true);
    expect(isStale("2026-09-19T11:40:00.000Z", now, -5)).toBe(true);
  });

  it("既定は 60 分", () => {
    expect(STALE_MINUTES).toBe(60);
    expect(isStale("2026-09-19T11:30:00.000Z", now)).toBe(false);
    expect(isStale("2026-09-19T10:30:00.000Z", now)).toBe(true);
  });
});

describe("detectMessage", () => {
  it("件数入りの日本語", () => {
    expect(detectMessage({ detected: 7, open: 7, auto_resolved: 0 })).toBe("7 件の注意点が見つかりました");
    expect(detectMessage({ detected: 0, open: 0, auto_resolved: 0 })).toBe("気になる点はありませんでした");
  });

  it("自動で解決したものがあれば添える", () => {
    expect(detectMessage({ detected: 2, open: 2, auto_resolved: 3 })).toBe("2 件の注意点が見つかりました（3 件は解消していました）");
    expect(detectMessage({ detected: 0, open: 0, auto_resolved: 1 })).toBe("気になる点はありませんでした（1 件は解消していました）");
  });
});

// ---------------------------------------------------------------------------

describe("アラートのスキーマ", () => {
  it("状態は open / resolved / ignored のみ", () => {
    expect(alertStatusSchema.parse("open")).toBe("open");
    expect(alertStatusSchema.parse("resolved")).toBe("resolved");
    expect(alertStatusSchema.parse("ignored")).toBe("ignored");
    expect(alertStatusSchema.safeParse("done").success).toBe(false);
  });

  it("絞り込みは状態 ＋ all", () => {
    expect([...ALERT_FILTERS]).toEqual(["open", "resolved", "ignored", "all"]);
    expect(alertFilterSchema.safeParse("all").success).toBe(true);
    expect(alertFilterSchema.safeParse("").success).toBe(false);
  });

  it("?status= が不正・未指定なら未対応", () => {
    expect(alertFilterFromParam("resolved")).toBe("resolved");
    expect(alertFilterFromParam("all")).toBe("all");
    expect(alertFilterFromParam(["ignored", "open"])).toBe("ignored");
    expect(alertFilterFromParam(undefined)).toBe("open");
    expect(alertFilterFromParam("いいかんじ")).toBe("open");
  });

  it("検査は稼動月 YYYY-MM のみ", () => {
    expect(detectAnomaliesSchema.parse({ month: "2026-09" }).month).toBe("2026-09");
    expect(detectAnomaliesSchema.safeParse({ month: "2026-09-01" }).success).toBe(false);
    expect(detectAnomaliesSchema.safeParse({ month: "2026-13" }).success).toBe(false);
  });

  it("状態変更は UUID ＋ 状態。メモは省略できる", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(setAlertStatusSchema.parse({ id, status: "resolved" })).toEqual({ id, status: "resolved", note: "" });
    expect(setAlertStatusSchema.parse({ id, status: "ignored", note: " 来月まとめて対応 " }).note).toBe("来月まとめて対応");
    expect(setAlertStatusSchema.safeParse({ id: "x", status: "resolved" }).success).toBe(false);
    expect(setAlertStatusSchema.safeParse({ id, status: "closed" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("気になること CSV", () => {
  const row: AlertCsvSource = {
    month: "2026-09-01",
    code: "driver_loss",
    severity: "high",
    title: "相曽慧の利益がマイナスです",
    detail: "会社利益が -12,345 円です。単価と調整を確認してください。",
    amount: -12345,
    status: "open",
    detected_at: "2026-09-19T03:00:00.000Z",
    resolved_at: null,
    note: "",
    href: "/drivers-pl?m=2026-09",
  };

  it("列並び", () => {
    expect([...ALERTS_CSV_HEADERS]).toEqual(["稼動月", "重さ", "種類", "内容", "説明", "金額", "状態", "検知日時", "対応日時", "メモ", "リンク"]);
  });

  it("稼動月は YYYY-MM、重さ・種類・状態は日本語、金額は生の値", () => {
    expect(alertToCsvRow(row)).toEqual([
      "2026-09",
      "重要",
      "ドライバーの利益がマイナス",
      "相曽慧の利益がマイナスです",
      "会社利益が -12,345 円です。単価と調整を確認してください。",
      "-12345",
      "未対応",
      "2026-09-19T03:00:00.000Z",
      "",
      "",
      "/drivers-pl?m=2026-09",
    ]);
  });

  it("金額なしは空欄、0 は 0", () => {
    expect(alertToCsvRow({ ...row, amount: null })[5]).toBe("");
    expect(alertToCsvRow({ ...row, amount: 0 })[5]).toBe("0");
  });

  it("未知の種類は「その他」", () => {
    expect(alertToCsvRow({ ...row, code: "brand_new" })[2]).toBe("その他");
  });

  it("BOM ＋ CRLF、説明のカンマは引用符で囲む", () => {
    const csv = alertsCsv([row]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(ALERTS_CSV_HEADERS.join(","));
    expect(lines[1]).toContain('"会社利益が -12,345 円です。単価と調整を確認してください。"');
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("0 件でもヘッダー行だけ出る", () => {
    expect(alertsCsv([])).toBe(`${CSV_BOM}${ALERTS_CSV_HEADERS.join(",")}\r\n`);
  });

  it("URL とファイル名", () => {
    expect(alertsCsvUrl("2026-09", "open")).toBe("/api/export/alerts.csv?m=2026-09&status=open");
    expect(alertsCsvUrl("2026-09")).toBe("/api/export/alerts.csv?m=2026-09&status=open");
    expect(alertsCsvUrl("all", "all")).toBe("/api/export/alerts.csv?m=all&status=all");
    expect(alertsCsvFilename("2026-09")).toBe("気になること_2026-09.csv");
  });
});
