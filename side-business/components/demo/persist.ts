/**
 * デモの入力をこの端末（localStorage）にだけ保存する。どこにも送らない。
 * 保存が使えない端末（プライベートモード・保存の拒否など）でも画面は動くよう、読み書きはすべて try/catch で包む。
 * 読み込んだ値は形を確かめてから使う（古い形・壊れた値ならサンプルに戻す）。
 */
import { sampleData } from "@/lib/payroll/sample";
import type { AccountType, Adjustment, BankAccount, CompanySettings, Driver, MonthData, Project, Rounding, WorkRow } from "@/lib/payroll/types";
import type { Requester } from "@/lib/payroll/zengin";
import { isDate, isMonth } from "./format";

export const MONTH_KEY = "demo:v1";
export const REQUESTER_KEY = "demo:requester:v1";

/** 振込依頼人（会社の口座）の架空の初期値 */
export function sampleRequester(): Requester {
  return {
    code: "1234567890",
    nameKana: "ｻﾝﾌﾟﾙｳﾝｿｳ(ｶ",
    bankCode: "0001",
    bankNameKana: "ﾐｽﾞﾎ",
    branchCode: "001",
    branchNameKana: "ﾎﾝﾃﾝ",
    accountType: "ordinary",
    accountNumber: "1111111",
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const rounding = (v: unknown, fallback: Rounding): Rounding => (v === "floor" || v === "round" || v === "ceil" ? v : fallback);
const accountType = (v: unknown): AccountType => (v === "checking" ? "checking" : "ordinary");

function parseSettings(v: Obj, base: CompanySettings): CompanySettings {
  const taxRate = num(v.taxRate, base.taxRate);
  const out: CompanySettings = {
    companyName: str(v.companyName, base.companyName),
    taxRate: taxRate > 0 && taxRate < 1 ? taxRate : base.taxRate,
    taxRounding: rounding(v.taxRounding, base.taxRounding),
    amountRounding: rounding(v.amountRounding, base.amountRounding),
    payTaxToExempt: typeof v.payTaxToExempt === "boolean" ? v.payTaxToExempt : base.payTaxToExempt,
    taxMethod: v.taxMethod === "simplified" ? "simplified" : "general",
    month: isMonth(str(v.month)) ? str(v.month) : base.month,
    payDate: isDate(str(v.payDate)) ? str(v.payDate) : base.payDate,
  };
  if (typeof v.companyRegistrationNo === "string") out.companyRegistrationNo = v.companyRegistrationNo;
  return out;
}

function parseBank(v: unknown): BankAccount | undefined {
  if (!isObj(v)) return undefined;
  return {
    bankCode: str(v.bankCode),
    bankNameKana: str(v.bankNameKana),
    branchCode: str(v.branchCode),
    branchNameKana: str(v.branchNameKana),
    accountType: accountType(v.accountType),
    accountNumber: str(v.accountNumber),
    holderKana: str(v.holderKana),
  };
}

function parseDriver(v: unknown): Driver | null {
  if (!isObj(v) || typeof v.id !== "string" || !v.id) return null;
  const rate = num(v.royaltyRate);
  const d: Driver = {
    id: v.id,
    name: str(v.name),
    invoiceRegistered: v.invoiceRegistered === true,
    monthlyFee: Math.max(0, num(v.monthlyFee)),
    royaltyRate: rate >= 0 && rate <= 1 ? rate : 0,
  };
  if (typeof v.registrationNo === "string") d.registrationNo = v.registrationNo;
  const bank = parseBank(v.bank);
  if (bank) d.bank = bank;
  return d;
}

function parseProject(v: unknown): Project | null {
  if (!isObj(v) || typeof v.id !== "string" || !v.id) return null;
  return {
    id: v.id,
    name: str(v.name),
    client: str(v.client),
    unit: str(v.unit),
    billRate: Math.max(0, num(v.billRate)),
    payRate: Math.max(0, num(v.payRate)),
  };
}

function uniqueById<T extends { id: string }>(list: (T | null)[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** 保存してあった値を MonthData に直す。形が違えば null（呼び出し側でサンプルを使う） */
export function parseMonthData(raw: unknown): MonthData | null {
  if (!isObj(raw) || !isObj(raw.settings) || !Array.isArray(raw.drivers) || !Array.isArray(raw.projects) || !Array.isArray(raw.work)) {
    return null;
  }
  const base = sampleData();
  const drivers = uniqueById(raw.drivers.map(parseDriver));
  const projects = uniqueById(raw.projects.map(parseProject));
  const driverIds = new Set(drivers.map((d) => d.id));
  const projectIds = new Set(projects.map((p) => p.id));
  const work: WorkRow[] = [];
  for (const r of raw.work) {
    if (!isObj(r)) continue;
    const qty = num(r.qty, -1);
    const driverId = str(r.driverId);
    const projectId = str(r.projectId);
    if (qty > 0 && driverIds.has(driverId) && projectIds.has(projectId)) work.push({ driverId, projectId, qty });
  }
  const adjustments: Adjustment[] = [];
  for (const a of Array.isArray(raw.adjustments) ? raw.adjustments : []) {
    if (!isObj(a)) continue;
    const amount = num(a.amount);
    const driverId = str(a.driverId);
    if (amount !== 0 && driverIds.has(driverId)) adjustments.push({ driverId, label: str(a.label, "調整"), amount });
  }
  return { settings: parseSettings(raw.settings, base.settings), drivers, projects, work, adjustments };
}

/** 保存してあった振込依頼人を直す。形が違えば null */
export function parseRequester(raw: unknown): Requester | null {
  if (!isObj(raw)) return null;
  const keys = ["code", "nameKana", "bankCode", "bankNameKana", "branchCode", "branchNameKana", "accountNumber"] as const;
  if (!keys.every((k) => typeof raw[k] === "string")) return null;
  return {
    code: str(raw.code),
    nameKana: str(raw.nameKana),
    bankCode: str(raw.bankCode),
    bankNameKana: str(raw.bankNameKana),
    branchCode: str(raw.branchCode),
    branchNameKana: str(raw.branchNameKana),
    accountType: accountType(raw.accountType),
    accountNumber: str(raw.accountNumber),
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 読めなければ null（保存が使えない・値がない・壊れている） */
export function readStored(key: string): unknown {
  try {
    const text = storage()?.getItem(key);
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
}

/** 書けたら true。書けなければ false（画面は保存なしで動き続ける） */
export function writeStored(key: string, value: unknown): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadMonthData(): MonthData | null {
  return parseMonthData(readStored(MONTH_KEY));
}

export function loadRequester(): Requester | null {
  return parseRequester(readStored(REQUESTER_KEY));
}
