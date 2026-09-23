/**
 * デモの入力（MonthData）を変える純関数。画面（state.ts）はこの reducer に action を渡すだけにする。
 * 計算そのものは lib/payroll/calc に任せ、ここでは値の出し入れだけを行う。
 */
import { mergeWork } from "@/lib/payroll/calc";
import { sampleData } from "@/lib/payroll/sample";
import { monthEnd } from "@/lib/payroll/tax";
import type { Adjustment, CompanySettings, Driver, MonthData, Project, WorkRow } from "@/lib/payroll/types";
import { isDate, isMonth } from "./format";

export type PasteMode = "replace" | "add";

export type DemoAction =
  | { type: "load"; data: MonthData }
  | { type: "reset" }
  | { type: "setSettings"; patch: Partial<CompanySettings> }
  | { type: "setMonth"; month: string }
  | { type: "upsertDriver"; driver: Driver }
  | { type: "removeDriver"; id: string }
  | { type: "upsertProject"; project: Project }
  | { type: "removeProject"; id: string }
  | { type: "setQty"; driverId: string; projectId: string; qty: number }
  | { type: "applyPaste"; rows: WorkRow[]; mode: PasteMode }
  | { type: "addAdjustment"; adjustment: Adjustment }
  | { type: "removeAdjustment"; index: number };

const cleanQty = (qty: number) => Math.round(qty * 1e6) / 1e6;
const validQty = (qty: number) => Number.isFinite(qty) && qty >= 0;

function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

function monthFromIndex(index: number): string {
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/**
 * 対象月を変えたときの振込日。前の「対象月 → 振込日」の間隔（翌月・翌々月など）と日にちを保つ。
 * 前の振込日が月末なら新しい月でも月末にし、日にちがない月（31 日など）は月末に寄せる。
 */
export function shiftPayDate(oldMonth: string, oldPayDate: string, newMonth: string): string {
  if (!isMonth(newMonth)) return oldPayDate;
  if (!isMonth(oldMonth) || !isDate(oldPayDate)) return `${monthFromIndex(monthIndex(newMonth) + 1)}-25`;
  const payMonth = oldPayDate.slice(0, 7);
  const target = monthFromIndex(monthIndex(newMonth) + monthIndex(payMonth) - monthIndex(oldMonth));
  const lastOfTarget = Number(monthEnd(target).slice(8));
  const day = Number(oldPayDate.slice(8));
  const wasLastDay = oldPayDate === monthEnd(payMonth);
  const newDay = wasLastDay ? lastOfTarget : Math.min(day, lastOfTarget);
  return `${target}-${String(newDay).padStart(2, "0")}`;
}

/** 数字の連番で次の id を作る（d1, d2 … があれば d3） */
export function nextId(prefix: string, ids: string[]): string {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

/** 設定の画面で「ドライバーを足す」ときの空の行 */
export function newDriver(data: MonthData): Driver {
  const id = nextId("d", data.drivers.map((d) => d.id));
  return { id, name: `ドライバー${data.drivers.length + 1}`, invoiceRegistered: false, monthlyFee: 0, royaltyRate: 0 };
}

/** 設定の画面で「案件を足す」ときの空の行 */
export function newProject(data: MonthData): Project {
  const id = nextId("p", data.projects.map((p) => p.id));
  return { id, name: `案件${data.projects.length + 1}`, client: "", unit: "日", billRate: 0, payRate: 0 };
}

/** ドライバー × 案件の数量（同じ組み合わせの行が複数あれば足す） */
export function qtyOf(work: WorkRow[], driverId: string, projectId: string): number {
  let total = 0;
  for (const r of work) if (r.driverId === driverId && r.projectId === projectId) total += r.qty;
  return cleanQty(total);
}

function setQty(work: WorkRow[], driverId: string, projectId: string, qty: number): WorkRow[] {
  const match = (r: WorkRow) => r.driverId === driverId && r.projectId === projectId;
  if (qty === 0) return work.filter((r) => !match(r));
  if (!work.some(match)) return [...work, { driverId, projectId, qty }];
  const out: WorkRow[] = [];
  let placed = false;
  for (const r of work) {
    if (!match(r)) out.push(r);
    else if (!placed) {
      out.push({ ...r, qty });
      placed = true;
    }
  }
  return out;
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  return i < 0 ? [...list, item] : list.map((x, j) => (j === i ? item : x));
}

export function demoReducer(state: MonthData, action: DemoAction): MonthData {
  switch (action.type) {
    case "load":
      return action.data;
    case "reset":
      return sampleData();
    case "setSettings": {
      const patch = { ...action.patch };
      if (patch.month !== undefined && !isMonth(patch.month)) delete patch.month;
      if (patch.payDate !== undefined && !isDate(patch.payDate)) delete patch.payDate;
      return { ...state, settings: { ...state.settings, ...patch } };
    }
    case "setMonth": {
      const s = state.settings;
      if (!isMonth(action.month) || action.month === s.month) return state;
      return { ...state, settings: { ...s, month: action.month, payDate: shiftPayDate(s.month, s.payDate, action.month) } };
    }
    case "upsertDriver":
      return { ...state, drivers: upsertById(state.drivers, action.driver) };
    case "removeDriver":
      return {
        ...state,
        drivers: state.drivers.filter((d) => d.id !== action.id),
        work: state.work.filter((r) => r.driverId !== action.id),
        adjustments: state.adjustments.filter((a) => a.driverId !== action.id),
      };
    case "upsertProject":
      return { ...state, projects: upsertById(state.projects, action.project) };
    case "removeProject":
      return {
        ...state,
        projects: state.projects.filter((p) => p.id !== action.id),
        work: state.work.filter((r) => r.projectId !== action.id),
      };
    case "setQty": {
      if (!validQty(action.qty)) return state;
      return { ...state, work: setQty(state.work, action.driverId, action.projectId, cleanQty(action.qty)) };
    }
    case "applyPaste": {
      const rows = action.rows.filter((r) => validQty(r.qty));
      const merged = mergeWork(action.mode === "replace" ? rows : [...state.work, ...rows]);
      return { ...state, work: merged.filter((r) => r.qty > 0) };
    }
    case "addAdjustment": {
      const a = action.adjustment;
      if (!Number.isFinite(a.amount) || a.amount === 0 || !state.drivers.some((d) => d.id === a.driverId)) return state;
      return { ...state, adjustments: [...state.adjustments, { driverId: a.driverId, label: a.label.trim() || "調整", amount: a.amount }] };
    }
    case "removeAdjustment":
      if (action.index < 0 || action.index >= state.adjustments.length) return state;
      return { ...state, adjustments: state.adjustments.filter((_, i) => i !== action.index) };
  }
}

/** 貼り付け欄の「例を入れる」用。今の稼働をタブ区切り（見出しつき）で max 行まで */
export function pasteExample(data: MonthData, max = 4): string {
  const drivers = new Map(data.drivers.map((d) => [d.id, d.name]));
  const projects = new Map(data.projects.map((p) => [p.id, p.name]));
  const lines = ["ドライバー\t案件\t数量"];
  for (const r of data.work) {
    const d = drivers.get(r.driverId);
    const p = projects.get(r.projectId);
    if (!d || !p || !(r.qty > 0)) continue;
    lines.push(`${d}\t${p}\t${r.qty}`);
    if (lines.length > max) break;
  }
  return lines.join("\n");
}
