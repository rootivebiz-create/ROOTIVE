import { describe, expect, it } from "vitest";
import {
  activeStages,
  CHECKLIST_ITEMS,
  CHECKLIST_KEYS,
  checklistLabel,
  checklistProgress,
  checklistText,
  closedStages,
  contractAlerts,
  contractAlertText,
  daysBetween,
  daysSinceActivity,
  driversWithoutContract,
  groupByStage,
  hasHrAttention,
  hrCounts,
  isChecklistKey,
  isClosedStage,
  isDateString,
  isOpenStage,
  isoToJstDate,
  jstDateToIso,
  lastActivityOn,
  missingChecklistLabels,
  nextStage,
  openStages,
  periodLabel,
  prevStage,
  sortContracts,
  staleApplicants,
  STALE_DAYS,
  stageLabel,
  toApplicantView,
  toChecklist,
  toContractView,
  todayJST,
  toPeriodStatus,
  ZERO_HR_COUNTS,
  type ApplicantLike,
  type ApplicantView,
  type ContractLike,
  type ContractView,
} from "@/lib/hr/helpers";
import {
  APPLICANTS_CSV_HEADERS,
  applicantToCsvRow,
  applicantsCsv,
  CONTRACTS_CSV_HEADERS,
  contractToCsvRow,
  contractsCsv,
  hrCsvFilename,
  hrCsvUrl,
  type ApplicantCsvSource,
  type ContractCsvSource,
} from "@/lib/exports/hr-csv";
import { CSV_BOM } from "@/lib/exports/csv";
import {
  addApplicantEventSchema,
  contractInputSchema,
  convertApplicantSchema,
  createApplicantSchema,
  endContractSchema,
  HR_TABS,
  hrTabFromParam,
  moveApplicantStageSchema,
  toggleChecklistSchema,
  updateApplicantSchema,
} from "@/lib/schemas/hr";
import { APPLICANT_STAGES, type ApplicantRow, type ApplicantStage, type ContractRow } from "@/lib/db/types";

const TODAY = "2026-09-19";

/** テスト用の応募者（段階と日付だけ） */
function mk(stage: ApplicantStage, appliedOn: string, lastEventOn: string | null = null, name: string = stage): ApplicantLike & { id: string; name: string } {
  return { id: `${stage}-${appliedOn}-${name}`, name, stage, appliedOn, lastEventOn };
}

/** テスト用の契約（期間の状態と残り日数だけ） */
function mkc(id: string, periodStatus: ContractView["periodStatus"], daysLeft: number | null, driverId = "d1", status: ContractView["status"] = "active") {
  return { id, periodStatus, daysLeft, driverId, status };
}

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

describe("日付のユーティリティ", () => {
  it("todayJST は日本時間の日付を返す（UTC 15:00 で翌日になる）", () => {
    expect(todayJST(new Date("2026-09-19T14:59:59.000Z"))).toBe("2026-09-19");
    expect(todayJST(new Date("2026-09-19T15:00:00.000Z"))).toBe("2026-09-20");
  });

  it("isDateString は実在する日付だけを通す", () => {
    expect(isDateString("2026-09-19")).toBe(true);
    expect(isDateString("2026-02-29")).toBe(false); // 閏年ではない
    expect(isDateString("2024-02-29")).toBe(true);
    expect(isDateString("2026-13-01")).toBe(false);
    expect(isDateString("2026-09-31")).toBe(false);
    expect(isDateString("2026-9-1")).toBe(false);
    expect(isDateString("")).toBe(false);
    expect(isDateString(null)).toBe(false);
    expect(isDateString(20260919)).toBe(false);
  });

  it("daysBetween は同じ日が 0、前日が 1（月・年をまたいでも数えられる）", () => {
    expect(daysBetween(TODAY, TODAY)).toBe(0);
    expect(daysBetween("2026-09-18", TODAY)).toBe(1);
    expect(daysBetween("2026-09-20", TODAY)).toBe(-1);
    expect(daysBetween("2026-08-31", "2026-09-01")).toBe(1);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("bad", TODAY)).toBeNull();
    expect(daysBetween(null, TODAY)).toBeNull();
  });

  it("jstDateToIso / isoToJstDate は日本時間の 0 時で往復する", () => {
    expect(jstDateToIso("2026-09-19")).toBe("2026-09-18T15:00:00.000Z");
    expect(isoToJstDate("2026-09-18T15:00:00.000Z")).toBe("2026-09-19");
    expect(jstDateToIso("")).toBeNull();
    expect(isoToJstDate(null)).toBe("");
    expect(isoToJstDate("だめ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 必要書類
// ---------------------------------------------------------------------------

describe("必要書類のチェックリスト", () => {
  it("4 項目（運転免許証・車検証・任意保険証券・黒ナンバーの届出）", () => {
    expect(CHECKLIST_ITEMS).toHaveLength(4);
    expect(CHECKLIST_KEYS).toEqual(["license", "vehicle", "insurance", "black_plate"]);
    expect(CHECKLIST_ITEMS.map((i) => i.label)).toEqual(["運転免許証", "車検証", "任意保険証券", "黒ナンバーの届出"]);
    expect(checklistLabel("insurance")).toBe("任意保険証券");
    expect(checklistLabel("unknown")).toBe("unknown");
    expect(isChecklistKey("license")).toBe(true);
    expect(isChecklistKey("licence")).toBe(false);
  });

  it("空・null・配列・文字列はすべて 0/4", () => {
    for (const raw of [{}, null, undefined, [], "license", 1]) {
      expect(checklistProgress(raw)).toEqual({ done: 0, total: 4, complete: false });
    }
  });

  it("true の項目だけを数える（\"true\" や 1 は数えない）", () => {
    expect(checklistProgress({ license: true, vehicle: false })).toEqual({ done: 1, total: 4, complete: false });
    expect(checklistProgress({ license: "true", vehicle: 1 })).toEqual({ done: 0, total: 4, complete: false });
    expect(checklistProgress({ license: true, vehicle: true, insurance: true, black_plate: true })).toEqual({ done: 4, total: 4, complete: true });
  });

  it("知らない key は無視する", () => {
    expect(checklistProgress({ license: true, other: true })).toEqual({ done: 1, total: 4, complete: false });
    expect(toChecklist({ license: true, other: true })).toEqual({ license: true, vehicle: false, insurance: false, black_plate: false });
  });

  it("表示用の文字列と、足りない書類の名前", () => {
    expect(checklistText({ license: true, vehicle: true })).toBe("2/4");
    expect(missingChecklistLabels({ license: true })).toEqual(["車検証", "任意保険証券", "黒ナンバーの届出"]);
    expect(missingChecklistLabels({ license: true, vehicle: true, insurance: true, black_plate: true })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 段階
// ---------------------------------------------------------------------------

describe("採用の段階", () => {
  it("選考中と離脱を分けて、合わせると APPLICANT_STAGES と同じ", () => {
    expect(activeStages).toEqual(["applied", "contacted", "interview", "docs", "contract", "started"]);
    expect(closedStages).toEqual(["declined", "rejected"]);
    expect([...activeStages, ...closedStages].sort()).toEqual([...APPLICANT_STAGES].sort());
    expect(activeStages.some((s) => closedStages.includes(s))).toBe(false);
  });

  it("openStages は稼働開始を含まない（対応が必要な段階）", () => {
    expect(openStages).toEqual(["applied", "contacted", "interview", "docs", "contract"]);
    expect(isOpenStage("contract")).toBe(true);
    expect(isOpenStage("started")).toBe(false);
    expect(isOpenStage("declined")).toBe(false);
    expect(isClosedStage("rejected")).toBe(true);
    expect(isClosedStage("applied")).toBe(false);
    expect(isClosedStage(null)).toBe(false);
  });

  it("nextStage / prevStage は端で null になる", () => {
    expect(nextStage("applied")).toBe("contacted");
    expect(nextStage("docs")).toBe("contract");
    expect(nextStage("contract")).toBe("started");
    expect(nextStage("started")).toBeNull();
    expect(prevStage("started")).toBe("contract");
    expect(prevStage("applied")).toBeNull();
  });

  it("離脱した段階には次も前も無い", () => {
    expect(nextStage("declined")).toBeNull();
    expect(prevStage("declined")).toBeNull();
    expect(nextStage("rejected")).toBeNull();
    expect(prevStage("rejected")).toBeNull();
  });

  it("段階の表示名は日本語", () => {
    expect(stageLabel("docs")).toBe("書類");
    expect(stageLabel("started")).toBe("稼働開始");
  });
});

describe("groupByStage", () => {
  const rows = [mk("docs", "2026-09-01", null, "A"), mk("applied", "2026-09-05", null, "B"), mk("docs", "2026-09-03", null, "C")];

  it("既定では APPLICANT_STAGES の順（空の段階も 0 件で返す）", () => {
    const groups = groupByStage(rows);
    expect(groups.map((g) => g.stage)).toEqual(APPLICANT_STAGES);
    expect(groups.find((g) => g.stage === "docs")?.count).toBe(2);
    expect(groups.find((g) => g.stage === "started")).toEqual({ stage: "started", label: "稼働開始", applicants: [], count: 0 });
  });

  it("まとまりの中は渡された順のまま", () => {
    const docs = groupByStage(rows).find((g) => g.stage === "docs");
    expect(docs?.applicants.map((a) => a.name)).toEqual(["A", "C"]);
  });

  it("段階を指定すればその順・その範囲だけ返す", () => {
    const groups = groupByStage(rows, closedStages);
    expect(groups.map((g) => g.stage)).toEqual(["declined", "rejected"]);
    expect(groups.every((g) => g.count === 0)).toBe(true);
  });

  it("空の配列でもすべての段階が返る", () => {
    expect(groupByStage([]).map((g) => g.count)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// フォロー漏れ
// ---------------------------------------------------------------------------

describe("staleApplicants", () => {
  it("既定は 10 日。ちょうど 10 日は対象、9 日は対象外", () => {
    expect(STALE_DAYS).toBe(10);
    const exactly = mk("applied", "2026-09-09"); // 10 日前
    const notYet = mk("applied", "2026-09-10"); // 9 日前
    expect(staleApplicants([exactly, notYet], TODAY).map((a) => a.id)).toEqual([exactly.id]);
  });

  it("当日・前日は対象外", () => {
    expect(staleApplicants([mk("applied", TODAY), mk("applied", "2026-09-18")], TODAY)).toEqual([]);
  });

  it("最後のやりとりがあればそちらを見る", () => {
    const followed = mk("contacted", "2026-08-01", "2026-09-18", "追えている");
    const forgotten = mk("contacted", "2026-09-18", "2026-09-01", "忘れている");
    expect(staleApplicants([followed, forgotten], TODAY).map((a) => a.name)).toEqual(["忘れている"]);
    expect(lastActivityOn(followed)).toBe("2026-09-18");
    expect(lastActivityOn(mk("applied", "2026-08-01"))).toBe("2026-08-01");
    expect(daysSinceActivity(forgotten, TODAY)).toBe(18);
  });

  it("離脱した人・稼働開始した人は含めない", () => {
    const rows = [mk("declined", "2026-01-01"), mk("rejected", "2026-01-01"), mk("started", "2026-01-01"), mk("interview", "2026-01-01")];
    expect(staleApplicants(rows, TODAY).map((a) => a.stage)).toEqual(["interview"]);
  });

  it("古い順（いちばん動いていない人が先頭）", () => {
    const old = mk("applied", "2026-01-01", null, "古い");
    const mid = mk("applied", "2026-06-01", null, "中くらい");
    const recent = mk("applied", "2026-09-01", null, "最近");
    expect(staleApplicants([recent, old, mid], TODAY).map((a) => a.name)).toEqual(["古い", "中くらい", "最近"]);
  });

  it("空の配列・日数の指定・不正な日付", () => {
    expect(staleApplicants([], TODAY)).toEqual([]);
    expect(staleApplicants([mk("applied", "2026-09-15")], TODAY, 3).map((a) => a.stage)).toEqual(["applied"]);
    expect(staleApplicants([mk("applied", "")], TODAY)).toEqual([]);
  });

  it("元の配列を壊さない", () => {
    const rows = [mk("applied", "2026-09-01", null, "A"), mk("applied", "2026-01-01", null, "B")];
    const before = rows.map((r) => r.name);
    staleApplicants(rows, TODAY);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 契約
// ---------------------------------------------------------------------------

describe("contractAlerts", () => {
  const rows = [
    mkc("a", "active", 100),
    mkc("b", "renewal", 12),
    mkc("c", "expired", -5),
    mkc("d", "renewal", 3),
    mkc("e", "expired", -30),
    mkc("f", "open", null),
    mkc("g", "ended", null),
  ];

  it("更新時期は残り日数の少ない順、期間切れは超過の多い順", () => {
    const { renewal, expired } = contractAlerts(rows);
    expect(renewal.map((c) => c.id)).toEqual(["d", "b"]);
    expect(expired.map((c) => c.id)).toEqual(["e", "c"]);
  });

  it("期間内・期限なし・終了は警告に出さない", () => {
    const { renewal, expired } = contractAlerts(rows);
    const ids = [...renewal, ...expired].map((c) => c.id);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("f");
    expect(ids).not.toContain("g");
  });

  it("空の配列でも落ちない", () => {
    expect(contractAlerts([])).toEqual({ renewal: [], expired: [] });
  });

  it("文面は日本語", () => {
    expect(contractAlertText(mkc("x", "renewal", 12))).toBe("あと 12 日で更新時期です");
    expect(contractAlertText(mkc("x", "renewal", 0))).toBe("今日が期間の最終日です");
    expect(contractAlertText(mkc("x", "expired", -5))).toBe("期間が切れています（5 日経過）");
    expect(contractAlertText(mkc("x", "expired", 0))).toBe("期間が切れています");
    expect(contractAlertText(mkc("x", "open", null))).toBe("期限なし");
  });

  it("期間の状態の表示名", () => {
    expect(periodLabel("renewal")).toBe("更新時期");
    expect(periodLabel("expired")).toBe("期間切れ");
    expect(toPeriodStatus("ended")).toBe("ended");
    expect(toPeriodStatus("なにか")).toBe("open");
    expect(toPeriodStatus(null)).toBe("open");
  });
});

describe("sortContracts", () => {
  it("期限が近い順・期限なしはその後・終了はいちばん後ろ", () => {
    const rows = [mkc("ended", "ended", null), mkc("open", "open", null), mkc("far", "active", 100), mkc("soon", "renewal", 3), mkc("over", "expired", -10)];
    expect(sortContracts(rows).map((c) => c.id)).toEqual(["over", "soon", "far", "open", "ended"]);
  });

  it("元の配列を壊さない", () => {
    const rows = [mkc("b", "active", 10), mkc("a", "expired", -1)];
    sortContracts(rows);
    expect(rows.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("driversWithoutContract", () => {
  const drivers = [
    { id: "d1", name: "川島 幹太", is_active: true },
    { id: "d2", name: "山田 太郎", is_active: true },
    { id: "d3", name: "停止中", is_active: false },
  ];

  it("有効な契約（下書き・有効）がある人は出さない", () => {
    const contracts = [
      { driverId: "d1", status: "active" as const },
      { driverId: "d3", status: "active" as const },
    ];
    expect(driversWithoutContract(drivers, contracts).map((d) => d.id)).toEqual(["d2"]);
  });

  it("下書きの契約も「ある」とみなす", () => {
    expect(driversWithoutContract(drivers, [{ driverId: "d2", status: "draft" }]).map((d) => d.id)).toEqual(["d1"]);
  });

  it("終了した契約しか無い人は出す", () => {
    expect(driversWithoutContract(drivers, [{ driverId: "d1", status: "ended" }]).map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("停止中のドライバーは出さない／契約が無ければ稼働中は全員出る", () => {
    expect(driversWithoutContract(drivers, []).map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(driversWithoutContract([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ダッシュボード用のまとめ
// ---------------------------------------------------------------------------

describe("hrCounts", () => {
  it("選考中・フォロー漏れ・更新時期・期間切れを数える", () => {
    const applicants = [mk("applied", "2026-09-18"), mk("interview", "2026-01-01"), mk("started", "2026-01-01"), mk("declined", "2026-01-01")];
    const contracts: ContractLike[] = [mkc("a", "renewal", 5), mkc("b", "expired", -1), mkc("c", "active", 90)];
    expect(hrCounts(applicants, contracts, TODAY)).toEqual({ inProgress: 2, stale: 1, renewal: 1, expired: 1 });
  });

  it("何も無ければ 0 件で、対応が必要なものは無い", () => {
    expect(hrCounts([], [], TODAY)).toEqual(ZERO_HR_COUNTS);
    expect(hasHrAttention(ZERO_HR_COUNTS)).toBe(false);
    expect(hasHrAttention({ ...ZERO_HR_COUNTS, inProgress: 1 })).toBe(true);
    expect(hasHrAttention({ ...ZERO_HR_COUNTS, renewal: 1 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ビューの行の正規化
// ---------------------------------------------------------------------------

const EMPTY_APPLICANT_ROW: ApplicantRow = {
  id: null,
  company_id: null,
  name: null,
  kana: null,
  phone: null,
  email: null,
  source: null,
  stage: null,
  applied_on: null,
  interview_on: null,
  started_on: null,
  driver_id: null,
  has_license: null,
  has_vehicle: null,
  checklist: null,
  memo: null,
  created_by: null,
  created_at: null,
  updated_at: null,
  driver_name: null,
  event_count: null,
  last_event_on: null,
  days_since_applied: null,
};

const EMPTY_CONTRACT_ROW: ContractRow = {
  id: null,
  company_id: null,
  driver_id: null,
  title: null,
  status: null,
  start_on: null,
  end_on: null,
  auto_renew: null,
  notice_days: null,
  file_path: null,
  agreed_at: null,
  memo: null,
  created_by: null,
  created_at: null,
  updated_at: null,
  driver_name: null,
  driver_is_active: null,
  days_left: null,
  period_status: null,
};

describe("ビューの行 → 画面用の型", () => {
  it("null はすべて空文字・0・既定値になる", () => {
    const a = toApplicantView(EMPTY_APPLICANT_ROW);
    expect(a).toMatchObject({ id: "", name: "", stage: "applied", appliedOn: "", driverId: "", eventCount: 0, lastEventOn: "", daysSinceApplied: 0 });
    expect(a.checklist).toEqual({ license: false, vehicle: false, insurance: false, black_plate: false });

    const c = toContractView(EMPTY_CONTRACT_ROW);
    expect(c).toMatchObject({ id: "", driverName: "", driverIsActive: false, status: "active", startOn: "", endOn: "", autoRenew: false, noticeDays: 0, daysLeft: null, periodStatus: "open" });
  });

  it("値がある行はそのまま写す", () => {
    const a = toApplicantView({
      ...EMPTY_APPLICANT_ROW,
      id: "a1",
      name: "山田 太郎",
      stage: "docs",
      applied_on: "2026-09-01",
      checklist: { license: true },
      driver_name: "山田 太郎",
      event_count: 3,
      last_event_on: "2026-09-10",
      days_since_applied: 18,
    });
    expect(a.stage).toBe("docs");
    expect(a.checklist.license).toBe(true);
    expect(a.eventCount).toBe(3);
    expect(checklistProgress(a.checklist).done).toBe(1);

    const c = toContractView({
      ...EMPTY_CONTRACT_ROW,
      id: "c1",
      title: "業務委託契約書",
      status: "active",
      start_on: "2026-04-01",
      end_on: "2027-03-31",
      auto_renew: true,
      notice_days: 30,
      agreed_at: "2026-03-31T15:00:00.000Z",
      days_left: 193,
      period_status: "active",
      driver_is_active: true,
    });
    expect(c.agreedOn).toBe("2026-04-01");
    expect(c.daysLeft).toBe(193);
    expect(c.periodStatus).toBe("active");
    expect(c.driverIsActive).toBe(true);
  });

  it("画面用の型はそのまま純関数に渡せる", () => {
    const view: ApplicantView = toApplicantView({ ...EMPTY_APPLICANT_ROW, id: "a1", stage: "applied", applied_on: "2026-01-01" });
    expect(staleApplicants([view], TODAY).map((a) => a.id)).toEqual(["a1"]);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe("CSV", () => {
  const applicant: ApplicantCsvSource = {
    name: "山田 太郎",
    kana: "やまだ たろう",
    phone: "090-0000-0000",
    email: "taro@example.com",
    source: "求人サイト",
    stage: "docs",
    applied_on: "2026-09-01",
    interview_on: "2026-09-05",
    started_on: null,
    driver_name: "",
    checklist: { license: true, vehicle: true },
    event_count: 3,
    last_event_on: "2026-09-10",
    days_since_applied: 18,
    memo: "紹介, 要連絡",
  };

  const contract: ContractCsvSource = {
    driver_name: "山田 太郎",
    title: "業務委託契約書",
    status: "active",
    period_status: "renewal",
    start_on: "2026-04-01",
    end_on: "2026-09-30",
    days_left: 11,
    auto_renew: true,
    notice_days: 30,
    file_path: "共有/契約書.pdf",
    agreed_at: "2026-03-31T15:00:00.000Z",
    memo: "",
  };

  it("応募者 CSV は日本語の見出しで、書類は ○／× と n/4", () => {
    expect(APPLICANTS_CSV_HEADERS).toContain("運転免許証");
    expect(APPLICANTS_CSV_HEADERS).toContain("黒ナンバーの届出");
    const row = applicantToCsvRow(applicant);
    expect(row).toEqual([
      "山田 太郎",
      "やまだ たろう",
      "090-0000-0000",
      "taro@example.com",
      "求人サイト",
      "書類",
      "2026-09-01",
      "2026-09-05",
      "",
      "",
      "2/4",
      "○",
      "○",
      "×",
      "×",
      "3",
      "2026-09-10",
      "18",
      "紹介, 要連絡",
    ]);
    expect(row).toHaveLength(APPLICANTS_CSV_HEADERS.length);
  });

  it("契約 CSV は残り日数・自動更新を出す", () => {
    const row = contractToCsvRow(contract);
    expect(row).toEqual(["山田 太郎", "業務委託契約書", "有効", "更新時期", "2026-04-01", "2026-09-30", "11", "○", "30", "共有/契約書.pdf", "2026-03-31T15:00:00.000Z", ""]);
    expect(row).toHaveLength(CONTRACTS_CSV_HEADERS.length);
    expect(contractToCsvRow({ ...contract, days_left: null, auto_renew: false })[6]).toBe("");
    expect(contractToCsvRow({ ...contract, days_left: -3 })[6]).toBe("-3");
  });

  it("BOM 付き・CRLF 区切り・カンマはエスケープされる", () => {
    const csv = applicantsCsv([applicant]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain('"紹介, 要連絡"');
    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
  });

  it("空でも見出しだけの CSV になる", () => {
    expect(applicantsCsv([]).trimEnd().split("\r\n")).toHaveLength(1);
    expect(contractsCsv([]).trimEnd().split("\r\n")).toHaveLength(1);
  });

  it("URL とファイル名", () => {
    expect(hrCsvUrl("applicant")).toBe("/api/export/hr.csv?kind=applicant");
    expect(hrCsvUrl("contract")).toBe("/api/export/hr.csv?kind=contract");
    expect(hrCsvFilename("applicant")).toBe("応募者一覧.csv");
    expect(hrCsvFilename("contract")).toBe("業務委託契約一覧.csv");
  });
});

// ---------------------------------------------------------------------------
// 入力スキーマ
// ---------------------------------------------------------------------------

describe("応募者のスキーマ", () => {
  const base = { name: "山田 太郎", kana: "", phone: "", email: "", source: "", applied_on: "2026-09-01", interview_on: "", memo: "" };

  it("段階の既定は「応募」、空欄の日付は null", () => {
    const v = createApplicantSchema.parse({ ...base, stage: "applied" });
    expect(v.stage).toBe("applied");
    expect(v.interview_on).toBeNull();
  });

  it("氏名は必須、日付の形式は検査する", () => {
    expect(createApplicantSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(createApplicantSchema.safeParse({ ...base, applied_on: "2026/09/01" }).success).toBe(false);
    expect(createApplicantSchema.safeParse({ ...base, applied_on: "2026-02-30" }).success).toBe(false);
    expect(createApplicantSchema.safeParse({ ...base, email: "だめ" }).success).toBe(false);
    expect(createApplicantSchema.safeParse({ ...base, email: "ok@example.com" }).success).toBe(true);
  });

  it("更新には ID が要る", () => {
    expect(updateApplicantSchema.safeParse(base).success).toBe(false);
    expect(updateApplicantSchema.safeParse({ ...base, id: "11111111-1111-4111-8111-111111111111" }).success).toBe(true);
  });

  it("段階の変更・やりとり・チェックリスト", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(moveApplicantStageSchema.parse({ id, stage: "docs", note: "" }).note).toBe("");
    expect(moveApplicantStageSchema.safeParse({ id, stage: "unknown", note: "" }).success).toBe(false);
    expect(addApplicantEventSchema.safeParse({ applicant_id: id, happened_on: "2026-09-19", note: "" }).success).toBe(false);
    expect(addApplicantEventSchema.parse({ applicant_id: id, happened_on: "2026-09-19", note: " 電話した " }).note).toBe("電話した");
    expect(toggleChecklistSchema.safeParse({ id, key: "license", value: true }).success).toBe(true);
    expect(toggleChecklistSchema.safeParse({ id, key: "unknown", value: true }).success).toBe(false);
    expect(toggleChecklistSchema.safeParse({ id, key: "license", value: "true" }).success).toBe(false);
  });

  it("ドライバー登録には氏名と稼働開始日が要る", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(convertApplicantSchema.safeParse({ id, name: "", kana: "", phone: "", email: "", started_on: "2026-10-01" }).success).toBe(false);
    expect(convertApplicantSchema.safeParse({ id, name: "山田", kana: "", phone: "", email: "", started_on: "" }).success).toBe(false);
    expect(convertApplicantSchema.parse({ id, name: " 山田 ", kana: "", phone: "", email: "", started_on: "2026-10-01" }).name).toBe("山田");
  });
});

describe("契約のスキーマ", () => {
  const driverId = "22222222-2222-4222-8222-222222222222";
  const base = {
    id: null,
    driver_id: driverId,
    title: "業務委託契約書",
    status: "active" as const,
    start_on: "2026-04-01",
    end_on: "2027-03-31",
    auto_renew: true,
    notice_days: "30",
    file_path: "",
    agreed_on: "",
    memo: "",
  };

  it("通常の入力（空欄の終了日・合意日は null）", () => {
    const v = contractInputSchema.parse({ ...base, end_on: "", agreed_on: "" });
    expect(v.end_on).toBeNull();
    expect(v.agreed_on).toBeNull();
    expect(v.notice_days).toBe(30);
    expect(v.id).toBeNull();
  });

  it("終了日は開始日以降でなければならない（同じ日は可）", () => {
    expect(contractInputSchema.safeParse({ ...base, end_on: "2026-03-31" }).success).toBe(false);
    expect(contractInputSchema.safeParse({ ...base, end_on: "2026-04-01" }).success).toBe(true);
  });

  it("通知日数は全角でも受け付け、範囲外は弾く", () => {
    expect(contractInputSchema.parse({ ...base, notice_days: "６０" }).notice_days).toBe(60);
    expect(contractInputSchema.parse({ ...base, notice_days: "" }).notice_days).toBe(30);
    expect(contractInputSchema.safeParse({ ...base, notice_days: "400" }).success).toBe(false);
    expect(contractInputSchema.safeParse({ ...base, notice_days: "-1" }).success).toBe(false);
    expect(contractInputSchema.safeParse({ ...base, notice_days: "10.5" }).success).toBe(false);
  });

  it("ドライバー・契約名・状態は必須", () => {
    expect(contractInputSchema.safeParse({ ...base, driver_id: "" }).success).toBe(false);
    expect(contractInputSchema.safeParse({ ...base, title: " " }).success).toBe(false);
    expect(contractInputSchema.safeParse({ ...base, status: "unknown" }).success).toBe(false);
  });

  it("終了にするには日付が要る", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(endContractSchema.safeParse({ id, end_on: "" }).success).toBe(false);
    expect(endContractSchema.parse({ id, end_on: "2026-09-30" }).end_on).toBe("2026-09-30");
  });
});

describe("タブ（?tab=）", () => {
  it("既定は採用タブ", () => {
    expect(HR_TABS).toEqual(["applicants", "contracts"]);
    expect(hrTabFromParam(undefined)).toBe("applicants");
    expect(hrTabFromParam("contracts")).toBe("contracts");
    expect(hrTabFromParam("なにか")).toBe("applicants");
    expect(hrTabFromParam(["contracts", "applicants"])).toBe("contracts");
  });
});
