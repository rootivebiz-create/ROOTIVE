/**
 * 配車（これから先の予定）の組み立て（純関数）。
 *
 * DB からは「必要人数」「割り当て」「休み希望」を素のまま取り、
 * 週のボード・過不足・自動割り当ての提案・売上の見込みはここで組み立てる。
 * 日付は JST の "YYYY-MM-DD" 文字列で扱う（`lib/daily/helpers.ts` と同じ）。
 */
import { addDays, weekdayJa } from "@/lib/daily/helpers";
import { mulMoney, sumMoney } from "@/lib/calc";
import type { Unit } from "@/lib/calc";

/** 配車に使う案件内容 */
export interface DispatchItem {
  id: string;
  projectId: string;
  projectName: string;
  itemName: string;
  /** 「三郷Amazon（大型）」のような表示名 */
  label: string;
  unit: Unit;
  billRate: number;
  payRate: number;
}

/** 配車に使うドライバー */
export interface DispatchDriver {
  id: string;
  name: string;
  /** 定休日の曜日（0 = 日曜） */
  weeklyOff: number[];
}

/** 曜日ごとの必要人数 */
export interface DemandPattern {
  projectItemId: string;
  weekday: number;
  need: number;
}

/** 特定の日だけの必要人数（曜日のパターンより優先） */
export interface DemandDay {
  projectItemId: string;
  onDate: string;
  need: number;
}

export type DayOffStatus = "requested" | "approved" | "rejected";

export interface DayOff {
  driverId: string;
  onDate: string;
  status: DayOffStatus;
}

export type DispatchStatus = "planned" | "confirmed" | "cancelled";

export interface Assignment {
  id: string;
  onDate: string;
  driverId: string;
  projectItemId: string;
  qtyPlan: number;
  status: DispatchStatus;
  /** その日・その案件の報告（日別の稼働）が出ているか */
  hasReport?: boolean;
}

/** その日にその人が動けない理由 */
export type OffReason = "none" | "weekly" | "requested" | "approved";

export interface BoardCellDriver {
  driverId: string;
  driverName: string;
  qtyPlan: number;
  status: DispatchStatus;
  hasReport: boolean;
}

export interface BoardItemDay {
  date: string;
  need: number;
  assigned: number;
  /** 足りない人数（0 以上） */
  shortage: number;
  /** 多すぎる人数（0 以上） */
  excess: number;
  drivers: BoardCellDriver[];
}

export interface BoardItemRow {
  item: DispatchItem;
  days: BoardItemDay[];
  totalNeed: number;
  totalAssigned: number;
  totalShortage: number;
}

export interface BoardDriverDay {
  date: string;
  off: OffReason;
  items: { projectItemId: string; label: string; qtyPlan: number; status: DispatchStatus }[];
}

export interface BoardDriverRow {
  driver: DispatchDriver;
  days: BoardDriverDay[];
  /** 割り当てのある日数 */
  workDays: number;
  /** 休み（承認済み・定休日）の日数 */
  offDays: number;
}

export interface BoardTotals {
  need: number;
  assigned: number;
  shortage: number;
  /** 予定の売上・支払・粗利（配車 × 単価） */
  planBill: number;
  planPay: number;
  planMargin: number;
}

export interface DispatchBoard {
  dates: string[];
  items: BoardItemRow[];
  drivers: BoardDriverRow[];
  /** 人が足りない日（多い順 → 日付順） */
  shortages: { date: string; projectItemId: string; label: string; shortage: number }[];
  totals: BoardTotals;
}

export interface BoardInput {
  dates: string[];
  items: DispatchItem[];
  drivers: DispatchDriver[];
  patterns: DemandPattern[];
  demandDays: DemandDay[];
  assignments: Assignment[];
  dayOffs: DayOff[];
}

/* ------------------------------------------------------------------ *
 * 日付
 * ------------------------------------------------------------------ */

/** その日の曜日（0 = 日曜）。"YYYY-MM-DD" を UTC として読む（時差でずれないように） */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** その週の月曜日 */
export function weekStart(date: string): string {
  const w = weekdayOf(date);
  // 日曜（0）は前の週の月曜まで 6 日戻る
  return addDays(date, w === 0 ? -6 : 1 - w);
}

/** 連続する日付（既定は 1 週間） */
export function dateRange(start: string, days = 7): string[] {
  return Array.from({ length: Math.max(0, days) }, (_, i) => addDays(start, i));
}

/** 「9/22（月）」のような見出し */
export function shortDateJa(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}（${weekdayJa(date)}）`;
}

/* ------------------------------------------------------------------ *
 * 必要人数
 * ------------------------------------------------------------------ */

function keyOf(itemId: string, date: string): string {
  return `${itemId}\u0000${date}`;
}

/** その日・その案件内容の必要人数（特定日の上書き → 曜日のパターン → 0） */
export function needFor(
  projectItemId: string,
  date: string,
  patterns: readonly DemandPattern[],
  demandDays: readonly DemandDay[],
): number {
  const day = demandDays.find((d) => d.projectItemId === projectItemId && d.onDate === date);
  if (day) return Math.max(0, day.need);
  const w = weekdayOf(date);
  const pattern = patterns.find((p) => p.projectItemId === projectItemId && p.weekday === w);
  return pattern ? Math.max(0, pattern.need) : 0;
}

/** その日にその人が動けない理由（定休日 → 承認済みの休み → 申請中） */
export function offReasonFor(driver: DispatchDriver, date: string, dayOffs: readonly DayOff[]): OffReason {
  const off = dayOffs.find((o) => o.driverId === driver.id && o.onDate === date);
  if (off?.status === "approved") return "approved";
  if (driver.weeklyOff.includes(weekdayOf(date))) return "weekly";
  if (off?.status === "requested") return "requested";
  return "none";
}

/* ------------------------------------------------------------------ *
 * ボード
 * ------------------------------------------------------------------ */

/** 週（や任意の期間）の配車ボードを組み立てる */
export function buildDispatchBoard(input: BoardInput): DispatchBoard {
  const { dates, items, drivers, patterns, demandDays, assignments, dayOffs } = input;
  const live = assignments.filter((a) => a.status !== "cancelled");
  const driverName = new Map(drivers.map((d) => [d.id, d.name]));
  const itemById = new Map(items.map((i) => [i.id, i]));

  // 案件内容 × 日 の割り当て
  const byItemDay = new Map<string, Assignment[]>();
  for (const a of live) {
    const k = keyOf(a.projectItemId, a.onDate);
    const list = byItemDay.get(k) ?? [];
    list.push(a);
    byItemDay.set(k, list);
  }

  const itemRows: BoardItemRow[] = items.map((item) => {
    const days: BoardItemDay[] = dates.map((date) => {
      const need = needFor(item.id, date, patterns, demandDays);
      const rows = (byItemDay.get(keyOf(item.id, date)) ?? []).slice().sort((a, b) => {
        const an = driverName.get(a.driverId) ?? "";
        const bn = driverName.get(b.driverId) ?? "";
        return an.localeCompare(bn, "ja");
      });
      const assigned = rows.length;
      return {
        date,
        need,
        assigned,
        shortage: Math.max(0, need - assigned),
        excess: Math.max(0, assigned - need),
        drivers: rows.map((a) => ({
          driverId: a.driverId,
          driverName: driverName.get(a.driverId) ?? "",
          qtyPlan: a.qtyPlan,
          status: a.status,
          hasReport: a.hasReport ?? false,
        })),
      };
    });
    return {
      item,
      days,
      totalNeed: days.reduce((s, d) => s + d.need, 0),
      totalAssigned: days.reduce((s, d) => s + d.assigned, 0),
      totalShortage: days.reduce((s, d) => s + d.shortage, 0),
    };
  });

  const driverRows: BoardDriverRow[] = drivers.map((driver) => {
    const days: BoardDriverDay[] = dates.map((date) => {
      const mine = live.filter((a) => a.driverId === driver.id && a.onDate === date);
      return {
        date,
        off: offReasonFor(driver, date, dayOffs),
        items: mine.map((a) => ({
          projectItemId: a.projectItemId,
          label: itemById.get(a.projectItemId)?.label ?? "",
          qtyPlan: a.qtyPlan,
          status: a.status,
        })),
      };
    });
    return {
      driver,
      days,
      workDays: days.filter((d) => d.items.length > 0).length,
      offDays: days.filter((d) => d.off === "approved" || d.off === "weekly").length,
    };
  });

  const shortages = itemRows
    .flatMap((row) =>
      row.days
        .filter((d) => d.shortage > 0)
        .map((d) => ({ date: d.date, projectItemId: row.item.id, label: row.item.label, shortage: d.shortage })),
    )
    .sort((a, b) => (a.date === b.date ? b.shortage - a.shortage : a.date < b.date ? -1 : 1));

  const planBill = sumMoney(live.map((a) => mulMoney(itemById.get(a.projectItemId)?.billRate ?? 0, a.qtyPlan)));
  const planPay = sumMoney(live.map((a) => mulMoney(itemById.get(a.projectItemId)?.payRate ?? 0, a.qtyPlan)));

  return {
    dates,
    items: itemRows,
    drivers: driverRows,
    shortages,
    totals: {
      need: itemRows.reduce((s, r) => s + r.totalNeed, 0),
      assigned: itemRows.reduce((s, r) => s + r.totalAssigned, 0),
      shortage: itemRows.reduce((s, r) => s + r.totalShortage, 0),
      planBill,
      planPay,
      planMargin: sumMoney([planBill, -planPay]),
    },
  };
}

/* ------------------------------------------------------------------ *
 * 自動割り当て
 * ------------------------------------------------------------------ */

export interface AutoAssignProposal {
  onDate: string;
  driverId: string;
  driverName: string;
  projectItemId: string;
  label: string;
  qtyPlan: number;
}

export interface AutoAssignResult {
  proposals: AutoAssignProposal[];
  /** 人が足りずに埋められなかったところ */
  unfilled: { date: string; projectItemId: string; label: string; shortage: number }[];
}

export interface AutoAssignOptions {
  /** 予定の数量を決める（既定は 1）。直近の実績から埋めたいときに渡す */
  qtyFor?: (projectItemId: string, driverId: string) => number;
  /** 1 人 1 日に入れる案件の数（既定は 1） */
  maxItemsPerDay?: number;
}

/**
 * 足りないところを埋める提案を作る（**保存はしない**）。
 *
 * - 承認済みの休み・定休日の人は外す（申請中は「使えるが避ける」）
 * - 同じ日に入れすぎない
 * - その案件に入った回数が多い人を優先し、同じなら割り当ての少ない人へ回す
 * - 迷ったら名前の順（同じ入力なら必ず同じ結果になるように）
 */
export function autoAssign(board: DispatchBoard, options: AutoAssignOptions = {}): AutoAssignResult {
  const qtyFor = options.qtyFor ?? (() => 1);
  const maxPerDay = Math.max(1, options.maxItemsPerDay ?? 1);

  // いまの割り当て状況（提案を足しながら更新する）
  const perDay = new Map<string, number>(); // driverId|date → 件数
  const perItem = new Map<string, number>(); // driverId|itemId → 件数（慣れているか）
  const totalPer = new Map<string, number>(); // driverId → 件数（公平さ）
  for (const row of board.drivers) {
    for (const day of row.days) {
      if (day.items.length > 0) perDay.set(`${row.driver.id}|${day.date}`, day.items.length);
      for (const it of day.items) {
        perItem.set(`${row.driver.id}|${it.projectItemId}`, (perItem.get(`${row.driver.id}|${it.projectItemId}`) ?? 0) + 1);
        totalPer.set(row.driver.id, (totalPer.get(row.driver.id) ?? 0) + 1);
      }
    }
  }

  const offOf = new Map<string, OffReason>();
  for (const row of board.drivers) for (const day of row.days) offOf.set(`${row.driver.id}|${day.date}`, day.off);

  const proposals: AutoAssignProposal[] = [];
  const unfilled: AutoAssignResult["unfilled"] = [];

  // 日付の早い順 → 足りない人数の多い順に埋める
  const holes = board.items
    .flatMap((row) => row.days.filter((d) => d.shortage > 0).map((d) => ({ row, day: d })))
    .sort((a, b) => (a.day.date === b.day.date ? b.day.shortage - a.day.shortage : a.day.date < b.day.date ? -1 : 1));

  for (const hole of holes) {
    const { row, day } = hole;
    const already = new Set(day.drivers.map((d) => d.driverId));
    let left = day.shortage;

    const candidates = board.drivers
      .map((d) => d.driver)
      .filter((d) => {
        if (already.has(d.id)) return false;
        const off = offOf.get(`${d.id}|${day.date}`) ?? "none";
        if (off === "approved" || off === "weekly") return false;
        return (perDay.get(`${d.id}|${day.date}`) ?? 0) < maxPerDay;
      })
      .sort((a, b) => {
        // 申請中の休みは最後に回す
        const aReq = (offOf.get(`${a.id}|${day.date}`) ?? "none") === "requested" ? 1 : 0;
        const bReq = (offOf.get(`${b.id}|${day.date}`) ?? "none") === "requested" ? 1 : 0;
        if (aReq !== bReq) return aReq - bReq;
        const aExp = perItem.get(`${a.id}|${row.item.id}`) ?? 0;
        const bExp = perItem.get(`${b.id}|${row.item.id}`) ?? 0;
        if (aExp !== bExp) return bExp - aExp;
        const aTot = totalPer.get(a.id) ?? 0;
        const bTot = totalPer.get(b.id) ?? 0;
        if (aTot !== bTot) return aTot - bTot;
        return a.name.localeCompare(b.name, "ja");
      });

    for (const d of candidates) {
      if (left <= 0) break;
      proposals.push({
        onDate: day.date,
        driverId: d.id,
        driverName: d.name,
        projectItemId: row.item.id,
        label: row.item.label,
        qtyPlan: qtyFor(row.item.id, d.id),
      });
      perDay.set(`${d.id}|${day.date}`, (perDay.get(`${d.id}|${day.date}`) ?? 0) + 1);
      perItem.set(`${d.id}|${row.item.id}`, (perItem.get(`${d.id}|${row.item.id}`) ?? 0) + 1);
      totalPer.set(d.id, (totalPer.get(d.id) ?? 0) + 1);
      left -= 1;
    }

    if (left > 0) unfilled.push({ date: day.date, projectItemId: row.item.id, label: row.item.label, shortage: left });
  }

  return { proposals, unfilled };
}

/* ------------------------------------------------------------------ *
 * 見込み
 * ------------------------------------------------------------------ */

export interface DispatchForecast {
  /** 配車のある日数 */
  days: number;
  assignments: number;
  bill: number;
  pay: number;
  margin: number;
}

/** 配車（予定）から売上・支払・粗利の見込みを出す */
export function dispatchForecast(assignments: readonly Assignment[], items: readonly DispatchItem[]): DispatchForecast {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const live = assignments.filter((a) => a.status !== "cancelled");
  const bill = sumMoney(live.map((a) => mulMoney(itemById.get(a.projectItemId)?.billRate ?? 0, a.qtyPlan)));
  const pay = sumMoney(live.map((a) => mulMoney(itemById.get(a.projectItemId)?.payRate ?? 0, a.qtyPlan)));
  return {
    days: new Set(live.map((a) => a.onDate)).size,
    assignments: live.length,
    bill,
    pay,
    margin: sumMoney([bill, -pay]),
  };
}

/* ------------------------------------------------------------------ *
 * これから 2 週間の見通し（ダッシュボード）
 * ------------------------------------------------------------------ */

/** `v_dispatch_outlook` の 1 日ぶん */
export interface OutlookDay {
  date: string;
  need: number;
  assigned: number;
  confirmed: number;
  shortage: number;
  planBill: number;
  planPay: number;
  planMargin: number;
}

export interface DispatchOutlook {
  days: OutlookDay[];
  /** 人が足りない日（日付順） */
  shortDays: OutlookDay[];
  /** いちばん近い足りない日 */
  firstShortDate: string | null;
  /** まだ確定していない割り当ての数 */
  unconfirmed: number;
  totals: {
    need: number;
    assigned: number;
    confirmed: number;
    shortage: number;
    planBill: number;
    planPay: number;
    planMargin: number;
  };
}

/**
 * ダッシュボードの「これからの配車」をまとめる（純関数）。
 *
 * 行は `v_dispatch_outlook` から来る（日ごとに 1 行・今日から 14 日）。
 * `days` で何日ぶんを見るかを決める（既定は 7 日）。
 */
export function summarizeOutlook(rows: readonly OutlookDay[], days = 7): DispatchOutlook {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date)).slice(0, Math.max(days, 0));
  const shortDays = sorted.filter((d) => d.shortage > 0);
  const sum = (pick: (d: OutlookDay) => number) => sorted.reduce((acc, d) => acc + pick(d), 0);
  const planBill = sumMoney(sorted.map((d) => d.planBill));
  const planPay = sumMoney(sorted.map((d) => d.planPay));
  return {
    days: sorted,
    shortDays,
    firstShortDate: shortDays[0]?.date ?? null,
    unconfirmed: sum((d) => Math.max(d.assigned - d.confirmed, 0)),
    totals: {
      need: sum((d) => d.need),
      assigned: sum((d) => d.assigned),
      confirmed: sum((d) => d.confirmed),
      shortage: sum((d) => d.shortage),
      planBill,
      planPay,
      planMargin: sumMoney([planBill, -planPay]),
    },
  };
}
