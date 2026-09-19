import { describe, expect, it } from "vitest";
import {
  EDIT_WINDOW_DAYS,
  addDays,
  alcoholOk,
  canEditDate,
  dayProgress,
  diffDays,
  formatWorkDate,
  isWorkDate,
  isWorkTime,
  isoToJstDate,
  isoToJstLocal,
  isoToJstTime,
  jstDateTimeToIso,
  jstLocalToIso,
  monthOfDate,
  monthsOfDates,
  normalizeDigits,
  nowJstTime,
  pendingIds,
  recentDates,
  rollCallState,
  summarizeDay,
  todayJST,
  weekdayJa,
  type DayEntryLike,
} from "@/lib/daily/helpers";
import {
  alcoholSchema,
  applyDayEntriesSchema,
  approveDayEntriesSchema,
  breakMinutesSchema,
  dailyReportInputSchema,
  dayTabFromParam,
  distanceSchema,
  localDateTimeSchema,
  submitDayEntriesSchema,
  workDateSchema,
} from "@/lib/schemas/daily";
import {
  DAILY_REPORT_CSV_HEADERS,
  DAY_ENTRY_CSV_HEADERS,
  boolText,
  dailyCsvFilename,
  dailyCsvKindFromParam,
  dailyCsvUrl,
  dailyReportToCsvRow,
  dayEntryToCsvRow,
  jstTimestampText,
  toDailyReportsCsv,
  toDayEntriesCsv,
  type DailyReportCsvSource,
  type DayEntryCsvSource,
} from "@/lib/exports/daily-csv";
import { CSV_BOM } from "@/lib/exports/csv";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// 日付・時刻の変換（日本時間）
// ---------------------------------------------------------------------------

describe("normalizeDigits", () => {
  it("全角の数字・コロン・小数点を半角にする", () => {
    expect(normalizeDigits("０９：３０")).toBe("09:30");
    expect(normalizeDigits("０．１５")).toBe("0.15");
    expect(normalizeDigits(" 2026-09-18 ")).toBe("2026-09-18");
  });
});

describe("isWorkDate / isWorkTime", () => {
  it("実在する日付だけを受け付ける", () => {
    expect(isWorkDate("2026-09-18")).toBe(true);
    expect(isWorkDate("2028-02-29")).toBe(true); // うるう年
    expect(isWorkDate("2027-02-29")).toBe(false); // 平年
    expect(isWorkDate("2026-13-01")).toBe(false);
    expect(isWorkDate("2026-09-31")).toBe(false);
    expect(isWorkDate("2026/09/18")).toBe(false);
    expect(isWorkDate("")).toBe(false);
    expect(isWorkDate(null)).toBe(false);
  });

  it("0:00〜23:59 だけを受け付ける（全角可）", () => {
    expect(isWorkTime("09:30")).toBe(true);
    expect(isWorkTime("0:00")).toBe(true);
    expect(isWorkTime("23:59")).toBe(true);
    expect(isWorkTime("０９：３０")).toBe(true);
    expect(isWorkTime("24:00")).toBe(false);
    expect(isWorkTime("09:60")).toBe(false);
    expect(isWorkTime("")).toBe(false);
  });
});

describe("jstDateTimeToIso", () => {
  it("日本時間として ISO（UTC）へ変換する", () => {
    expect(jstDateTimeToIso("2026-09-18", "09:30")).toBe("2026-09-18T00:30:00.000Z");
    expect(jstDateTimeToIso("2026-09-18", "09:30:45")).toBe("2026-09-18T00:30:45.000Z");
  });

  it("午前 9 時より前は前日の UTC になる（日またぎ）", () => {
    expect(jstDateTimeToIso("2026-09-18", "08:00")).toBe("2026-09-17T23:00:00.000Z");
    expect(jstDateTimeToIso("2026-09-01", "00:00")).toBe("2026-08-31T15:00:00.000Z"); // 月またぎ
    expect(jstDateTimeToIso("2026-01-01", "00:00")).toBe("2025-12-31T15:00:00.000Z"); // 年またぎ
  });

  it("うるう年の 2/29 も扱える", () => {
    expect(jstDateTimeToIso("2028-02-29", "12:00")).toBe("2028-02-29T03:00:00.000Z");
    expect(jstDateTimeToIso("2028-03-01", "08:00")).toBe("2028-02-29T23:00:00.000Z");
    expect(jstDateTimeToIso("2027-02-29", "12:00")).toBeNull();
  });

  it("全角数字でも変換できる", () => {
    expect(jstDateTimeToIso("2026-09-18", "０９：３０")).toBe("2026-09-18T00:30:00.000Z");
  });

  it("不正な値は null", () => {
    expect(jstDateTimeToIso("", "09:00")).toBeNull();
    expect(jstDateTimeToIso("2026-09-18", "")).toBeNull();
    expect(jstDateTimeToIso("2026-09-18", "25:00")).toBeNull();
    expect(jstDateTimeToIso("2026-09-32", "09:00")).toBeNull();
  });
});

describe("jstLocalToIso", () => {
  it("datetime-local の値を日本時間として読む", () => {
    expect(jstLocalToIso("2026-09-18T09:30")).toBe("2026-09-18T00:30:00.000Z");
    expect(jstLocalToIso("2026-09-18T00:00")).toBe("2026-09-17T15:00:00.000Z");
  });

  it("不正な値は null", () => {
    expect(jstLocalToIso("2026-09-18")).toBeNull();
    expect(jstLocalToIso("")).toBeNull();
    expect(jstLocalToIso("T09:30")).toBeNull();
  });
});

describe("isoToJstTime / isoToJstDate / isoToJstLocal", () => {
  it("UTC の ISO を日本時間で表示する", () => {
    expect(isoToJstTime("2026-09-18T00:30:00.000Z")).toBe("09:30");
    expect(isoToJstDate("2026-09-18T00:30:00.000Z")).toBe("2026-09-18");
    expect(isoToJstLocal("2026-09-18T00:30:00.000Z")).toBe("2026-09-18T09:30");
  });

  it("日付が繰り上がる時刻も正しい", () => {
    expect(isoToJstDate("2026-09-17T23:00:00.000Z")).toBe("2026-09-18");
    expect(isoToJstTime("2026-09-17T23:00:00.000Z")).toBe("08:00");
    expect(isoToJstDate("2025-12-31T15:00:00.000Z")).toBe("2026-01-01");
  });

  it("空・不正は空文字", () => {
    expect(isoToJstTime(null)).toBe("");
    expect(isoToJstDate(undefined)).toBe("");
    expect(isoToJstLocal("")).toBe("");
    expect(isoToJstTime("こんにちは")).toBe("");
  });

  it("往復しても同じ値になる", () => {
    const iso = jstDateTimeToIso("2026-09-18", "09:30");
    expect(iso).not.toBeNull();
    expect(jstLocalToIso(isoToJstLocal(iso))).toBe(iso);
  });
});

describe("todayJST / nowJstTime", () => {
  it("日本時間で日付・時刻を返す", () => {
    expect(todayJST(new Date("2026-09-17T15:00:00.000Z"))).toBe("2026-09-18");
    expect(todayJST(new Date("2026-09-17T14:59:59.000Z"))).toBe("2026-09-17");
    expect(nowJstTime(new Date("2026-09-17T15:00:00.000Z"))).toBe("00:00");
  });
});

describe("addDays / diffDays", () => {
  it("月またぎ・年またぎ・うるう年", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-09-18", -14)).toBe("2026-09-04");
    expect(addDays("不正", 1)).toBe("");
  });

  it("日数の差を返す", () => {
    expect(diffDays("2026-09-18", "2026-09-18")).toBe(0);
    expect(diffDays("2026-09-04", "2026-09-18")).toBe(14);
    expect(diffDays("2028-02-28", "2028-03-01")).toBe(2); // うるう年
    expect(diffDays("2027-02-28", "2027-03-01")).toBe(1);
    expect(diffDays("2026-09-19", "2026-09-18")).toBe(-1);
    expect(Number.isNaN(diffDays("", "2026-09-18"))).toBe(true);
  });
});

describe("recentDates / monthOfDate / monthsOfDates", () => {
  it("新しい順に日付を返す（月またぎ）", () => {
    expect(recentDates("2026-10-02", 3)).toEqual(["2026-10-02", "2026-10-01", "2026-09-30"]);
    expect(recentDates("2026-10-02", 0)).toEqual([]);
    expect(recentDates("不正", 3)).toEqual([]);
  });

  it("稼動月を取り出す", () => {
    expect(monthOfDate("2026-09-18")).toBe("2026-09");
    expect(monthOfDate("不正")).toBe("");
    expect(monthsOfDates(["2026-10-02", "2026-09-30", "2026-10-01", ""])).toEqual(["2026-09", "2026-10"]);
  });
});

describe("formatWorkDate / weekdayJa", () => {
  it("9/18(金) の形式で返す", () => {
    expect(formatWorkDate("2026-09-18")).toBe("9/18(金)");
    expect(formatWorkDate("2026-01-01")).toBe("1/1(木)");
    expect(formatWorkDate("2028-02-29")).toBe("2/29(火)");
    expect(weekdayJa("2026-09-20")).toBe("日");
  });

  it("不正な値はそのまま返す", () => {
    expect(formatWorkDate("")).toBe("");
    expect(formatWorkDate("2026-13-01")).toBe("2026-13-01");
    expect(weekdayJa("2026-13-01")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 点呼
// ---------------------------------------------------------------------------

describe("rollCallState", () => {
  it("業務前・業務後の記録から状態を決める", () => {
    expect(rollCallState(null)).toBe("none");
    expect(rollCallState({})).toBe("none");
    expect(rollCallState({ pre_at: "2026-09-18T00:00:00.000Z" })).toBe("pre");
    expect(rollCallState({ post_at: "2026-09-18T09:00:00.000Z" })).toBe("pre");
    expect(rollCallState({ pre_at: "2026-09-18T00:00:00.000Z", post_at: "2026-09-18T09:00:00.000Z" })).toBe("done");
  });
});

describe("alcoholOk", () => {
  it("0 なら true、0 より大きければ false、未測定は null", () => {
    expect(alcoholOk(0)).toBe(true);
    expect(alcoholOk(0.15)).toBe(false);
    expect(alcoholOk(9)).toBe(false);
    expect(alcoholOk(null)).toBeNull();
    expect(alcoholOk(undefined)).toBeNull();
  });

  it("文字列・全角でも判定できる", () => {
    expect(alcoholOk("0")).toBe(true);
    expect(alcoholOk("0.000")).toBe(true);
    expect(alcoholOk("0.15")).toBe(false);
    expect(alcoholOk("０．１５")).toBe(false);
    expect(alcoholOk("０")).toBe(true);
    expect(alcoholOk("")).toBeNull();
    expect(alcoholOk("  ")).toBeNull();
    expect(alcoholOk("あ")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 日別の稼働
// ---------------------------------------------------------------------------

const ENTRIES: DayEntryLike[] = [
  { id: "a", qty: 1, status: "approved" },
  { id: "b", qty: 2.5, status: "submitted" },
  { id: "c", qty: 3, status: "submitted" },
  { id: "d", qty: 4, status: "rejected" },
  { id: null, qty: 5, status: "submitted" },
];

describe("summarizeDay", () => {
  it("数量合計・案件数・状態ごとの件数を返す（差戻しは数量に入れない）", () => {
    expect(summarizeDay(ENTRIES)).toEqual({ qtyTotal: 11.5, itemCount: 5, submitted: 3, approved: 1, rejected: 1 });
  });

  it("空・null は 0", () => {
    expect(summarizeDay([])).toEqual({ qtyTotal: 0, itemCount: 0, submitted: 0, approved: 0, rejected: 0 });
    expect(summarizeDay(null)).toEqual({ qtyTotal: 0, itemCount: 0, submitted: 0, approved: 0, rejected: 0 });
  });

  it("qty が null の行は 0 として数える", () => {
    expect(summarizeDay([{ id: "x", qty: null, status: "submitted" }])).toEqual({ qtyTotal: 0, itemCount: 1, submitted: 1, approved: 0, rejected: 0 });
  });
});

describe("pendingIds", () => {
  it("承認待ちの id だけを返す（id が無い行は除く）", () => {
    expect(pendingIds(ENTRIES)).toEqual(["b", "c"]);
    expect(pendingIds([])).toEqual([]);
    expect(pendingIds(null)).toEqual([]);
  });
});

describe("canEditDate", () => {
  const today = "2026-09-18";

  it("今日から 14 日前までは編集できる", () => {
    expect(canEditDate(today, today)).toBe(true);
    expect(canEditDate("2026-09-04", today)).toBe(true); // ちょうど 14 日前
    expect(canEditDate("2026-09-03", today)).toBe(false); // 15 日前
    expect(EDIT_WINDOW_DAYS).toBe(14);
  });

  it("未来の日付は編集できない", () => {
    expect(canEditDate("2026-09-19", today)).toBe(false);
  });

  it("月またぎでも日数で判定する", () => {
    expect(canEditDate("2026-08-26", "2026-09-05")).toBe(true); // 10 日前
    expect(canEditDate("2026-08-20", "2026-09-05")).toBe(false); // 16 日前
    expect(canEditDate("2028-02-29", "2028-03-05")).toBe(true); // うるう年
  });

  it("締め済みの月は編集できない", () => {
    expect(canEditDate("2026-08-26", "2026-09-05", ["2026-08"])).toBe(false);
    expect(canEditDate("2026-09-05", "2026-09-05", ["2026-08"])).toBe(true);
  });

  it("不正な値は編集できない", () => {
    expect(canEditDate("", today)).toBe(false);
    expect(canEditDate(today, "")).toBe(false);
    expect(canEditDate("2026-02-30", today)).toBe(false);
  });
});

describe("dayProgress", () => {
  it("3 つそろうと done", () => {
    const report = { pre_at: "2026-09-18T00:00:00.000Z", post_at: "2026-09-18T09:00:00.000Z" };
    expect(dayProgress(report, [{ id: "a", qty: 1, status: "submitted" }])).toEqual({ pre: true, work: true, post: true, done: true });
  });

  it("差戻しだけなら稼働は未完了", () => {
    const report = { pre_at: "2026-09-18T00:00:00.000Z", post_at: "2026-09-18T09:00:00.000Z" };
    expect(dayProgress(report, [{ id: "a", qty: 1, status: "rejected" }])).toEqual({ pre: true, work: false, post: true, done: false });
  });

  it("日報が無ければすべて未完了", () => {
    expect(dayProgress(null, [])).toEqual({ pre: false, work: false, post: false, done: false });
  });
});

// ---------------------------------------------------------------------------
// zod スキーマ
// ---------------------------------------------------------------------------

describe("alcoholSchema", () => {
  it("0.000〜9.000 の 3 桁小数を受け付ける（全角・空欄可）", () => {
    expect(alcoholSchema.parse("0")).toBe(0);
    expect(alcoholSchema.parse("0.15")).toBe(0.15);
    expect(alcoholSchema.parse("０．１５")).toBe(0.15);
    expect(alcoholSchema.parse(0.125)).toBe(0.125);
    expect(alcoholSchema.parse("")).toBeNull();
    expect(alcoholSchema.parse(null)).toBeNull();
  });

  it("範囲外・小数 4 桁・文字は拒否する", () => {
    expect(alcoholSchema.safeParse("9.5").success).toBe(false);
    expect(alcoholSchema.safeParse("-0.1").success).toBe(false);
    expect(alcoholSchema.safeParse("0.1234").success).toBe(false);
    expect(alcoholSchema.safeParse("あ").success).toBe(false);
  });
});

describe("distanceSchema / breakMinutesSchema / workDateSchema / localDateTimeSchema", () => {
  it("走行距離は小数 1 桁まで", () => {
    expect(distanceSchema.parse("120.5")).toBe(120.5);
    expect(distanceSchema.parse("１２０")).toBe(120);
    expect(distanceSchema.parse("")).toBeNull();
    expect(distanceSchema.safeParse("120.55").success).toBe(false);
    expect(distanceSchema.safeParse("-1").success).toBe(false);
  });

  it("休憩は 0〜1440 分の整数", () => {
    expect(breakMinutesSchema.parse("60")).toBe(60);
    expect(breakMinutesSchema.parse(0)).toBe(0);
    expect(breakMinutesSchema.safeParse("1441").success).toBe(false);
    expect(breakMinutesSchema.safeParse("30.5").success).toBe(false);
  });

  it("日付・時刻の形式", () => {
    expect(workDateSchema.parse("2026-09-18")).toBe("2026-09-18");
    expect(workDateSchema.safeParse("2027-02-29").success).toBe(false);
    expect(localDateTimeSchema.parse("")).toBe(""); // 空欄は「今」
    expect(localDateTimeSchema.parse("2026-09-18T09:30")).toBe("2026-09-18T09:30");
    expect(localDateTimeSchema.safeParse("2026-09-18 09:30").success).toBe(false);
  });
});

describe("dailyReportInputSchema", () => {
  it("業務前点呼だけを部分的に更新できる", () => {
    const v = dailyReportInputSchema.parse({
      work_date: "2026-09-18",
      pre: { at: "", alcohol: "0", health_ok: true, inspection_ok: true, method: "app" },
    });
    expect(v.pre).toEqual({ at: "", alcohol: 0, health_ok: true, inspection_ok: true, method: "app" });
    expect(v.post).toBeUndefined();
    expect(v.work).toBeUndefined();
    expect(v.vehicle_id).toBeUndefined();
  });

  it("車両の空欄は null（指定を外す）", () => {
    const v = dailyReportInputSchema.parse({ work_date: "2026-09-18", vehicle_id: "" });
    expect(v.vehicle_id).toBeNull();
  });

  it("業務記録は数値を正規化する", () => {
    const v = dailyReportInputSchema.parse({
      work_date: "2026-09-18",
      work: { start: "2026-09-18T08:00", break_minutes: "60", distance_km: "１２０．５", memo: " 備考 " },
    });
    expect(v.work).toEqual({ start: "2026-09-18T08:00", break_minutes: 60, distance_km: 120.5, memo: "備考" });
  });

  it("何も渡さなければエラー", () => {
    expect(dailyReportInputSchema.safeParse({ work_date: "2026-09-18" }).success).toBe(false);
  });

  it("不正な日付・方法はエラー", () => {
    expect(dailyReportInputSchema.safeParse({ work_date: "2026-09-31", pre: { at: "" } }).success).toBe(false);
    expect(dailyReportInputSchema.safeParse({ work_date: "2026-09-18", pre: { method: "mail" } }).success).toBe(false);
  });
});

describe("submitDayEntriesSchema", () => {
  it("数量を正規化する（全角・カンマ可）", () => {
    const v = submitDayEntriesSchema.parse({
      work_date: "2026-09-18",
      rows: [
        { project_item_id: UUID_A, qty: "１０" },
        { project_item_id: UUID_B, qty: "1,200" },
      ],
    });
    expect(v.rows.map((r) => r.qty)).toEqual([10, 1200]);
    expect(v.memo).toBe("");
    expect(v.driver_id).toBeUndefined();
  });

  it("0 も受け付ける（削除のため）", () => {
    expect(submitDayEntriesSchema.parse({ work_date: "2026-09-18", rows: [{ project_item_id: UUID_A, qty: 0 }] }).rows[0].qty).toBe(0);
  });

  it("同じ案件内容が重複していればエラー", () => {
    const res = submitDayEntriesSchema.safeParse({
      work_date: "2026-09-18",
      rows: [
        { project_item_id: UUID_A, qty: 1 },
        { project_item_id: UUID_A, qty: 2 },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("空・マイナス・不正な ID はエラー", () => {
    expect(submitDayEntriesSchema.safeParse({ work_date: "2026-09-18", rows: [] }).success).toBe(false);
    expect(submitDayEntriesSchema.safeParse({ work_date: "2026-09-18", rows: [{ project_item_id: UUID_A, qty: "-1" }] }).success).toBe(false);
    expect(submitDayEntriesSchema.safeParse({ work_date: "2026-09-18", rows: [{ project_item_id: "x", qty: 1 }] }).success).toBe(false);
  });
});

describe("approveDayEntriesSchema / applyDayEntriesSchema / dayTabFromParam", () => {
  it("承認は理由が無くてもよい", () => {
    const v = approveDayEntriesSchema.parse({ ids: [UUID_A], approve: true });
    expect(v).toEqual({ ids: [UUID_A], approve: true, reason: "" });
  });

  it("差戻しは理由が必要", () => {
    expect(approveDayEntriesSchema.safeParse({ ids: [UUID_A], approve: false }).success).toBe(false);
    expect(approveDayEntriesSchema.safeParse({ ids: [UUID_A], approve: false, reason: " " }).success).toBe(false);
    expect(approveDayEntriesSchema.parse({ ids: [UUID_A], approve: false, reason: "件数が違います" }).reason).toBe("件数が違います");
  });

  it("対象が空ならエラー", () => {
    expect(approveDayEntriesSchema.safeParse({ ids: [], approve: true }).success).toBe(false);
  });

  it("月の形式", () => {
    expect(applyDayEntriesSchema.parse({ month: "2026-09" }).month).toBe("2026-09");
    expect(applyDayEntriesSchema.safeParse({ month: "2026-13" }).success).toBe(false);
  });

  it("タブは reports / entries のみ", () => {
    expect(dayTabFromParam("entries")).toBe("entries");
    expect(dayTabFromParam("reports")).toBe("reports");
    expect(dayTabFromParam(undefined)).toBe("reports");
    expect(dayTabFromParam("x")).toBe("reports");
    expect(dayTabFromParam(["entries"])).toBe("entries");
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const REPORT_ROW: DailyReportCsvSource = {
  work_date: "2026-09-18",
  driver_name: "山田 太郎",
  vehicle_plate: "品川 800 あ 12-34",
  pre_at: "2026-09-18T00:30:00.000Z",
  pre_method: "face",
  pre_alcohol: 0,
  pre_health_ok: true,
  pre_inspection_ok: true,
  pre_instruction: "雨天のため速度に注意",
  post_at: "2026-09-18T09:00:00.000Z",
  post_method: "phone",
  post_alcohol: 0.15,
  post_condition_ok: false,
  post_incident: "縁石に接触",
  start_at: "2026-09-18T00:00:00.000Z",
  end_at: "2026-09-18T09:30:00.000Z",
  break_minutes: 60,
  distance_km: 120.5,
  qty_total: 2,
  memo: "備考, テスト",
  pre_by_name: "管理者",
  post_by_name: "山田 太郎（本人）",
};

const ENTRY_ROW: DayEntryCsvSource = {
  work_date: "2026-09-18",
  driver_name: "山田 太郎",
  project_name: "Amazon 配送",
  item_name: "通常便",
  unit: "day",
  qty: 1,
  source: "driver",
  status: "approved",
  reject_reason: "",
  approved_at: "2026-09-18T10:00:00.000Z",
  memo: "",
  approved_by_name: "管理者",
};

describe("boolText / jstTimestampText", () => {
  it("○ × 空欄で表す", () => {
    expect(boolText(true)).toBe("○");
    expect(boolText(false)).toBe("×");
    expect(boolText(null)).toBe("");
    expect(boolText(undefined)).toBe("");
  });

  it("日本時間の日時にする", () => {
    expect(jstTimestampText("2026-09-18T00:30:00.000Z")).toBe("2026-09-18 09:30");
    expect(jstTimestampText(null)).toBe("");
  });
});

describe("点呼記録簿 CSV", () => {
  it("列の数と並びがヘッダーと合う", () => {
    const row = dailyReportToCsvRow(REPORT_ROW);
    expect(row).toHaveLength(DAILY_REPORT_CSV_HEADERS.length);
    expect(row[0]).toBe("2026-09-18");
    expect(row[3]).toBe("2026-09-18 09:30");
    expect(row[4]).toBe("対面");
    expect(row[5]).toBe("0");
    expect(row[6]).toBe("○");
    expect(row[9]).toBe("管理者");
    expect(row[12]).toBe("0.15");
    expect(row[13]).toBe("×");
    expect(row[19]).toBe("120.5");
  });

  it("BOM・CRLF 付きで出力する", () => {
    const csv = toDailyReportsCsv([REPORT_ROW]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain('"備考, テスト"'); // カンマは引用符で囲む
    expect(csv.split("\r\n")[0]).toBe(`${CSV_BOM}${DAILY_REPORT_CSV_HEADERS.join(",")}`);
  });

  it("未入力の点呼は空欄になる", () => {
    const row = dailyReportToCsvRow({ ...REPORT_ROW, pre_at: null, pre_method: null, pre_alcohol: null, pre_health_ok: null, pre_by_name: "" });
    expect(row[3]).toBe("");
    expect(row[4]).toBe("");
    expect(row[5]).toBe("");
    expect(row[6]).toBe("");
    expect(row[9]).toBe("");
  });
});

describe("日別の稼働 CSV", () => {
  it("列の数と並びがヘッダーと合う", () => {
    const row = dayEntryToCsvRow(ENTRY_ROW);
    expect(row).toHaveLength(DAY_ENTRY_CSV_HEADERS.length);
    expect(row[4]).toBe("日給");
    expect(row[5]).toBe("1");
    expect(row[6]).toBe("ドライバー報告");
    expect(row[7]).toBe("承認済み");
    expect(row[9]).toBe("管理者");
    expect(row[10]).toBe("2026-09-18 19:00");
  });

  it("ヘッダー行付きで出力する", () => {
    const csv = toDayEntriesCsv([ENTRY_ROW]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.split("\r\n")[0]).toBe(`${CSV_BOM}${DAY_ENTRY_CSV_HEADERS.join(",")}`);
    expect(csv.split("\r\n")[1]).toContain("Amazon 配送");
  });
});

describe("CSV の URL・ファイル名・種類", () => {
  it("?kind= を読む", () => {
    expect(dailyCsvKindFromParam("entry")).toBe("entry");
    expect(dailyCsvKindFromParam("report")).toBe("report");
    expect(dailyCsvKindFromParam(null)).toBe("report");
    expect(dailyCsvKindFromParam("x")).toBe("report");
  });

  it("ファイル名と URL", () => {
    expect(dailyCsvFilename("2026-09")).toBe("点呼記録簿_2026-09.csv");
    expect(dailyCsvFilename("2026-09", "entry")).toBe("日別の稼働_2026-09.csv");
    expect(dailyCsvFilename("全期間", "entry")).toBe("日別の稼働_全期間.csv");
    expect(dailyCsvUrl("2026-09")).toBe("/api/export/daily.csv?m=2026-09&kind=report");
    expect(dailyCsvUrl("2026-09", "entry")).toBe("/api/export/daily.csv?m=2026-09&kind=entry");
    expect(dailyCsvUrl("all", "entry")).toBe("/api/export/daily.csv?m=all&kind=entry");
  });
});
