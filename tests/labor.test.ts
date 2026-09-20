import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABOR_STANDARDS,
  attentionDays,
  formatMinutes,
  hoursToMinutes,
  isAttentionDay,
  laborActionLine,
  laborAdvice,
  laborAdviceLines,
  laborRiskLevel,
  laborTone,
  minutesToHours,
  minutesToHoursInput,
  monthLaborSummary,
  requiredBreakMinutes,
  summaryRiskLevel,
  type DailyLaborLike,
  type MonthLaborLike,
} from "@/lib/labor/helpers";
import { laborSettingsSchema, laborSettingsToColumns, laborSettingsToForm, DEFAULT_LABOR_SETTINGS_FORM } from "@/lib/schemas/company";
import { laborCsvFilename, laborCsvKindFromParam, laborDaysCsvRows, laborMonthsCsvRows, LABOR_DAY_CSV_HEADERS, LABOR_MONTH_CSV_HEADERS } from "@/lib/exports/labor-csv";

/** 既定の基準（780 / 900 / 660 / 540）を持つ 1 日ぶんの行 */
function day(over: Partial<DailyLaborLike> = {}): DailyLaborLike {
  return {
    work_date: "2026-09-10",
    driver_id: "d1",
    break_minutes: 60,
    duty_minutes: 600,
    work_minutes: 540,
    rest_minutes: 720,
    consecutive_days: 3,
    labor_duty_limit_minutes: 780,
    labor_duty_max_minutes: 900,
    labor_rest_target_minutes: 660,
    labor_rest_min_minutes: 540,
    duty_status: "ok",
    rest_status: "ok",
    break_status: "ok",
    ...over,
  };
}

/** ドライバー × 月の 1 行 */
function monthRow(over: Partial<MonthLaborLike> = {}): MonthLaborLike {
  return {
    driver_id: "d1",
    driver_name: "山田",
    report_days: 20,
    measured_days: 20,
    duty_minutes_total: 12000,
    duty_minutes_avg: 600,
    duty_minutes_max: 700,
    work_minutes_total: 10800,
    distance_km_total: 2000,
    over_duty_days: 0,
    severe_duty_days: 0,
    short_rest_days: 0,
    severe_rest_days: 0,
    short_break_days: 0,
    max_consecutive_days: 5,
    labor_month_duty_minutes: 17040,
    labor_max_consecutive_days: 13,
    month_duty_over: false,
    consecutive_over: false,
    ...over,
  };
}

describe("formatMinutes（分を「13 時間 20 分」に）", () => {
  it("800 分は「13 時間 20 分」になる", () => {
    expect(formatMinutes(800)).toBe("13 時間 20 分");
  });

  it("ちょうど 780 分（13 時間）は分を付けない", () => {
    expect(formatMinutes(780)).toBe("13 時間");
  });

  it("ちょうど 540 分（9 時間）は分を付けない", () => {
    expect(formatMinutes(540)).toBe("9 時間");
  });

  it("1 時間未満は分だけで出す", () => {
    expect(formatMinutes(45)).toBe("45 分");
  });

  it("0 分は「0 分」と出す（「—」にしない）", () => {
    expect(formatMinutes(0)).toBe("0 分");
  });

  it("null は「—」になる", () => {
    expect(formatMinutes(null)).toBe("—");
  });

  it("undefined も「—」になる", () => {
    expect(formatMinutes(undefined)).toBe("—");
  });

  it("数値にならない値（NaN）は「—」になる", () => {
    expect(formatMinutes(Number.NaN)).toBe("—");
  });

  it("負の値は先頭に - を付ける", () => {
    expect(formatMinutes(-90)).toBe("-1 時間 30 分");
    expect(formatMinutes(-30)).toBe("-30 分");
  });

  it("小数は分の単位に四捨五入する", () => {
    expect(formatMinutes(90.4)).toBe("1 時間 30 分");
    expect(formatMinutes(89.6)).toBe("1 時間 30 分");
  });
});

describe("時間と分の行き来", () => {
  it("780 分は 13 時間になる", () => {
    expect(minutesToHours(780)).toBe(13);
    expect(minutesToHoursInput(780)).toBe("13");
  });

  it("810 分は 13.5 時間になる", () => {
    expect(minutesToHours(810)).toBe(13.5);
    expect(minutesToHoursInput(810)).toBe("13.5");
  });

  it("13.5 時間は 810 分になる", () => {
    expect(hoursToMinutes(13.5)).toBe(810);
  });

  it("null はどちらも null（入力欄は空欄）", () => {
    expect(minutesToHours(null)).toBeNull();
    expect(hoursToMinutes(null)).toBeNull();
    expect(minutesToHoursInput(null)).toBe("");
  });
});

describe("requiredBreakMinutes（休憩の目安）", () => {
  it("実働ちょうど 360 分（6 時間）までは休憩の義務なし", () => {
    expect(requiredBreakMinutes(360)).toBe(0);
  });

  it("実働 6 時間超は 45 分", () => {
    expect(requiredBreakMinutes(361)).toBe(45);
    expect(requiredBreakMinutes(480)).toBe(45);
  });

  it("実働 8 時間超は 60 分", () => {
    expect(requiredBreakMinutes(481)).toBe(60);
  });

  it("実働が不明なら 0", () => {
    expect(requiredBreakMinutes(null)).toBe(0);
  });
});

describe("laborTone（判定の色とラベル）", () => {
  it("ok は通常の色で「問題なし」", () => {
    expect(laborTone("ok")).toEqual({ tone: "normal", label: "問題なし" });
  });

  it("over は注意の色で、拘束のラベルは「長い」", () => {
    expect(laborTone("over", "duty")).toEqual({ tone: "warning", label: "長い" });
  });

  it("short は注意の色で、休息と休憩でラベルが変わる", () => {
    expect(laborTone("short", "rest")).toEqual({ tone: "warning", label: "やや短い" });
    expect(laborTone("short", "break")).toEqual({ tone: "warning", label: "不足" });
  });

  it("severe は危険の色になる", () => {
    expect(laborTone("severe", "duty").tone).toBe("danger");
    expect(laborTone("severe", "rest")).toEqual({ tone: "danger", label: "不足" });
  });

  it("unknown と null は薄い色（判定できない）", () => {
    expect(laborTone("unknown", "duty")).toEqual({ tone: "muted", label: "時刻の記録なし" });
    expect(laborTone(null, "rest")).toEqual({ tone: "muted", label: "前の稼働なし" });
  });

  it("知らない判定は薄い色で「—」", () => {
    expect(laborTone("whatever", "duty")).toEqual({ tone: "muted", label: "—" });
  });
});

describe("isAttentionDay（注意が必要な日）", () => {
  it("すべて ok なら注意は要らない", () => {
    expect(isAttentionDay(day())).toBe(false);
  });

  it("拘束が長い日は注意が必要", () => {
    expect(isAttentionDay(day({ duty_status: "over" }))).toBe(true);
  });

  it("休息が不足の日は注意が必要", () => {
    expect(isAttentionDay(day({ rest_status: "severe" }))).toBe(true);
  });

  it("休憩が足りない日は注意が必要", () => {
    expect(isAttentionDay(day({ break_status: "short" }))).toBe(true);
  });

  it("連続勤務が上限を超えた日は注意が必要", () => {
    expect(isAttentionDay(day({ consecutive_days: 14 }), 13)).toBe(true);
    expect(isAttentionDay(day({ consecutive_days: 13 }), 13)).toBe(false);
  });

  it("null の行は注意の対象にしない", () => {
    expect(isAttentionDay(null)).toBe(false);
  });

  it("attentionDays は注意が必要な日だけを残す", () => {
    const rows = [day(), day({ duty_status: "severe" }), day({ rest_status: "short" })];
    expect(attentionDays(rows)).toHaveLength(2);
    expect(attentionDays(null)).toEqual([]);
  });
});

describe("laborAdvice（その日の 1 行アドバイス）", () => {
  it("問題の無い日は何も言わない", () => {
    expect(laborAdvice(day())).toBe("");
  });

  it("休息が下限を下回った日は、翌日の開始を何時間遅らせればよいか出す", () => {
    const advice = laborAdvice(day({ rest_minutes: 420, rest_status: "severe" }));
    expect(advice).toBe("休息が 7 時間です。翌日の開始を 2 時間遅らせると 9 時間を確保できます。");
  });

  it("休息がちょうど 540 分（下限と同じ）なら目安までの不足だけを言う", () => {
    const advice = laborAdvice(day({ rest_minutes: 540, rest_status: "short" }));
    expect(advice).toBe("休息が 9 時間です。あと 2 時間空けると目安の 11 時間になります。");
  });

  it("拘束が目安（780 分）ちょうどの日は何も言わない", () => {
    expect(laborAdvice(day({ duty_minutes: 780, duty_status: "ok" }))).toBe("");
  });

  it("拘束が目安を超えた日は、超えた分を数字で出す", () => {
    const advice = laborAdvice(day({ duty_minutes: 840, duty_status: "over" }));
    expect(advice).toContain("拘束が 14 時間");
    expect(advice).toContain("目安の 13 時間");
    expect(advice).toContain("1 時間超えています");
  });

  it("拘束が上限を超えた日は、上限との差を出す", () => {
    const advice = laborAdvice(day({ duty_minutes: 960, duty_status: "severe" }));
    expect(advice).toContain("上限の 15 時間");
    expect(advice).toContain("1 時間超えています");
  });

  it("休息と拘束の両方が悪い日は、休息のほうを先に言う", () => {
    const row = day({ rest_minutes: 420, rest_status: "severe", duty_minutes: 960, duty_status: "severe" });
    expect(laborAdvice(row).startsWith("休息が")).toBe(true);
    expect(laborAdviceLines(row)).toHaveLength(2);
  });

  it("休憩が足りない日は、あと何分取ればよいか出す", () => {
    const advice = laborAdvice(day({ work_minutes: 540, break_minutes: 30, break_status: "short" }));
    expect(advice).toBe("実働 9 時間に対して休憩が 30 分です。あと 30 分休憩を取ってください。");
  });

  it("連続勤務が上限を超えた日は、日数を出して休みを促す", () => {
    const advice = laborAdvice(day({ consecutive_days: 15 }), 13);
    expect(advice).toBe("連続勤務が 15 日目です。上限の 13 日を超えているので、すぐに休みを入れてください。");
  });

  it("行が null なら空文字（アドバイスなし）", () => {
    expect(laborAdvice(null)).toBe("");
    expect(laborAdviceLines(undefined)).toEqual([]);
  });

  it("時刻の記録が無い日（unknown）は何も言わない", () => {
    const row = day({ duty_minutes: null, work_minutes: null, rest_minutes: null, duty_status: "unknown", rest_status: "unknown", break_status: "unknown" });
    expect(laborAdvice(row)).toBe("");
  });
});

describe("monthLaborSummary（月の合計）", () => {
  it("行が無ければすべて 0", () => {
    const s = monthLaborSummary([]);
    expect(s.driverCount).toBe(0);
    expect(s.measuredDays).toBe(0);
    expect(s.dutyMinutesTotal).toBe(0);
    expect(s.dutyMinutesAvg).toBe(0);
  });

  it("null / undefined を渡しても落ちない", () => {
    expect(monthLaborSummary(null).driverCount).toBe(0);
    expect(monthLaborSummary(undefined).dutyMinutesAvg).toBe(0);
  });

  it("ドライバー 2 人ぶんを足し合わせる", () => {
    const s = monthLaborSummary([monthRow(), monthRow({ driver_id: "d2", measured_days: 10, duty_minutes_total: 6000, duty_minutes_max: 900 })]);
    expect(s.driverCount).toBe(2);
    expect(s.measuredDays).toBe(30);
    expect(s.dutyMinutesTotal).toBe(18000);
    expect(s.dutyMinutesMax).toBe(900);
  });

  it("平均は対象日数で割って四捨五入する", () => {
    const s = monthLaborSummary([monthRow({ measured_days: 3, duty_minutes_total: 1000 })]);
    expect(s.dutyMinutesAvg).toBe(333);
  });

  it("対象日数が 0 のときの平均は 0（0 除算にしない）", () => {
    const s = monthLaborSummary([monthRow({ measured_days: 0, duty_minutes_total: 0 })]);
    expect(s.dutyMinutesAvg).toBe(0);
  });

  it("長い拘束の日数は「目安超」と「上限超」を合わせて数える", () => {
    const s = monthLaborSummary([monthRow({ over_duty_days: 2, severe_duty_days: 1 })]);
    expect(s.overDutyDays).toBe(3);
    expect(s.severeDutyDays).toBe(1);
  });

  it("休息不足の日数も「目安割れ」と「下限割れ」を合わせて数える", () => {
    const s = monthLaborSummary([monthRow({ short_rest_days: 4, severe_rest_days: 2 })]);
    expect(s.shortRestDays).toBe(6);
    expect(s.severeRestDays).toBe(2);
  });

  it("連続勤務は最大値を取り、上限超のドライバー数も数える", () => {
    const s = monthLaborSummary([monthRow({ max_consecutive_days: 6 }), monthRow({ driver_id: "d2", max_consecutive_days: 14, consecutive_over: true })]);
    expect(s.maxConsecutiveDays).toBe(14);
    expect(s.consecutiveOverDrivers).toBe(1);
  });

  it("月またぎ：同じドライバーの 2 か月ぶんを渡しても合計できる（連続勤務は最大を取る）", () => {
    const s = monthLaborSummary([
      monthRow({ measured_days: 20, duty_minutes_total: 12000, max_consecutive_days: 13 }),
      monthRow({ measured_days: 18, duty_minutes_total: 11000, max_consecutive_days: 16, consecutive_over: true }),
    ]);
    expect(s.measuredDays).toBe(38);
    expect(s.dutyMinutesTotal).toBe(23000);
    expect(s.maxConsecutiveDays).toBe(16);
    expect(s.consecutiveOverDrivers).toBe(1);
  });
});

describe("laborRiskLevel（良好 / 注意 / 危険）", () => {
  it("超過が無ければ良好で、理由は空", () => {
    const r = laborRiskLevel(monthRow());
    expect(r.level).toBe("good");
    expect(r.label).toBe("良好");
    expect(r.reasons).toEqual([]);
  });

  it("拘束が目安を超えた日があると注意", () => {
    const r = laborRiskLevel(monthRow({ over_duty_days: 2 }));
    expect(r.level).toBe("caution");
    expect(r.label).toBe("注意");
    expect(r.summary).toContain("2 日");
  });

  it("休憩が足りない日があるだけでも注意", () => {
    expect(laborRiskLevel(monthRow({ short_break_days: 1 })).level).toBe("caution");
  });

  it("拘束が上限を超えた日があると危険", () => {
    const r = laborRiskLevel(monthRow({ severe_duty_days: 1 }));
    expect(r.level).toBe("danger");
    expect(r.label).toBe("危険");
  });

  it("休息が下限を下回った日があると危険で、理由の先頭に休息が来る", () => {
    const r = laborRiskLevel(monthRow({ severe_rest_days: 3, severe_duty_days: 1 }));
    expect(r.level).toBe("danger");
    expect(r.reasons[0]).toContain("休息");
  });

  it("1 か月の拘束が上限を超えると危険（時間を数字で出す）", () => {
    const r = laborRiskLevel(monthRow({ duty_minutes_total: 18000, month_duty_over: true }));
    expect(r.level).toBe("danger");
    expect(r.summary).toContain("300 時間");
    expect(r.summary).toContain("284 時間");
  });

  it("連続勤務が上限を超えると危険", () => {
    const r = laborRiskLevel(monthRow({ max_consecutive_days: 14, consecutive_over: true }));
    expect(r.level).toBe("danger");
    expect(r.summary).toContain("14 日");
  });

  it("月の判定（month_duty_over）が無い行は、合計と上限から自分で判定する", () => {
    const r = laborRiskLevel(monthRow({ duty_minutes_total: 20000, month_duty_over: null }));
    expect(r.level).toBe("danger");
  });

  it("null を渡しても良好（落ちない）", () => {
    expect(laborRiskLevel(null).level).toBe("good");
  });
});

describe("summaryRiskLevel と laborActionLine（月ぜんたい）", () => {
  it("対象日数が 0 なら良好で、次の一手も出さない", () => {
    const r = summaryRiskLevel(monthLaborSummary([]));
    expect(r.level).toBe("good");
    expect(laborActionLine(r)).toBe("");
  });

  it("上限超のドライバーが居ると危険で、次の一手を 1 行出す", () => {
    const r = summaryRiskLevel(monthLaborSummary([monthRow({ severe_duty_days: 1 })]));
    expect(r.level).toBe("danger");
    expect(laborActionLine(r)).toContain("翌日の開始を遅らせ");
  });

  it("目安超だけなら注意で、注意向けの一手を出す", () => {
    const r = summaryRiskLevel(monthLaborSummary([monthRow({ over_duty_days: 1 })]));
    expect(r.level).toBe("caution");
    expect(laborActionLine(r)).toContain("終了を早める");
  });

  it("1 か月の拘束が上限超のドライバーが居ると人数で出す", () => {
    const r = summaryRiskLevel(monthLaborSummary([monthRow({ month_duty_over: true })]));
    expect(r.level).toBe("danger");
    expect(r.summary).toContain("1 人");
  });
});

describe("労務の基準の入力（時間 → 分）", () => {
  it("時間で入れた値が分になる", () => {
    const parsed = laborSettingsSchema.parse(DEFAULT_LABOR_SETTINGS_FORM);
    expect(laborSettingsToColumns(parsed)).toEqual(DEFAULT_LABOR_STANDARDS);
  });

  it("全角の数字でも受け付ける", () => {
    const parsed = laborSettingsSchema.parse({ ...DEFAULT_LABOR_SETTINGS_FORM, labor_duty_limit_hours: "１３" });
    expect(parsed.labor_duty_limit_hours).toBe(780);
  });

  it("0.5 時間（30 分）まで入れられる", () => {
    const parsed = laborSettingsSchema.parse({ ...DEFAULT_LABOR_SETTINGS_FORM, labor_duty_limit_hours: "13.5" });
    expect(parsed.labor_duty_limit_hours).toBe(810);
  });

  it("上限が目安より短いと日本語のエラーになる", () => {
    const res = laborSettingsSchema.safeParse({ ...DEFAULT_LABOR_SETTINGS_FORM, labor_duty_max_hours: "12" });
    expect(res.success).toBe(false);
    const issue = res.success ? null : res.error.issues.find((i) => i.path[0] === "labor_duty_max_hours");
    expect(issue?.message).toBe("1 日の拘束時間の上限は、目安（13 時間）以上で入力してください");
  });

  it("上限と目安が同じ値なら通る", () => {
    expect(laborSettingsSchema.safeParse({ ...DEFAULT_LABOR_SETTINGS_FORM, labor_duty_max_hours: "13" }).success).toBe(true);
  });

  it("休息の下限が目安より長いと日本語のエラーになる", () => {
    const res = laborSettingsSchema.safeParse({ ...DEFAULT_LABOR_SETTINGS_FORM, labor_rest_min_hours: "12" });
    expect(res.success).toBe(false);
    const issue = res.success ? null : res.error.issues.find((i) => i.path[0] === "labor_rest_min_hours");
    expect(issue?.message).toBe("休息期間の下限は、目安（11 時間）以下で入力してください");
  });

  it("空欄・24 時間超・0 日は受け付けない", () => {
    expect(laborSettingsSchema.safeParse({ ...DEFAULT_LABOR_SETTINGS_FORM, labor_duty_limit_hours: "" }).success).toBe(false);
    expect(laborSettingsSchema.safeParse({ ...DEFAULT_LABOR_SETTINGS_FORM, labor_duty_max_hours: "25" }).success).toBe(false);
    expect(laborSettingsSchema.safeParse({ ...DEFAULT_LABOR_SETTINGS_FORM, labor_max_consecutive_days: "0" }).success).toBe(false);
  });

  it("負の値は受け付けない", () => {
    expect(laborSettingsSchema.safeParse({ ...DEFAULT_LABOR_SETTINGS_FORM, labor_duty_limit_hours: "-13" }).success).toBe(false);
  });

  it("保存済みの分はフォームの時間に戻る（往復しても同じ）", () => {
    expect(laborSettingsToForm(DEFAULT_LABOR_STANDARDS)).toEqual(DEFAULT_LABOR_SETTINGS_FORM);
    expect(laborSettingsToForm(null).labor_duty_limit_hours).toBe("13");
    expect(laborSettingsToForm({ labor_duty_limit_minutes: 810 }).labor_duty_limit_hours).toBe("13.5");
  });
});

describe("労務 CSV", () => {
  it("?kind= は day / month だけを受け付ける（既定は day）", () => {
    expect(laborCsvKindFromParam("month")).toBe("month");
    expect(laborCsvKindFromParam("day")).toBe("day");
    expect(laborCsvKindFromParam("xxx")).toBe("day");
    expect(laborCsvKindFromParam(null)).toBe("day");
  });

  it("ファイル名は日別・月別で分かれる", () => {
    expect(laborCsvFilename("2026-09", "day")).toBe("労務_日別_2026-09.csv");
    expect(laborCsvFilename("2026-09", "month")).toBe("労務_月別_2026-09.csv");
  });

  it("日ごとの行は見出しに続き、時間を分のまま出す", () => {
    const rows = laborDaysCsvRows([
      {
        work_date: "2026-09-10",
        driver_name: "山田",
        start_at: "2026-09-09T23:00:00.000Z",
        end_at: "2026-09-10T09:00:00.000Z",
        duty_minutes: 600,
        break_minutes: 60,
        work_minutes: 540,
        rest_minutes: 420,
        consecutive_days: 3,
        duty_status: "ok",
        rest_status: "severe",
        break_status: "ok",
      },
    ]);
    expect(rows[0]).toEqual([...LABOR_DAY_CSV_HEADERS]);
    expect(rows[1][1]).toBe("山田");
    expect(rows[1][2]).toBe("2026-09-10 08:00");
    expect(rows[1][4]).toBe("600");
    expect(rows[1][10]).toBe("不足");
  });

  it("月ごとの行は稼動月を YYYY-MM にし、判定を日本語で出す", () => {
    const rows = laborMonthsCsvRows([
      {
        month: "2026-09-01",
        driver_name: "山田",
        report_days: 20,
        measured_days: 20,
        duty_minutes_total: 12000,
        duty_minutes_avg: 600,
        duty_minutes_max: 700,
        work_minutes_total: 10800,
        distance_km_total: 2000,
        over_duty_days: 0,
        severe_duty_days: 1,
        short_rest_days: 0,
        severe_rest_days: 0,
        short_break_days: 0,
        max_consecutive_days: 5,
        labor_month_duty_minutes: 17040,
        labor_max_consecutive_days: 13,
        month_duty_over: false,
        consecutive_over: false,
      },
    ]);
    expect(rows[0]).toEqual([...LABOR_MONTH_CSV_HEADERS]);
    expect(rows[1][0]).toBe("2026-09");
    expect(rows[1][rows[1].length - 1]).toBe("危険");
  });
});
