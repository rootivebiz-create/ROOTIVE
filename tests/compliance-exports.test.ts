import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/exports/csv";
import {
  APTITUDE_CSV_HEADERS,
  COMPLIANCE_CSV_KINDS,
  INCIDENT_CSV_HEADERS,
  INSTRUCTION_CSV_HEADERS,
  ROSTER_CSV_HEADERS,
  aptitudeCsvRows,
  complianceCsvFilename,
  complianceCsvKindFromParam,
  incidentCsvRows,
  instructionCsvRows,
  rosterCsvRows,
  rosterToCsv,
  type IncidentCsvSource,
  type InstructionCsvSource,
  type RosterCsvSource,
} from "@/lib/exports/compliance-csv";
import { AUDIT_PACK_PARTS, auditPackFilename, auditPackReadme, parseAuditPackParts } from "@/lib/exports/audit-pack";

const ROSTER = {
  driver_id: "d1",
  company_id: "c1",
  roster_no: "R-001",
  name: "相曽慧",
  kana: "アイソケイ",
  birth_date: "1986-04-01",
  age: 40,
  address: "埼玉県三郷市1-2-3",
  phone: "090-0000-0000",
  hired_on: "2024-04-01",
  appointed_on: "2024-04-01",
  retired_on: null,
  is_active: true,
  sort_order: 1,
  license_kinds: "普通",
  license_conditions: "眼鏡等",
  license_no: "123456789012",
  license_issued_on: "2023-05-01",
  license_expires_on: "2028-05-01",
  health_check_on: "2026-03-01",
  instruction_last_on: "2026-06-01",
  instruction_count: 3,
  aptitude_last_on: "2024-04-10",
  aptitude_initial_on: "2024-04-10",
  aptitude_age_on: null,
  accident_count: 0,
  violation_count: 1,
  keep_until: null,
} as unknown as RosterCsvSource;

describe("法定帳票の CSV", () => {
  it("運転者台帳は監査の様式どおりの列で出る", () => {
    const rows = rosterCsvRows([ROSTER]);
    expect(rows[0]).toEqual([...ROSTER_CSV_HEADERS]);
    expect(rows[1][0]).toBe("R-001");
    expect(rows[1][1]).toBe("相曽慧");
    expect(rows[1][4]).toBe("40");
    expect(rows[1][10]).toBe("在籍");
    expect(rows[1][11]).toBe("123456789012");
    expect(rows[1][24]).toBe(""); // 在籍中は保存期限が空
  });

  it("退職すると「退職」と保存期限が出る", () => {
    const [, row] = rosterCsvRows([{ ...ROSTER, retired_on: "2026-08-31", keep_until: "2029-08-31" } as RosterCsvSource]);
    expect(row[9]).toBe("2026-08-31");
    expect(row[10]).toBe("退職");
    expect(row[24]).toBe("2029-08-31");
  });

  it("未入力は空欄のまま（0 を入れない）", () => {
    const [, row] = rosterCsvRows([{ ...ROSTER, birth_date: null, age: null, address: "", license_no: null } as RosterCsvSource]);
    expect(row[3]).toBe("");
    expect(row[4]).toBe("");
    expect(row[5]).toBe("");
    expect(row[11]).toBe("");
  });

  it("指導の記録は種類が日本語になる", () => {
    const src: InstructionCsvSource = {
      instructed_on: "2026-06-01",
      driver_name: "相曽慧",
      kind: "initial",
      hours: 15,
      topics: "初任教育",
      instructor: "川島幹太",
      memo: "",
    };
    const rows = instructionCsvRows([src]);
    expect(rows[0]).toEqual([...INSTRUCTION_CSV_HEADERS]);
    expect(rows[1]).toEqual(["2026-06-01", "相曽慧", "初任運転者", "15", "初任教育", "川島幹太", ""]);
  });

  it("事故の記録は日時と○×が読める形になる", () => {
    const src: IncidentCsvSource = {
      occurred_at: "2026-09-18T09:30:00+09:00",
      driver_name: "相曽慧",
      vehicle_plate: "越谷 480 あ 12-34",
      kind: "accident",
      place: "三郷市",
      description: "追突",
      cause: "前方不注意",
      prevention: "車間距離の指導",
      reported: true,
      cost: 50000,
      memo: "",
    };
    const rows = incidentCsvRows([src]);
    expect(rows[0]).toEqual([...INCIDENT_CSV_HEADERS]);
    expect(rows[1][0]).toBe("2026-09-18 09:30");
    expect(rows[1][3]).toBe("事故");
    expect(rows[1][8]).toBe("済");
    expect(rows[1][9]).toBe("50000");
  });

  it("適性診断の記録は種類が日本語になる", () => {
    const rows = aptitudeCsvRows([
      { taken_on: "2024-04-10", driver_name: "相曽慧", kind: "initial", institution: "適性診断センター", result: "良", memo: "" },
    ]);
    expect(rows[0]).toEqual([...APTITUDE_CSV_HEADERS]);
    expect(rows[1][2]).toBe("初任診断");
  });

  it("CSV は BOM と CRLF、ファイル名に種類と日付が入る", () => {
    const csv = rosterToCsv([ROSTER]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).not.toMatch(/[^\r]\n/);
    expect(complianceCsvFilename("instruction", "2026-09-22")).toBe("指導・監督の記録_2026-09-22.csv");
  });

  it("?kind= は決まった値だけを受ける", () => {
    for (const k of COMPLIANCE_CSV_KINDS) expect(complianceCsvKindFromParam(k)).toBe(k);
    expect(complianceCsvKindFromParam("いたずら")).toBe("roster");
    expect(complianceCsvKindFromParam(null)).toBe("roster");
    expect(complianceCsvKindFromParam(["incident"])).toBe("incident");
  });
});

describe("監査一式 ZIP", () => {
  it("?parts= は決まった順で返し、空なら全部", () => {
    expect(parseAuditPackParts(null)).toEqual([...AUDIT_PACK_PARTS]);
    expect(parseAuditPackParts("")).toEqual([...AUDIT_PACK_PARTS]);
    expect(parseAuditPackParts("いたずら")).toEqual([...AUDIT_PACK_PARTS]);
    // 並びは AUDIT_PACK_PARTS の順（指定の順ではない）
    expect(parseAuditPackParts("labor,roster")).toEqual(["roster", "labor"]);
  });

  it("ファイル名に期間が入る", () => {
    expect(auditPackFilename("2025-09-22", "2026-09-22")).toBe("監査一式_2025-09-22_2026-09-22.zip");
  });

  it("README に中身と保存期間が並ぶ", () => {
    const txt = auditPackReadme({
      companyName: "株式会社ROOTIVE",
      from: "2025-09-22",
      to: "2026-09-22",
      generatedAt: "2026-09-22 18:00",
      files: [{ name: "運転者台帳.pdf", rows: 8 }],
      errors: [{ part: "labor", message: "権限がありません" }],
      retention: [{ label: "運転日報・点呼記録", years: 1, basis: "記録の日から" }],
    });
    expect(txt).toContain("株式会社ROOTIVE");
    expect(txt).toContain("運転者台帳.pdf（8 件）");
    expect(txt).toContain("拘束時間・休息（CSV）: 権限がありません");
    expect(txt).toContain("運転日報・点呼記録: 1 年（記録の日から）");
    expect(txt.endsWith("\r\n")).toBe(true);
  });

  it("何も作れなくても README は成立する", () => {
    const txt = auditPackReadme({
      companyName: "A",
      from: "2026-01-01",
      to: "2026-01-31",
      generatedAt: "2026-02-01 09:00",
      files: [],
      errors: [],
      retention: [],
    });
    expect(txt).toContain("（ありません）");
  });
});
