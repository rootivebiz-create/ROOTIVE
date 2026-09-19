import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/exports/csv";
import { DOCUMENTS_CSV_HEADERS, VEHICLES_CSV_HEADERS, documentToCsvRow, documentsCsv, vehicleToCsvRow, vehiclesCsv } from "@/lib/exports/fleet-csv";
import {
  DEFAULT_REMINDER_DAYS,
  TRAINING_INTERVAL_YEARS,
  addDaysToDate,
  addYearsToDate,
  countExpiry,
  diffDays,
  documentTarget,
  documentTitle,
  expiryLabel,
  expiryMessage,
  expiryState,
  fleetCsvUrl,
  fleetTabHref,
  formatDate,
  formatDateTime,
  isLocalDateTime,
  isoToLocalInput,
  localInputToIso,
  missingInitialInstruction,
  nextTrainingDue,
  shortDate,
  sortDocuments,
  toFleetDocument,
  toFleetVehicle,
  todayJST,
  type FleetDocument,
} from "@/lib/fleet/helpers";
import {
  documentInputSchema,
  fleetCsvKindSchema,
  fleetTabFromParam,
  incidentInputSchema,
  instructionInputSchema,
  safetyManagerInputSchema,
  vehicleInputSchema,
} from "@/lib/schemas/fleet";
import type { DocumentListRow, VehicleRow } from "@/lib/db/types";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const DRIVER = "22222222-2222-4222-8222-222222222222";
const DRIVER2 = "33333333-3333-4333-8333-333333333333";
const VEHICLE = "44444444-4444-4444-8444-444444444444";
const DOC = "55555555-5555-4555-8555-555555555555";

const TODAY = "2026-09-19";

/** v_document_list の 1 行 */
function docRow(over: Partial<DocumentListRow> = {}): DocumentListRow {
  return {
    id: DOC,
    company_id: COMPANY,
    kind: "license",
    driver_id: DRIVER,
    driver_name: "相曽慧",
    vehicle_id: null,
    vehicle_plate: "",
    label: "",
    number: "",
    issued_on: null,
    expires_on: null,
    reminder_days: DEFAULT_REMINDER_DAYS,
    file_path: "",
    memo: "",
    is_active: true,
    created_at: "2026-09-01T00:00:00+09:00",
    days_left: null,
    expiry_status: "none",
    ...over,
  };
}

/** v_vehicle_list の 1 行 */
function vehicleRow(over: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: VEHICLE,
    company_id: COMPANY,
    plate: "足立 480 あ 12-34",
    maker: "ダイハツ",
    model: "ハイゼットカーゴ",
    ownership: "owned",
    driver_id: DRIVER,
    driver_name: "相曽慧",
    lease_monthly: 0,
    odometer: 45_000.5,
    memo: "",
    is_active: true,
    sort_order: 1,
    created_at: "2026-09-01T00:00:00+09:00",
    next_expires_on: null,
    next_kind: null,
    expired_count: 0,
    ...over,
  };
}

/** 画面で扱う書類（期限の状態つき） */
function doc(over: Partial<FleetDocument> = {}): FleetDocument {
  return { ...toFleetDocument(docRow(), TODAY), ...over };
}

// ---------------------------------------------------------------------------
// 日付ユーティリティ
// ---------------------------------------------------------------------------

describe("日付ユーティリティ", () => {
  it("todayJST は日本時間の日付を返す（UTC 深夜は翌日）", () => {
    expect(todayJST(new Date("2026-09-18T15:00:00Z"))).toBe("2026-09-19");
    expect(todayJST(new Date("2026-09-18T14:59:59Z"))).toBe("2026-09-18");
  });

  it("addDaysToDate は月またぎ・年またぎ・うるう年を扱う", () => {
    expect(addDaysToDate("2026-09-19", 1)).toBe("2026-09-20");
    expect(addDaysToDate("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysToDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDaysToDate("2025-02-28", 1)).toBe("2025-03-01");
    expect(addDaysToDate("", 1)).toBe("");
  });

  it("addYearsToDate はうるう日を月末に詰める", () => {
    expect(addYearsToDate("2024-02-29", 2)).toBe("2026-02-28");
    expect(addYearsToDate("2024-02-29", 4)).toBe("2028-02-29");
    expect(addYearsToDate("2026-09-19", 2)).toBe("2028-09-19");
    expect(addYearsToDate("2026-13-01", 2)).toBe("2026-13-01"); // 不正な日付はそのまま
  });

  it("diffDays は両端を含まない日数（過去はマイナス）", () => {
    expect(diffDays("2026-09-19", "2026-09-19")).toBe(0);
    expect(diffDays("2026-09-19", "2026-09-20")).toBe(1);
    expect(diffDays("2026-09-19", "2026-09-18")).toBe(-1);
    expect(diffDays("2024-02-28", "2024-03-01")).toBe(2); // うるう年
    expect(diffDays("2025-02-28", "2025-03-01")).toBe(1);
  });

  it("formatDate / shortDate", () => {
    expect(formatDate("2026-09-19")).toBe("2026/09/19");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(shortDate("2026-09-01")).toBe("9/1");
    expect(shortDate(undefined)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// 期限の状態
// ---------------------------------------------------------------------------

describe("expiryState", () => {
  it("期限が無ければ none", () => {
    expect(expiryState(null, 60, TODAY)).toEqual({ status: "none", daysLeft: null });
    expect(expiryState("", 60, TODAY)).toEqual({ status: "none", daysLeft: null });
    expect(expiryState(undefined, 60, TODAY)).toEqual({ status: "none", daysLeft: null });
  });

  it("当日は soon（残り 0 日）", () => {
    expect(expiryState(TODAY, 60, TODAY)).toEqual({ status: "soon", daysLeft: 0 });
  });

  it("前日は expired（残り −1 日）", () => {
    expect(expiryState("2026-09-18", 60, TODAY)).toEqual({ status: "expired", daysLeft: -1 });
  });

  it("翌日は通知日数しだいで soon / valid", () => {
    expect(expiryState("2026-09-20", 60, TODAY)).toEqual({ status: "soon", daysLeft: 1 });
    expect(expiryState("2026-09-20", 0, TODAY)).toEqual({ status: "valid", daysLeft: 1 });
  });

  it("通知日数のちょうど境目（当日は soon、1 日先は valid）", () => {
    expect(expiryState("2026-09-29", 10, TODAY)).toEqual({ status: "soon", daysLeft: 10 });
    expect(expiryState("2026-09-30", 10, TODAY)).toEqual({ status: "valid", daysLeft: 11 });
  });

  it("通知日数が null なら既定 60 日、マイナスは 0 として扱う", () => {
    expect(expiryState("2026-11-18", null, TODAY).status).toBe("soon"); // 60 日後
    expect(expiryState("2026-11-19", null, TODAY).status).toBe("valid"); // 61 日後
    expect(expiryState("2026-09-20", -10, TODAY).status).toBe("valid");
  });

  it("うるう年をまたいでも残り日数が合う", () => {
    expect(expiryState("2024-02-29", 0, "2024-02-28")).toEqual({ status: "valid", daysLeft: 1 });
    expect(expiryState("2024-02-29", 1, "2024-02-28")).toEqual({ status: "soon", daysLeft: 1 });
    expect(expiryState("2024-02-29", 60, "2024-02-29")).toEqual({ status: "soon", daysLeft: 0 });
    expect(expiryState("2024-02-29", 60, "2024-03-01")).toEqual({ status: "expired", daysLeft: -1 });
    expect(expiryState("2024-03-01", 60, "2024-02-28")).toEqual({ status: "soon", daysLeft: 2 });
  });

  it("不正な日付は none", () => {
    expect(expiryState("2026-02-30", 60, TODAY).status).toBe("none");
    expect(expiryState("2026/09/19", 60, TODAY).status).toBe("none");
    expect(expiryState("2026-09-19", 60, "bad").status).toBe("none");
  });
});

describe("expiryLabel", () => {
  it("状態ごとの日本語", () => {
    expect(expiryLabel({ status: "expired", daysLeft: -3 })).toBe("3 日前に期限切れ");
    expect(expiryLabel({ status: "soon", daysLeft: 12 })).toBe("あと 12 日");
    expect(expiryLabel({ status: "soon", daysLeft: 0 })).toBe("今日が期限");
    expect(expiryLabel({ status: "valid", daysLeft: 120 })).toBe("有効");
    expect(expiryLabel({ status: "none", daysLeft: null })).toBe("期限なし");
  });
});

// ---------------------------------------------------------------------------
// 一覧の正規化・並べ替え・集計
// ---------------------------------------------------------------------------

describe("toFleetDocument / toFleetVehicle", () => {
  it("ビューの null を正規化し、基準日で期限を計算し直す", () => {
    const d = toFleetDocument(docRow({ expires_on: "2026-09-18", reminder_days: 30, days_left: 999, expiry_status: "valid" }), TODAY);
    expect(d.status).toBe("expired"); // ビューの値ではなく基準日で計算し直す
    expect(d.daysLeft).toBe(-1);
    expect(d.vehicleId).toBe("");
    expect(d.isActive).toBe(true);
  });

  it("車両は次の期限から状態を決める", () => {
    const v = toFleetVehicle(vehicleRow({ next_expires_on: "2026-10-01", next_kind: "vehicle_inspection", expired_count: 2 }), TODAY);
    expect(v.status).toBe("soon");
    expect(v.daysLeft).toBe(12);
    expect(v.expiredCount).toBe(2);
    expect(v.odometer).toBe(45_000.5);
    expect(toFleetVehicle(vehicleRow(), TODAY).status).toBe("none");
  });
});

describe("sortDocuments", () => {
  const expired1 = doc({ id: "a", expiresOn: "2026-09-01", status: "expired", daysLeft: -18 });
  const expired2 = doc({ id: "b", expiresOn: "2026-09-18", status: "expired", daysLeft: -1 });
  const soon = doc({ id: "c", expiresOn: "2026-10-01", status: "soon", daysLeft: 12 });
  const valid = doc({ id: "d", expiresOn: "2027-01-01", status: "valid", daysLeft: 104 });
  const none = doc({ id: "e", expiresOn: "", status: "none", daysLeft: null });

  it("期限切れ → まもなく → 有効 → 期限なし、各内で期限が近い順", () => {
    const sorted = sortDocuments([valid, none, soon, expired2, expired1]);
    expect(sorted.map((d) => d.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("元の配列は変更しない", () => {
    const rows = [valid, expired1];
    const sorted = sortDocuments(rows);
    expect(rows.map((r) => r.id)).toEqual(["d", "a"]);
    expect(sorted.map((r) => r.id)).toEqual(["a", "d"]);
  });

  it("同じ期限なら対象名・書類名で安定する", () => {
    const a = doc({ id: "x", driverName: "あいそ", expiresOn: "2026-10-01", status: "soon", daysLeft: 12 });
    const b = doc({ id: "y", driverName: "かわしま", expiresOn: "2026-10-01", status: "soon", daysLeft: 12 });
    // 同じ期限なら対象名の順（並べる向きを変えても結果が変わらない）
    expect(sortDocuments([b, a]).map((d) => d.id)).toEqual(["x", "y"]);
    expect(sortDocuments([a, b]).map((d) => d.id)).toEqual(["x", "y"]);
  });

  it("空の配列でも落ちない", () => {
    expect(sortDocuments([])).toEqual([]);
  });
});

describe("countExpiry", () => {
  it("状態ごとに数える", () => {
    const rows = [
      doc({ status: "expired" }),
      doc({ status: "expired" }),
      doc({ status: "soon" }),
      doc({ status: "valid" }),
      doc({ status: "none" }),
    ];
    expect(countExpiry(rows)).toEqual({ expired: 2, soon: 1, valid: 1, none: 1 });
    expect(countExpiry([])).toEqual({ expired: 0, soon: 0, valid: 0, none: 0 });
  });
});

describe("documentTarget / documentTitle / expiryMessage", () => {
  it("対象はドライバー名 → 車両番号の順", () => {
    expect(documentTarget(doc({ driverName: "相曽慧", vehiclePlate: "" }))).toBe("相曽慧");
    expect(documentTarget(doc({ driverName: "", vehiclePlate: "足立 480 あ 12-34" }))).toBe("足立 480 あ 12-34");
    expect(documentTarget(doc({ driverName: "", vehiclePlate: "" }))).toBe("");
  });

  it("名称が空なら種類の表示名", () => {
    expect(documentTitle(doc({ kind: "vehicle_inspection", label: "" }))).toBe("車検証");
    expect(documentTitle(doc({ kind: "vehicle_inspection", label: "1 号車の車検" }))).toBe("1 号車の車検");
  });

  it("名指しの案内（期限切れ・まもなく・当日）", () => {
    const expired = doc({ driverName: "", vehiclePlate: "足立 480 あ 12-34", kind: "vehicle_inspection", status: "expired", daysLeft: -3 });
    expect(expiryMessage(expired)).toBe("足立 480 あ 12-34 の車検証が 3 日前に切れています");
    const soon = doc({ driverName: "相曽慧", kind: "license", status: "soon", daysLeft: 12 });
    expect(expiryMessage(soon)).toBe("相曽慧 の運転免許証はあと 12 日で期限です");
    const todayDue = doc({ driverName: "相曽慧", kind: "health_check", status: "soon", daysLeft: 0 });
    expect(expiryMessage(todayDue)).toBe("相曽慧 の健康診断は今日が期限です");
  });
});

// ---------------------------------------------------------------------------
// 初任運転者の指導
// ---------------------------------------------------------------------------

describe("missingInitialInstruction", () => {
  const drivers = [
    { id: DRIVER, name: "相曽慧", is_active: true },
    { id: DRIVER2, name: "川島幹太", is_active: true },
  ];

  it("初任の記録が無いドライバーを返す", () => {
    const rows = missingInitialInstruction(drivers, [{ driver_id: DRIVER, kind: "initial" }]);
    expect(rows.map((d) => d.id)).toEqual([DRIVER2]);
  });

  it("定期の記録だけでは初任を満たさない", () => {
    const rows = missingInitialInstruction(drivers, [
      { driver_id: DRIVER, kind: "regular" },
      { driver_id: DRIVER2, kind: "accident" },
    ]);
    expect(rows).toHaveLength(2);
  });

  it("停止中のドライバーは促さない", () => {
    const rows = missingInitialInstruction([{ id: DRIVER, name: "相曽慧", is_active: false }], []);
    expect(rows).toEqual([]);
  });

  it("is_active を省略したら稼働中として扱う", () => {
    expect(missingInitialInstruction([{ id: DRIVER, name: "相曽慧" }], [])).toHaveLength(1);
  });

  it("記録が空でも落ちない", () => {
    expect(missingInitialInstruction([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 安全管理者の講習
// ---------------------------------------------------------------------------

describe("nextTrainingDue", () => {
  it("受講日の 2 年後を次回期限にする", () => {
    const due = nextTrainingDue({ training_on: "2025-04-01", training_expires_on: null }, TODAY);
    expect(TRAINING_INTERVAL_YEARS).toBe(2);
    expect(due.dueOn).toBe("2027-04-01");
    expect(due.status).toBe("valid");
    expect(due.daysLeft).toBe(diffDays(TODAY, "2027-04-01"));
  });

  it("次回期限が入っていればそちらを使う", () => {
    const due = nextTrainingDue({ training_on: "2025-04-01", training_expires_on: "2026-10-01" }, TODAY);
    expect(due.dueOn).toBe("2026-10-01");
    expect(due.status).toBe("soon");
    expect(due.daysLeft).toBe(12);
  });

  it("期限切れも分かる", () => {
    expect(nextTrainingDue({ training_on: "2024-09-18" }, TODAY)).toEqual({ dueOn: "2026-09-18", daysLeft: -1, status: "expired" });
  });

  it("うるう日の受講は 2 年後の 2/28", () => {
    expect(nextTrainingDue({ training_on: "2024-02-29" }, "2026-02-01").dueOn).toBe("2026-02-28");
  });

  it("どちらも未入力なら none", () => {
    expect(nextTrainingDue({}, TODAY)).toEqual({ dueOn: null, daysLeft: null, status: "none" });
    expect(nextTrainingDue({ training_on: null, training_expires_on: null }, TODAY).status).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// 発生日時（datetime-local ↔ timestamptz）
// ---------------------------------------------------------------------------

describe("事故の発生日時", () => {
  it("datetime-local の妥当性", () => {
    expect(isLocalDateTime("2026-09-19T14:30")).toBe(true);
    expect(isLocalDateTime("2026-09-19T24:00")).toBe(false);
    expect(isLocalDateTime("2026-02-30T10:00")).toBe(false);
    expect(isLocalDateTime("2026-09-19")).toBe(false);
  });

  it("日本時間として ISO へ、ISO から日本時間へ戻せる", () => {
    expect(localInputToIso("2026-09-19T14:30")).toBe("2026-09-19T14:30:00+09:00");
    expect(localInputToIso("bad")).toBeNull();
    expect(isoToLocalInput("2026-09-19T14:30:00+09:00")).toBe("2026-09-19T14:30");
    expect(isoToLocalInput("2026-09-19T05:30:00Z")).toBe("2026-09-19T14:30");
    expect(isoToLocalInput(null)).toBe("");
  });

  it("表示は日本時間", () => {
    expect(formatDateTime("2026-09-19T05:30:00Z")).toBe("2026/09/19 14:30");
    expect(formatDateTime(null)).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

describe("URL", () => {
  it("タブと CSV", () => {
    expect(fleetTabHref("documents")).toBe("/fleet?tab=documents");
    expect(fleetCsvUrl("vehicle")).toBe("/api/export/fleet.csv?kind=vehicle");
    expect(fleetTabFromParam("documents")).toBe("documents");
    expect(fleetTabFromParam(["vehicles"])).toBe("vehicles");
    expect(fleetTabFromParam("bad")).toBe("vehicles");
    expect(fleetTabFromParam(undefined)).toBe("vehicles");
    expect(fleetCsvKindSchema.safeParse("document").success).toBe(true);
    expect(fleetCsvKindSchema.safeParse("other").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 入力スキーマ
// ---------------------------------------------------------------------------

describe("vehicleInputSchema", () => {
  const base = {
    id: null,
    plate: " 足立 480 あ 12-34 ",
    maker: "ダイハツ",
    model: "ハイゼットカーゴ",
    ownership: "lease" as const,
    driver_id: "",
    lease_monthly: "２５，０００",
    odometer: "45,000.5",
    memo: "",
    is_active: true,
  };

  it("全角・カンマを正規化し、空欄は null / 0 にする", () => {
    const v = vehicleInputSchema.parse(base);
    expect(v.plate).toBe("足立 480 あ 12-34");
    expect(v.lease_monthly).toBe(25_000);
    expect(v.odometer).toBe(45_000.5);
    expect(v.driver_id).toBeNull();
    expect(vehicleInputSchema.parse({ ...base, lease_monthly: "", odometer: "" })).toMatchObject({ lease_monthly: 0, odometer: null });
  });

  it("車両番号は必須", () => {
    expect(vehicleInputSchema.safeParse({ ...base, plate: "  " }).success).toBe(false);
  });

  it("走行距離は小数 1 桁まで", () => {
    expect(vehicleInputSchema.safeParse({ ...base, odometer: "100.25" }).success).toBe(false);
  });

  it("所有区分は 3 種類だけ", () => {
    expect(vehicleInputSchema.safeParse({ ...base, ownership: "rental" }).success).toBe(false);
  });
});

describe("documentInputSchema", () => {
  const base = {
    id: null,
    kind: "vehicle_inspection" as const,
    driver_id: "",
    vehicle_id: VEHICLE,
    label: "",
    number: "",
    issued_on: "2026-04-01",
    expires_on: "2028-03-31",
    reminder_days: "60",
    memo: "",
    is_active: true,
  };

  it("対象が車両だけなら通る", () => {
    const v = documentInputSchema.parse(base);
    expect(v.vehicle_id).toBe(VEHICLE);
    expect(v.driver_id).toBeNull();
    expect(v.reminder_days).toBe(60);
  });

  it("対象が無ければ拒否する", () => {
    const res = documentInputSchema.safeParse({ ...base, vehicle_id: "" });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toContain("対象");
  });

  it("対象を両方指定したら拒否する", () => {
    expect(documentInputSchema.safeParse({ ...base, driver_id: DRIVER }).success).toBe(false);
  });

  it("有効期限は取得日以降", () => {
    expect(documentInputSchema.safeParse({ ...base, issued_on: "2026-04-01", expires_on: "2026-03-31" }).success).toBe(false);
    expect(documentInputSchema.safeParse({ ...base, issued_on: "2026-04-01", expires_on: "2026-04-01" }).success).toBe(true);
  });

  it("日付は空欄なら null、通知日数は 0〜365", () => {
    const v = documentInputSchema.parse({ ...base, issued_on: "", expires_on: "", reminder_days: "" });
    expect(v.issued_on).toBeNull();
    expect(v.expires_on).toBeNull();
    expect(v.reminder_days).toBe(60);
    expect(documentInputSchema.safeParse({ ...base, reminder_days: "366" }).success).toBe(false);
    expect(documentInputSchema.safeParse({ ...base, reminder_days: "0" }).success).toBe(true);
  });

  it("存在しない日付は拒否する（2 月 30 日・うるう年でない 2 月 29 日）", () => {
    expect(documentInputSchema.safeParse({ ...base, expires_on: "2026-02-30" }).success).toBe(false);
    expect(documentInputSchema.safeParse({ ...base, expires_on: "2026-02-29" }).success).toBe(false);
    expect(documentInputSchema.safeParse({ ...base, expires_on: "2028-02-29" }).success).toBe(true);
  });
});

describe("safetyManagerInputSchema", () => {
  const base = {
    id: null,
    name: " 川島幹太 ",
    office: "",
    driver_id: "",
    appointed_on: "2026-04-01",
    training_on: "2026-03-01",
    training_expires_on: "",
    notified_on: "",
    memo: "",
    is_active: true,
  };

  it("営業所が空欄なら「本店」", () => {
    const v = safetyManagerInputSchema.parse(base);
    expect(v.name).toBe("川島幹太");
    expect(v.office).toBe("本店");
    expect(v.training_expires_on).toBeNull();
  });

  it("次回講習の期限は受講日以降", () => {
    expect(safetyManagerInputSchema.safeParse({ ...base, training_expires_on: "2026-02-28" }).success).toBe(false);
    expect(safetyManagerInputSchema.safeParse({ ...base, training_expires_on: "2028-03-01" }).success).toBe(true);
  });

  it("氏名は必須", () => {
    expect(safetyManagerInputSchema.safeParse({ ...base, name: " " }).success).toBe(false);
  });
});

describe("instructionInputSchema", () => {
  const base = { id: null, driver_id: DRIVER, kind: "initial" as const, instructed_on: "2026-09-19", hours: "15.5", topics: "安全運行の基本", instructor: "川島幹太", memo: "" };

  it("実施時間は小数 2 桁まで、空欄は 0", () => {
    expect(instructionInputSchema.parse(base).hours).toBe(15.5);
    expect(instructionInputSchema.parse({ ...base, hours: "" }).hours).toBe(0);
    expect(instructionInputSchema.safeParse({ ...base, hours: "1.234" }).success).toBe(false);
  });

  it("ドライバーと実施日は必須", () => {
    expect(instructionInputSchema.safeParse({ ...base, driver_id: "" }).success).toBe(false);
    expect(instructionInputSchema.safeParse({ ...base, instructed_on: "" }).success).toBe(false);
    expect(instructionInputSchema.safeParse({ ...base, instructed_on: "2026-02-30" }).success).toBe(false);
  });

  it("種類は 5 種類だけ", () => {
    expect(instructionInputSchema.safeParse({ ...base, kind: "other" }).success).toBe(false);
    for (const kind of ["initial", "regular", "accident", "elderly", "special"]) {
      expect(instructionInputSchema.safeParse({ ...base, kind }).success).toBe(true);
    }
  });
});

describe("incidentInputSchema", () => {
  const base = {
    id: null,
    driver_id: DRIVER,
    vehicle_id: VEHICLE,
    occurred_at: "2026-09-19T14:30",
    kind: "accident" as const,
    place: "東京都足立区",
    description: "追突",
    cause: "車間距離不足",
    prevention: "車間距離の指導",
    reported: true,
    cost: "１２０，０００",
    memo: "",
  };

  it("発生日時は日本時間として ISO へ、費用は全角・カンマ可", () => {
    const v = incidentInputSchema.parse(base);
    expect(v.occurred_at).toBe("2026-09-19T14:30:00+09:00");
    expect(v.cost).toBe(120_000);
  });

  it("発生日時は必須（不正な値は拒否）", () => {
    expect(incidentInputSchema.safeParse({ ...base, occurred_at: "" }).success).toBe(false);
    expect(incidentInputSchema.safeParse({ ...base, occurred_at: "2026-09-19" }).success).toBe(false);
    expect(incidentInputSchema.safeParse({ ...base, occurred_at: "2026-02-30T10:00" }).success).toBe(false);
  });

  it("ドライバー・車両は任意（空欄は null）、費用の空欄は 0", () => {
    const v = incidentInputSchema.parse({ ...base, driver_id: "", vehicle_id: "", cost: "" });
    expect(v.driver_id).toBeNull();
    expect(v.vehicle_id).toBeNull();
    expect(v.cost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe("車両・書類 CSV", () => {
  it("車両 CSV は BOM・CRLF・ヘッダー付き", () => {
    const csv = vehiclesCsv([vehicleRow({ ownership: "lease", lease_monthly: 25_000, next_expires_on: "2028-03-31", next_kind: "vehicle_inspection", expired_count: 1 })]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(CSV_BOM + VEHICLES_CSV_HEADERS.join(","));
    expect(lines[1]).toContain("リース");
    expect(lines[1]).toContain("25000");
    expect(lines[1]).toContain("2028-03-31");
    expect(lines[1]).toContain("車検証");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("車両 1 行の値（数値は生の値・停止中の表記）", () => {
    expect(vehicleToCsvRow(vehicleRow({ is_active: false, lease_monthly: 0, odometer: null, memo: 'あ,"い' }))).toEqual([
      "足立 480 あ 12-34",
      "ダイハツ",
      "ハイゼットカーゴ",
      "自社所有",
      "相曽慧",
      "0",
      "",
      "",
      "",
      "0",
      "停止中",
      'あ,"い',
    ]);
  });

  it("カンマ・引用符はエスケープされる", () => {
    const csv = vehiclesCsv([vehicleRow({ memo: 'あ,"い' })]);
    expect(csv).toContain('"あ,""い"');
  });

  it("書類 CSV はヘッダー付きで、対象の種別が入る", () => {
    const csv = documentsCsv([
      docRow({ kind: "license", driver_name: "相曽慧", expires_on: "2027-05-05", days_left: 200, expiry_status: "valid", reminder_days: 60 }),
      docRow({ id: "x", kind: "vehicle_inspection", driver_id: null, driver_name: "", vehicle_id: VEHICLE, vehicle_plate: "足立 480 あ 12-34", expires_on: "2026-09-01", days_left: -18, expiry_status: "expired" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(CSV_BOM + DOCUMENTS_CSV_HEADERS.join(","));
    expect(lines[1]).toContain("ドライバー");
    expect(lines[1]).toContain("有効");
    expect(lines[2]).toContain("車両");
    expect(lines[2]).toContain("期限切れ");
    expect(lines[2]).toContain("-18");
  });

  it("書類 1 行の値（期限なしは空欄）", () => {
    expect(documentToCsvRow(docRow({ label: "1 種免許", number: "1234", issued_on: "2021-05-05" }))).toEqual([
      "相曽慧",
      "ドライバー",
      "運転免許証",
      "1 種免許",
      "1234",
      "2021-05-05",
      "",
      "",
      "期限なし",
      "60",
      "有効",
      "",
    ]);
  });

  it("行が無くてもヘッダーだけの CSV になる", () => {
    expect(documentsCsv([])).toBe(CSV_BOM + DOCUMENTS_CSV_HEADERS.join(",") + "\r\n");
    expect(vehiclesCsv([])).toBe(CSV_BOM + VEHICLES_CSV_HEADERS.join(",") + "\r\n");
  });
});
