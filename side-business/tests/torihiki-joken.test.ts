import { describe, expect, it } from "vitest";
import {
  BLANK,
  adjustForBankHoliday,
  bankHolidayReason,
  buildTorihikiJoken,
  closingPeriodText,
  dayInMonth,
  isBankHoliday,
  isDateString,
  latestSafePayRule,
  payRuleLabel,
  paymentDeadlineCheck,
  shortDate,
  sixtyDayLimit,
  torihikiPlainText,
  validateDeadlineInput,
  type DayOfMonth,
  type PayMonthOffset,
  type TorihikiInput,
} from "@/lib/tools/torihiki-joken";
import { JP_HOLIDAYS, JP_HOLIDAYS_THROUGH, isJpHoliday, jpHolidayName } from "@/lib/tools/jp-holidays";

const FROM = "2026-10-01";

describe("60日（2か月）の期限", () => {
  it("初日を1日目として60日目と、2か月の終わりの遅い方", () => {
    // 月末締めなら翌月末日まで（公取委・中企庁の資料の例と同じ）
    expect(sixtyDayLimit("2026-08-01")).toBe("2026-09-30");
    // 31日の月も1か月と数える（60日目は 8/29 だが、2か月の終わりの 8/31 まで）
    expect(sixtyDayLimit("2027-07-01")).toBe("2027-08-31");
    // 2か月の終わりより60日目の方が遅いときは60日目
    expect(sixtyDayLimit("2027-01-01")).toBe("2027-03-01");
    // 2か月後の同じ日の前日
    expect(sixtyDayLimit("2026-07-21")).toBe("2026-09-20");
    expect(sixtyDayLimit("2026-08-31")).toBe("2026-10-30");
    // 2か月後に同じ日が無ければその月の末日
    expect(sixtyDayLimit("2026-12-31")).toBe("2027-02-28");
  });

  it("日付の道具", () => {
    expect(dayInMonth(2027, 2, 30)).toBe("2027-02-28");
    expect(dayInMonth(2028, 2, "末")).toBe("2028-02-29");
    expect(isDateString("2026-02-29")).toBe(false);
    expect(isDateString("2028-02-29")).toBe(true);
    expect(isDateString("")).toBe(false);
    expect(shortDate("2026-10-30")).toBe("10/30(金)");
  });

  it("銀行の休みの日（土日と年末年始）", () => {
    expect(isBankHoliday("2026-10-31")).toBe(true); // 土
    expect(isBankHoliday("2026-12-31")).toBe(true); // 木（年末）
    expect(isBankHoliday("2027-01-04")).toBe(false); // 月
    expect(adjustForBankHoliday("2026-10-31", "before")).toBe("2026-10-30");
    expect(adjustForBankHoliday("2026-12-31", "after")).toBe("2027-01-04");
    expect(adjustForBankHoliday("2027-01-02", "before")).toBe("2026-12-30");
  });

  it("祝日と休日（振替休日・国民の休日）も銀行の休みの日", () => {
    expect(isBankHoliday("2027-09-20")).toBe(true); // 敬老の日（月）
    expect(isBankHoliday("2028-01-10")).toBe(true); // 成人の日（月）
    expect(isBankHoliday("2026-09-22")).toBe(true); // 国民の休日（火）
    expect(isBankHoliday("2027-03-22")).toBe(true); // 春分の日の振替休日（月）
    expect(isBankHoliday("2026-11-24")).toBe(false); // 火
    expect(adjustForBankHoliday("2026-11-23", "before")).toBe("2026-11-20"); // 勤労感謝の日（月）→ 金
    expect(adjustForBankHoliday("2026-09-23", "before")).toBe("2026-09-18"); // 秋分の日 → 国民の休日 → 敬老の日 → 土日 → 金
    expect(adjustForBankHoliday("2026-09-21", "after")).toBe("2026-09-24");
    expect(bankHolidayReason("2026-10-31")).toBe("土曜日");
    expect(bankHolidayReason("2027-01-31")).toBe("日曜日");
    expect(bankHolidayReason("2027-09-20")).toBe("敬老の日");
    expect(bankHolidayReason("2026-12-31")).toBe("年末年始");
    expect(bankHolidayReason("2026-11-25")).toBeNull();
  });

  it("祝日の表：2026年は内閣府の一覧と同じ 18 日。どの年も " + JP_HOLIDAYS_THROUGH + " 年まで入っていて、日付の形が正しい", () => {
    const y2026 = Object.keys(JP_HOLIDAYS).filter((d) => d.startsWith("2026-"));
    expect(y2026).toEqual([
      "2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-03", "2026-05-04", "2026-05-05",
      "2026-05-06", "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
    ]);
    for (let y = 2025; y <= JP_HOLIDAYS_THROUGH; y++) {
      const days = Object.keys(JP_HOLIDAYS).filter((d) => d.startsWith(`${y}-`));
      expect(days.length).toBeGreaterThanOrEqual(16);
      expect(days).toContain(`${y}-01-01`);
    }
    for (const d of Object.keys(JP_HOLIDAYS)) expect(isDateString(d)).toBe(true);
    expect(isJpHoliday("2026-10-12")).toBe(true);
    expect(jpHolidayName("2026-10-12")).toBe("スポーツの日");
    expect(isJpHoliday("toString")).toBe(false);
  });
});

describe("支払期日の60日チェック", () => {
  it("月末締め・翌月末日払いは12か月すべて OK", () => {
    const r = paymentDeadlineCheck({ closingDay: "末", payMonthOffset: 1, payDay: "末", holidayRule: "before", serviceFrom: FROM });
    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.status).toBe("ok");
    expect(r.rows).toHaveLength(12);
    expect(r.ruleLabel).toBe("毎月末日締め・翌月末日払い");
    const first = r.rows[0];
    expect([first.periodStart, first.periodEnd, first.payDate]).toEqual(["2026-10-01", "2026-10-31", "2026-11-30"]);
    expect(first.daysFromEnd).toBe(30);
    // 7月1日の分を8月31日に払う（61日後）も、2か月以内なので OK
    const july = r.rows.find((row) => row.closingMonth === "2027-07")!;
    expect(july.daysFromStart).toBe(61);
    expect(july.status).toBe("ok");
    // 12月31日（年末）は前の営業日へ
    const nov = r.rows.find((row) => row.closingMonth === "2026-11")!;
    expect(nov.payDate).toBe("2026-12-31");
    expect(nov.payDateActual).toBe("2026-12-30");
    expect(nov.shifted).toBe(true);
  });

  it("休みの日を次の営業日にずらすと、2か月を超える月が出る", () => {
    const r = paymentDeadlineCheck({ closingDay: "末", payMonthOffset: 1, payDay: "末", holidayRule: "after", serviceFrom: FROM });
    expect(r.status).toBe("caution");
    const june = r.rows.find((row) => row.closingMonth === "2027-06")!;
    expect(june.payDate).toBe("2027-07-31"); // 土
    expect(june.payDateActual).toBe("2027-08-02");
    expect(june.status).toBe("caution");
  });

  it("20日締め・翌月末日払いは要注意（締め日から数えれば60日以内）", () => {
    const r = paymentDeadlineCheck({ closingDay: 20, payMonthOffset: 1, payDay: "末", holidayRule: "before", serviceFrom: FROM });
    expect(r.status).toBe("caution");
    expect(r.ok).toBe(false);
    expect(r.counts.ng).toBe(0);
    // 最初の期間は業務を始める日から
    expect(r.rows[0].periodStart).toBe("2026-10-01");
    expect(r.rows[0].status).toBe("ok");
    const row = r.rows[1];
    expect([row.periodStart, row.periodEnd]).toEqual(["2026-10-21", "2026-11-20"]);
    expect(row.limitFromStart).toBe("2026-12-20");
    expect(row.status).toBe("caution");
    expect(r.summary).toContain("締め日から数えれば");
  });

  it("月末締め・翌々月10日払いは要注意、翌々月末日払いは60日を超える", () => {
    const tenth = paymentDeadlineCheck({ closingDay: "末", payMonthOffset: 2, payDay: 10, holidayRule: "before", serviceFrom: FROM });
    expect(tenth.status).toBe("caution");
    expect(tenth.counts.caution).toBe(12);
    const end = paymentDeadlineCheck({ closingDay: "末", payMonthOffset: 2, payDay: "末", holidayRule: "before", serviceFrom: FROM });
    expect(end.status).toBe("ng");
    expect(end.counts.ng).toBeGreaterThan(0);
    expect(end.maxDaysFromEnd).toBeGreaterThan(60);
    expect(end.summary).toContain("支払日を早めてください");
  });

  it("15日締め・当月末日払いは OK", () => {
    const r = paymentDeadlineCheck({ closingDay: 15, payMonthOffset: 0, payDay: "末", holidayRule: "before", serviceFrom: FROM });
    expect(r.status).toBe("ok");
    expect(r.rows[1].periodStart).toBe("2026-10-16");
  });

  it("締め日が月末より大きい月（30日締めの2月）", () => {
    const r = paymentDeadlineCheck({ closingDay: 30, payMonthOffset: 1, payDay: "末", holidayRule: "before", serviceFrom: "2027-01-15" });
    const feb = r.rows.find((row) => row.closingMonth === "2027-02")!;
    expect([feb.periodStart, feb.periodEnd]).toEqual(["2027-01-31", "2027-02-28"]);
    const mar = r.rows.find((row) => row.closingMonth === "2027-03")!;
    expect([mar.periodStart, mar.periodEnd]).toEqual(["2027-03-01", "2027-03-30"]);
  });

  it("業務を始める日が締め日より後なら、翌月の締めから数える", () => {
    const r = paymentDeadlineCheck({ closingDay: 20, payMonthOffset: 1, payDay: 10, serviceFrom: "2026-10-25" });
    expect(r.rows[0].closingMonth).toBe("2026-11");
    expect(r.rows[0].periodStart).toBe("2026-10-25");
  });

  it("入力の誤り", () => {
    expect(validateDeadlineInput({ closingDay: 20, payMonthOffset: 0, payDay: 10 })).toContain("当月払い");
    expect(validateDeadlineInput({ closingDay: "末", payMonthOffset: 0, payDay: 30 })).toContain("当月払い");
    expect(validateDeadlineInput({ closingDay: 32, payMonthOffset: 1, payDay: 10 })).toBe("締め日を選んでください");
    expect(validateDeadlineInput({ closingDay: 20, payMonthOffset: 1, payDay: 10, serviceFrom: "2026-13-01" })).not.toBeNull();
    const r = paymentDeadlineCheck({ closingDay: 20, payMonthOffset: 0, payDay: 10, serviceFrom: FROM });
    expect(r.error).not.toBeNull();
    expect(r.rows).toHaveLength(0);
    expect(r.ok).toBe(false);
  });

  it("ページの例と記事の早見表（payment-60-days・freelance-law-japanpost）の判定と一致する", () => {
    const cases: [DayOfMonth, PayMonthOffset, DayOfMonth, string][] = [
      ["末", 1, 25, "ok"],
      ["末", 1, "末", "ok"],
      [15, 1, 15, "ok"],
      [20, 1, 10, "ok"],
      [20, 1, 20, "ok"],
      [15, 1, "末", "caution"],
      [20, 1, "末", "caution"],
      [25, 1, "末", "caution"],
      ["末", 2, 10, "caution"],
      [20, 2, 10, "caution"],
      [20, 2, 20, "ng"],
      ["末", 2, "末", "ng"],
    ];
    for (const [closingDay, payMonthOffset, payDay, expected] of cases) {
      const r = paymentDeadlineCheck({ closingDay, payMonthOffset, payDay, holidayRule: "before", serviceFrom: FROM });
      expect(`${r.ruleLabel}=${r.status}`).toBe(`${payRuleLabel(closingDay, payMonthOffset, payDay)}=${expected}`);
    }
  });

  it("OK になるいちばん遅い支払日", () => {
    expect(latestSafePayRule({ closingDay: 20, holidayRule: "before", serviceFrom: FROM })?.ruleLabel).toBe("毎月20日締め・翌月20日払い");
    expect(latestSafePayRule({ closingDay: "末", holidayRule: "before", serviceFrom: FROM })?.ruleLabel).toBe("毎月末日締め・翌月末日払い");
  });

  it("表示の言葉", () => {
    expect(payRuleLabel(20, 2, 10)).toBe("毎月20日締め・翌々月10日払い");
    expect(payRuleLabel("末", 0, 31)).toBe("毎月末日締め・当月末日払い");
    expect(closingPeriodText("末")).toBe("毎月1日から末日まで");
    expect(closingPeriodText(20)).toBe("前月21日から当月20日まで");
    expect(closingPeriodText(30)).toContain("30日が無い月は末日まで");
    // 28日はどの月にもあるので「無い月は」を付けない
    expect(closingPeriodText(28)).toBe("前月28日の翌日から当月28日まで");
  });
});

const SAMPLE: TorihikiInput = {
  clientName: "〇〇運送株式会社",
  driverName: "〇〇 〇〇",
  commissionDate: "2026-09-25",
  work: "宅配便の配達",
  workDetail: "〇〇センターの担当コース",
  periodFrom: "2026-10-01",
  periodTo: "2027-09-30",
  autoRenew: true,
  place: "〇〇市内",
  rates: [
    { label: "宅配（通常）", unit: "piece", unitPrice: 150 },
    { label: "企業配", unit: "day", unitPrice: 15000, note: "8時間まで" },
    { label: "", unit: "piece", unitPrice: null },
  ],
  taxIncluded: false,
  deductions: [
    { label: "管理費", kind: "monthly", amount: 10000 },
    { label: "ロイヤリティ", kind: "percent", amount: 10 },
    { label: "", kind: "monthly", amount: null },
  ],
  closingDay: "末",
  payMonthOffset: 1,
  payDay: "末",
  holidayRule: "before",
  transferFeeBearer: "company",
  expenses: [
    { label: "燃料代", bearer: "driver" },
    { label: "高速代", bearer: "company" },
  ],
  inspection: false,
  inspectionDue: "",
  other: "",
};

describe("取引条件明示書", () => {
  it("明示事項の順に並べる", () => {
    const doc = buildTorihikiJoken(SAMPLE);
    expect(doc.sections.map((s) => s.key)).toEqual([
      "parties",
      "date",
      "work",
      "period",
      "place",
      "fee",
      "deduction",
      "payment",
      "method",
      "expenses",
    ]);
    expect(doc.missing).toEqual([]);
    expect(doc.warnings).toEqual([]);
    expect(doc.deadline.status).toBe("ok");
    expect(doc.dateText).toBe("2026年9月25日");
    expect(doc.checklist.filter((c) => c.status === "missing")).toEqual([]);
    expect(doc.checklist.find((c) => c.label.startsWith("検査"))?.status).toBe("na");
  });

  it("報酬・差し引くもの・支払期日の文面", () => {
    const doc = buildTorihikiJoken(SAMPLE);
    const fee = doc.sections.find((s) => s.key === "fee")!;
    // 空の行は入れない
    expect(fee.table?.rows).toEqual([
      ["宅配（通常）", "1個あたり 150円（税抜）"],
      ["企業配（8時間まで）", "1日あたり 15,000円（税抜）"],
    ]);
    expect(fee.lines.join("")).toContain("高速代");
    const ded = doc.sections.find((s) => s.key === "deduction")!;
    expect(ded.table?.rows).toEqual([
      ["管理費", "毎月 10,000円"],
      ["ロイヤリティ", "報酬の 10%"],
    ]);
    const pay = doc.sections.find((s) => s.key === "payment")!;
    expect(pay.lines[0]).toBe("毎月末日締め、翌月末日払い");
    expect(pay.lines.join("")).toContain("前の営業日");
    expect(pay.lines.join("")).toContain("2026年11月30日");
    const period = doc.sections.find((s) => s.key === "period")!;
    expect(period.lines[0]).toBe("2026年10月1日から2027年9月30日まで");
    expect(period.lines[1]).toContain("更新");
  });

  it("振込手数料をドライバーの負担にすると注意を出す", () => {
    const doc = buildTorihikiJoken({ ...SAMPLE, transferFeeBearer: "driver" });
    expect(doc.warnings.some((w) => w.includes("振込手数料"))).toBe(true);
    expect(doc.sections.find((s) => s.key === "method")!.lines[1]).toContain("ドライバーの負担");
  });

  it("支払期日が長いと注意を出す", () => {
    const caution = buildTorihikiJoken({ ...SAMPLE, closingDay: 20 });
    expect(caution.deadline.status).toBe("caution");
    expect(caution.warnings.some((w) => w.includes("60日"))).toBe(true);
    const bad = buildTorihikiJoken({ ...SAMPLE, payMonthOffset: 0, payDay: 10 });
    expect(bad.missing).toContain("支払期日");
  });

  it("空の入力は（未記入）にして、足りない項目を返す", () => {
    const doc = buildTorihikiJoken({
      ...SAMPLE,
      clientName: " ",
      driverName: "",
      commissionDate: "",
      work: "",
      periodFrom: "",
      periodTo: "",
      place: "",
      rates: [],
      deductions: [],
      expenses: [],
      inspection: true,
      inspectionDue: "",
    });
    expect(doc.missing).toEqual([
      "委託する者（会社）の名前",
      "ドライバーの名前",
      "業務委託をした日",
      "業務の内容",
      "業務を行う期間",
      "業務を行う場所",
      "検査を終える日",
      "報酬の単価",
    ]);
    expect(doc.clientName).toBe(BLANK);
    expect(doc.sections.find((s) => s.key === "deduction")!.lines).toEqual(["ありません。"]);
    expect(doc.sections.find((s) => s.key === "period")!.lines[0]).toContain(BLANK);
    expect(doc.sections.some((s) => s.key === "expenses")).toBe(false);
  });

  it("LINE・メールの文面", () => {
    const doc = buildTorihikiJoken({ ...SAMPLE, other: "荷物の事故は別の覚書による\n\n制服は貸与" });
    const t = torihikiPlainText(doc);
    expect(t.startsWith("【取引条件明示書】\n〇〇 〇〇 様")).toBe(true);
    expect(t).toContain("■1. 当事者");
    expect(t).toContain("・宅配（通常）：1個あたり 150円（税抜）");
    expect(t).toContain("■11. その他\n荷物の事故は別の覚書による\n制服は貸与");
    expect(t).toContain("第3条");
    expect(t.trimEnd().endsWith("返信してください。")).toBe(true);
  });
});
