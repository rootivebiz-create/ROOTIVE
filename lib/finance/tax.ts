/**
 * 決算・税務の期限（tax_tasks）の純関数（React・DB に依存しない）
 *
 * - 緊急度はビュー `v_tax_task_list.urgency` と同じ規則で決める
 *   （済 → 期限切れ → 30 日以内は「まもなく」 → それ以外は「先の予定」）
 * - ここで出す期限はあくまで目安。正確な期限は税理士に確認してもらう
 */
import { sumMoney } from "@/lib/calc";
import type { TaxTaskStatus } from "@/lib/db/types";
import { fiscalPeriod, type FiscalSettings } from "@/lib/fiscal";
import { daysBetweenDates, yearOfDate } from "./date";

/** 「まもなく」と扱う日数（v_tax_task_list と同じ 30 日） */
export const TAX_SOON_DAYS = 30;

/** 緊急度（並べる順）。v_tax_task_list.urgency と同じ値 */
export const TAX_URGENCIES = ["overdue", "soon", "future", "done"] as const;
export type TaxUrgency = (typeof TAX_URGENCIES)[number];

export const TAX_URGENCY_DESCRIPTIONS: Record<TaxUrgency, string> = {
  overdue: "期限を過ぎています。至急ご確認ください。",
  soon: "30 日以内に期限が来ます。",
  future: "先の予定です。",
  done: "対応済み・対象外にしたものです。",
};

/** v_tax_task_list の 1 行のうち、画面で使う列だけ */
export interface TaxTaskLike {
  id?: string | null;
  kind?: string | null;
  title?: string | null;
  detail?: string | null;
  due_on?: string | null;
  status?: TaxTaskStatus | string | null;
  done_on?: string | null;
  amount?: number | null;
  memo?: string | null;
  is_generated?: boolean | null;
  days_left?: number | null;
  urgency?: string | null;
}

/** 期限までの残り日数（マイナスは超過） */
export function taxDaysLeft(dueOn: string | null | undefined, today: string): number {
  return daysBetweenDates(today, String(dueOn ?? ""));
}

/** 緊急度（v_tax_task_list.urgency と同じ規則） */
export function resolveTaxUrgency(status: string | null | undefined, dueOn: string | null | undefined, today: string): TaxUrgency {
  if (status !== "todo") return "done";
  const left = taxDaysLeft(dueOn, today);
  if (left < 0) return "overdue";
  return left <= TAX_SOON_DAYS ? "soon" : "future";
}

/** 画面で使う 1 件 */
export interface TaxTaskView {
  id: string;
  kind: string;
  title: string;
  detail: string;
  dueOn: string;
  status: TaxTaskStatus;
  doneOn: string;
  /** 納付額（未入力は null） */
  amount: number | null;
  memo: string;
  /** ensure_tax_tasks が作ったもの（false = 自分で足したもの） */
  isGenerated: boolean;
  daysLeft: number;
  urgency: TaxUrgency;
}

function isStatus(v: unknown): v is TaxTaskStatus {
  return v === "todo" || v === "done" || v === "skipped";
}

export function toTaxTaskView(row: TaxTaskLike, today: string): TaxTaskView {
  const status: TaxTaskStatus = isStatus(row.status) ? row.status : "todo";
  const dueOn = String(row.due_on ?? "");
  return {
    id: String(row.id ?? ""),
    kind: String(row.kind ?? ""),
    title: String(row.title ?? ""),
    detail: String(row.detail ?? ""),
    dueOn,
    status,
    doneOn: String(row.done_on ?? ""),
    amount: typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : null,
    memo: String(row.memo ?? ""),
    isGenerated: row.is_generated !== false,
    daysLeft: typeof row.days_left === "number" ? row.days_left : taxDaysLeft(dueOn, today),
    urgency: resolveTaxUrgency(status, dueOn, today),
  };
}

/** 並び順：期限切れ → まもなく → 先の予定 → 済。その中は期日の早い順（済だけ遅い順） */
export function sortTaxTasks(tasks: TaxTaskView[]): TaxTaskView[] {
  const order = (u: TaxUrgency) => TAX_URGENCIES.indexOf(u);
  return [...tasks].sort((a, b) => {
    const d = order(a.urgency) - order(b.urgency);
    if (d !== 0) return d;
    return a.urgency === "done" ? b.dueOn.localeCompare(a.dueOn) : a.dueOn.localeCompare(b.dueOn);
  });
}

export type TaxTaskGroups = Record<TaxUrgency, TaxTaskView[]>;

/** 緊急度ごとに分ける（それぞれ期日順） */
export function groupTaxTasks(tasks: TaxTaskView[]): TaxTaskGroups {
  const groups: TaxTaskGroups = { overdue: [], soon: [], future: [], done: [] };
  for (const t of sortTaxTasks(tasks)) groups[t.urgency].push(t);
  return groups;
}

export interface TaxCounts {
  total: number;
  todo: number;
  overdue: number;
  soon: number;
  done: number;
  /** 納付額の合計（未対応のもの） */
  todoAmount: number;
}

export function taxCounts(tasks: TaxTaskView[]): TaxCounts {
  const todo = tasks.filter((t) => t.status === "todo");
  return {
    total: tasks.length,
    todo: todo.length,
    overdue: tasks.filter((t) => t.urgency === "overdue").length,
    soon: tasks.filter((t) => t.urgency === "soon").length,
    done: tasks.filter((t) => t.status !== "todo").length,
    todoAmount: sumMoney(todo.map((t) => t.amount ?? 0)),
  };
}

export const ZERO_TAX_COUNTS: TaxCounts = { total: 0, todo: 0, overdue: 0, soon: 0, done: 0, todoAmount: 0 };

/** 残り日数の表示 */
export function daysLeftLabel(task: TaxTaskView): string {
  if (task.status !== "todo") return "—";
  if (task.daysLeft < 0) return `${-task.daysLeft} 日超過`;
  if (task.daysLeft === 0) return "今日が期限";
  return `あと ${task.daysLeft} 日`;
}

/** その年の期限だけ */
export function tasksOfYear(tasks: TaxTaskView[], year: number): TaxTaskView[] {
  return tasks.filter((t) => yearOfDate(t.dueOn) === year);
}

/** 期限が入っている年（降順。年セレクタに足す） */
export function taxYears(tasks: TaxTaskLike[]): number[] {
  const years = new Set<number>();
  for (const t of tasks) {
    const y = yearOfDate(t.due_on);
    if (y >= 2000 && y <= 2100) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * 年セレクタの表示：その年に決算を迎える期を添える（「2026年（第3期の決算）」）。
 * 期限は日付のカレンダーなので暦年で並べ、期の番号が無い（設立日が無い・設立前）ときは年だけ
 */
export function taxYearLabel(year: number, fiscal: FiscalSettings): string {
  const p = fiscalPeriod(year, fiscal);
  return p.number != null ? `${year}年（${p.label}の決算）` : `${year}年`;
}

/** その年の期限が作られているか（「まとめて作る」ボタンの出し分け） */
export function hasGeneratedTasks(tasks: TaxTaskView[]): boolean {
  return tasks.some((t) => t.isGenerated);
}
