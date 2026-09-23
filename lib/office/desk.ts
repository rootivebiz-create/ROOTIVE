/**
 * 事務（/office）の組み立て（純関数）。
 *
 * RPC `office_desk(month, today)` が返す行と事実を、画面の 3 つのまとまりにする。
 *   - 今日やること（buildInbox）      … 急ぐ順に並べた「やること」の一覧
 *   - 今日の報告（todayReporters）    … 今日報告が要る人・まだの人・催促できる人
 *   - 月締めの手順（buildClosingSteps）… 締めるまでの手順と、締めたあとの手順（支払明細の送付・振込）
 *
 * 判定はすべてここに置く（SQL は行と数を返すだけ。0025 の dashboard_cards と同じ考え方）。
 * 基準日は引数で受け取り、`new Date()` は使わない（同じ入力なら必ず同じ結果）。
 * 文章は日本語のみ。金額は `yen()`。
 */
import { yen } from "@/lib/format";
import { compareMonth, formatMonthJa } from "@/lib/month";
import { addDays } from "@/lib/daily/helpers";
import { weekdayOf, shortDateJa } from "@/lib/dispatch/board";

/* ------------------------------------------------------------------ *
 * RPC の形（office_desk）
 * ------------------------------------------------------------------ */

export interface DeskPendingEntry {
  id: string;
  workDate: string;
  driverId: string;
  driverName: string;
  projectName: string;
  itemName: string;
  unit: string;
  qty: number;
  memo: string;
}

export interface DeskDayOff {
  id: string;
  onDate: string;
  driverId: string;
  driverName: string;
  reason: string;
}

export interface DeskDriver {
  id: string;
  name: string;
  weeklyOff: number[];
  lineLinked: boolean;
  hasLogin: boolean;
}

export interface DeskReminder {
  driverId: string;
  sentAt: string;
  sentByName: string;
}

export interface DeskInvoice {
  id: string;
  clientName: string;
  invoiceNo: string;
  month: string;
  dueDate: string | null;
  total: number;
}

export interface DeskAlert {
  id: string;
  code: string;
  title: string;
  href: string;
}

export interface DeskTomorrow {
  onDate: string;
  need: number;
  assigned: number;
  confirmed: number;
  shortage: number;
}

export interface ClosingFacts {
  status: "open" | "closed";
  closedAt: string | null;
  entryCount: number;
  zeroQty: number;
  pending: number;
  rollCallMissing: number;
  noReport: number;
  rateDiffs: number;
  recurringDue: number;
  recurringUnapplied: number;
  notices: number;
  noticeDiffs: number;
  clients: { clientId: string; clientName: string; bill: number }[];
  unassignedBill: number;
  invoices: { id: string; clientId: string; status: "draft" | "issued" | "paid"; total: number }[];
  /** 支払明細を送る相手（その月に数量 > 0 の稼働がある人）の数（0028） */
  statementTargets: number;
  /** そのうち明細を送った記録（statement_deliveries）がある人の数 */
  statementSent: number;
  /** そのうち LINE が届くのに、まだ送っていない人の数 */
  statementLineReady: number;
  checks: { key: string; doneAt: string; doneByName: string }[];
}

/** 締めたあとの手順が残っているかもしれない直近の月（締めて 45 日以内。0028） */
export interface DeskAfterClose {
  /** "YYYY-MM" */
  month: string;
  closedAt: string | null;
  statementTargets: number;
  statementSent: number;
  /** 手で付けたチェックの名前（month_close_checks.key） */
  checks: string[];
}

export interface OfficeDesk {
  today: string;
  /** 月締めの手順の対象月（"YYYY-MM"） */
  month: string;
  pendingEntries: DeskPendingEntry[];
  pendingEntriesTotal: number;
  dayOffs: DeskDayOff[];
  drivers: DeskDriver[];
  todayReports: { driverId: string; preAt: string | null; postAt: string | null }[];
  todayEntryDrivers: string[];
  todayDispatchDrivers: string[];
  todayOffDrivers: string[];
  reminders: DeskReminder[];
  tomorrow: DeskTomorrow | null;
  invoicesIssued: DeskInvoice[];
  bankUnmatched: number;
  alertsHigh: DeskAlert[];
  alertsOpen: number;
  /** 締めていない過去の月（"YYYY-MM"、古い順） */
  openPastMonths: string[];
  afterClose: DeskAfterClose | null;
  closing: ClosingFacts;
}

/* ---------- 取り出し（壊れた値・欠けた値でも落ちない） ---------- */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const bool = (v: unknown): boolean => v === true || v === "true";
const dateOnly = (v: unknown): string => str(v).slice(0, 10);
const monthOnly = (v: unknown): string => str(v).slice(0, 7);
const strOrNull = (v: unknown): string | null => (v == null || v === "" ? null : str(v));

/** RPC の戻り値を画面で使う形にする */
export function parseOfficeDesk(raw: unknown): OfficeDesk {
  const o = obj(raw);
  const c = obj(o.closing);
  const t = o.tomorrow == null ? null : obj(o.tomorrow);
  const ac = o.after_close == null ? null : obj(o.after_close);
  return {
    today: dateOnly(o.today),
    month: monthOnly(o.month),
    pendingEntries: arr(o.pending_entries).map((r) => {
      const x = obj(r);
      return {
        id: str(x.id),
        workDate: dateOnly(x.work_date),
        driverId: str(x.driver_id),
        driverName: str(x.driver_name),
        projectName: str(x.project_name),
        itemName: str(x.item_name),
        unit: str(x.unit),
        qty: num(x.qty),
        memo: str(x.memo),
      };
    }),
    pendingEntriesTotal: num(o.pending_entries_total),
    dayOffs: arr(o.day_offs).map((r) => {
      const x = obj(r);
      return { id: str(x.id), onDate: dateOnly(x.on_date), driverId: str(x.driver_id), driverName: str(x.driver_name), reason: str(x.reason) };
    }),
    drivers: arr(o.drivers).map((r) => {
      const x = obj(r);
      return {
        id: str(x.id),
        name: str(x.name),
        weeklyOff: arr(x.weekly_off).map(num),
        lineLinked: bool(x.line_linked),
        hasLogin: bool(x.has_login),
      };
    }),
    todayReports: arr(o.today_reports).map((r) => {
      const x = obj(r);
      return { driverId: str(x.driver_id), preAt: strOrNull(x.pre_at), postAt: strOrNull(x.post_at) };
    }),
    todayEntryDrivers: arr(o.today_entry_drivers).map(str),
    todayDispatchDrivers: arr(o.today_dispatch_drivers).map(str),
    todayOffDrivers: arr(o.today_off_drivers).map(str),
    reminders: arr(o.reminders).map((r) => {
      const x = obj(r);
      return { driverId: str(x.driver_id), sentAt: str(x.sent_at), sentByName: str(x.sent_by_name) };
    }),
    tomorrow: t
      ? {
          onDate: dateOnly(t.on_date),
          need: num(t.need),
          assigned: num(t.assigned),
          confirmed: num(t.confirmed),
          shortage: num(t.shortage),
        }
      : null,
    invoicesIssued: arr(o.invoices_issued).map((r) => {
      const x = obj(r);
      return {
        id: str(x.id),
        clientName: str(x.client_name),
        invoiceNo: str(x.invoice_no),
        month: monthOnly(x.month),
        dueDate: strOrNull(dateOnly(x.due_date)),
        total: num(x.total),
      };
    }),
    bankUnmatched: num(o.bank_unmatched),
    alertsHigh: arr(o.alerts_high).map((r) => {
      const x = obj(r);
      return { id: str(x.id), code: str(x.code), title: str(x.title), href: str(x.href) };
    }),
    alertsOpen: num(o.alerts_open),
    openPastMonths: arr(o.open_past_months).map(monthOnly).filter(Boolean),
    afterClose:
      ac && monthOnly(ac.month)
        ? {
            month: monthOnly(ac.month),
            closedAt: strOrNull(ac.closed_at),
            statementTargets: num(ac.statement_targets),
            statementSent: num(ac.statement_sent),
            checks: arr(ac.checks).map(str),
          }
        : null,
    closing: {
      status: str(c.status) === "closed" ? "closed" : "open",
      closedAt: strOrNull(c.closed_at),
      entryCount: num(c.entry_count),
      zeroQty: num(c.zero_qty),
      pending: num(c.pending),
      rollCallMissing: num(c.roll_call_missing),
      noReport: num(c.no_report),
      rateDiffs: num(c.rate_diffs),
      recurringDue: num(c.recurring_due),
      recurringUnapplied: num(c.recurring_unapplied),
      notices: num(c.notices),
      noticeDiffs: num(c.notice_diffs),
      clients: arr(c.clients).map((r) => {
        const x = obj(r);
        return { clientId: str(x.client_id), clientName: str(x.client_name), bill: num(x.bill) };
      }),
      unassignedBill: num(c.unassigned_bill),
      invoices: arr(c.invoices).map((r) => {
        const x = obj(r);
        const s = str(x.status);
        return { id: str(x.id), clientId: str(x.client_id), status: s === "paid" ? "paid" : s === "issued" ? "issued" : "draft", total: num(x.total) };
      }),
      statementTargets: num(c.statement_targets),
      statementSent: num(c.statement_sent),
      statementLineReady: num(c.statement_line_ready),
      checks: arr(c.checks).map((r) => {
        const x = obj(r);
        return { key: str(x.key), doneAt: str(x.done_at), doneByName: str(x.done_by_name) };
      }),
    },
  };
}

/* ------------------------------------------------------------------ *
 * 時刻の表示（日本時間の「10:32」）
 * ------------------------------------------------------------------ */

export function timeJa(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(d);
}

/* ------------------------------------------------------------------ *
 * 今日の報告
 * ------------------------------------------------------------------ */

/**
 * 今日報告が要る人の決め方
 *   - その日に配車があるとき（配車を使っている会社）… 配車に入っている人
 *   - 配車が 1 件も無いとき … 稼働中のドライバーのうち、定休日でない人
 *   どちらも、承認済みの休みの人は外す。
 * 「報告済み」は、業務前点呼がある か その日の稼働を出している こと。
 */
export type ReporterBasis = "dispatch" | "usual";

export interface Reporter {
  driverId: string;
  name: string;
  reported: boolean;
  /** 催促済みなら、いつ・だれが */
  remindedAt: string | null;
  remindedBy: string;
  /** アプリにログインできる（端末への通知が届きうる） */
  hasLogin: boolean;
  lineLinked: boolean;
  /** 催促が届く手段がある（ログインか LINE） */
  reachable: boolean;
}

export interface TodayReporters {
  basis: ReporterBasis;
  /** 今日報告が要る人 */
  expected: Reporter[];
  /** そのうちまだの人（名前の順は稼働中のドライバーの並び） */
  missing: Reporter[];
  /** まだの人のうち、今日まだ催促しておらず、届く手段がある人（催促ボタンの宛先） */
  remindTargets: Reporter[];
  reportedCount: number;
}

export function todayReporters(desk: Pick<OfficeDesk, "today" | "drivers" | "todayReports" | "todayEntryDrivers" | "todayDispatchDrivers" | "todayOffDrivers" | "reminders">): TodayReporters {
  const off = new Set(desk.todayOffDrivers);
  const dispatched = new Set(desk.todayDispatchDrivers);
  const basis: ReporterBasis = dispatched.size > 0 ? "dispatch" : "usual";
  const w = desk.today ? weekdayOf(desk.today) : -1;
  const preDone = new Set(desk.todayReports.filter((r) => r.preAt).map((r) => r.driverId));
  const entryDone = new Set(desk.todayEntryDrivers);
  const reminded = new Map(desk.reminders.map((r) => [r.driverId, r]));

  const expected: Reporter[] = desk.drivers
    .filter((d) => !off.has(d.id))
    .filter((d) => (basis === "dispatch" ? dispatched.has(d.id) : !d.weeklyOff.includes(w)))
    .map((d) => {
      const r = reminded.get(d.id);
      return {
        driverId: d.id,
        name: d.name,
        reported: preDone.has(d.id) || entryDone.has(d.id),
        remindedAt: r?.sentAt ?? null,
        remindedBy: r?.sentByName ?? "",
        hasLogin: d.hasLogin,
        lineLinked: d.lineLinked,
        reachable: d.hasLogin || d.lineLinked,
      };
    });
  const missing = expected.filter((r) => !r.reported);
  return {
    basis,
    expected,
    missing,
    remindTargets: missing.filter((r) => r.reachable && !r.remindedAt),
    reportedCount: expected.length - missing.length,
  };
}

/* ------------------------------------------------------------------ *
 * 今日やること
 * ------------------------------------------------------------------ */

export type InboxUrgency = "now" | "today" | "soon";

export const INBOX_URGENCY_LABELS: Record<InboxUrgency, string> = {
  now: "急ぎ",
  today: "今日中",
  soon: "近いうちに",
};

export type InboxKind =
  | "approve_entries"
  | "day_offs"
  | "remind_reports"
  | "tomorrow_shortage"
  | "tomorrow_unconfirmed"
  | "invoices_overdue"
  | "alerts_high"
  | "open_months"
  | "after_close"
  | "bank_unmatched";

/** その場でできる操作（無ければリンクで該当画面へ） */
export type InboxAction = "approve_entries" | "decide_day_offs" | "remind" | "confirm_tomorrow" | "auto_match";

export interface InboxItem {
  kind: InboxKind;
  urgency: InboxUrgency;
  title: string;
  detail: string;
  count: number;
  href: string;
  action?: InboxAction;
}

/** 同じ急ぎ度のときの並び（上ほど先） */
export const INBOX_KIND_ORDER: InboxKind[] = [
  "tomorrow_shortage",
  "approve_entries",
  "remind_reports",
  "day_offs",
  "invoices_overdue",
  "tomorrow_unconfirmed",
  "alerts_high",
  "after_close",
  "open_months",
  "bank_unmatched",
];

const URGENCY_RANK: Record<InboxUrgency, number> = { now: 0, today: 1, soon: 2 };

/** 急ぎ度の順 → 種類の順（同じ入力なら必ず同じ並び） */
export function sortInbox(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort(
    (a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || INBOX_KIND_ORDER.indexOf(a.kind) - INBOX_KIND_ORDER.indexOf(b.kind),
  );
}

/** 休み希望は、この日数以内の日のものを「急ぎ」にする */
export const DAY_OFF_URGENT_DAYS = 3;

/**
 * 締めた月に残っている「締めたあとの手順」。
 * 支払明細は全員に送った記録があるか、手でチェックを付けていれば済み。振込はチェックだけで判断する
 */
export function afterCloseRemaining(a: DeskAfterClose | null): { key: ManualCloseKey; label: string; detail: string }[] {
  if (!a) return [];
  const out: { key: ManualCloseKey; label: string; detail: string }[] = [];
  const statementsDone = a.checks.includes("statements_sent") || a.statementTargets === 0 || a.statementSent >= a.statementTargets;
  if (!statementsDone) {
    out.push({
      key: "statements_sent",
      label: "支払明細の送付",
      detail: a.statementSent > 0 ? `${a.statementTargets} 人中 ${a.statementSent} 人に送りました` : `${a.statementTargets} 人にまだ送っていません`,
    });
  }
  if (!a.checks.includes("transfer_done")) {
    out.push({ key: "transfer_done", label: "振込", detail: "振込が済んだらチェックを付けます" });
  }
  return out;
}

export function buildInbox(desk: OfficeDesk, reporters: TodayReporters = todayReporters(desk)): InboxItem[] {
  const today = desk.today;
  const items: InboxItem[] = [];

  // 稼働報告の承認待ち（昨日より前のものが残っていたら急ぎ）
  if (desk.pendingEntriesTotal > 0) {
    const oldest = desk.pendingEntries.reduce<string>((min, e) => (!min || e.workDate < min ? e.workDate : min), "");
    const drivers = new Set(desk.pendingEntries.map((e) => e.driverId)).size;
    items.push({
      kind: "approve_entries",
      urgency: oldest && today && oldest < addDays(today, -1) ? "now" : "today",
      title: `稼働報告の承認待ち ${desk.pendingEntriesTotal} 件`,
      detail: oldest ? `${drivers} 人分・いちばん古いのは ${shortDateJa(oldest)}` : `${drivers} 人分`,
      count: desk.pendingEntriesTotal,
      href: "/daily?tab=entries",
      action: "approve_entries",
    });
  }

  // 今日の報告がまだの人
  if (reporters.missing.length > 0) {
    const notReachable = reporters.missing.filter((r) => !r.reachable).length;
    const reminded = reporters.missing.filter((r) => r.remindedAt).length;
    const parts = [`${reporters.expected.length} 人中 ${reporters.reportedCount} 人が報告済み`];
    if (reminded > 0) parts.push(`催促済み ${reminded} 人`);
    if (notReachable > 0) parts.push(`連絡手段なし ${notReachable} 人`);
    items.push({
      kind: "remind_reports",
      urgency: "today",
      title: `今日の報告がまだ ${reporters.missing.length} 人`,
      detail: parts.join("・"),
      count: reporters.missing.length,
      href: "/daily",
      action: "remind",
    });
  }

  // 休み希望（近い日のものは急ぎ）
  if (desk.dayOffs.length > 0) {
    const soonest = desk.dayOffs.reduce<string>((min, o) => (!min || o.onDate < min ? o.onDate : min), "");
    items.push({
      kind: "day_offs",
      urgency: soonest && today && soonest <= addDays(today, DAY_OFF_URGENT_DAYS) ? "now" : "today",
      title: `休み希望の返事待ち ${desk.dayOffs.length} 件`,
      detail: soonest ? `いちばん近いのは ${shortDateJa(soonest)}` : "",
      count: desk.dayOffs.length,
      href: "/dispatch?tab=offs",
      action: "decide_day_offs",
    });
  }

  // 明日の配車
  const t = desk.tomorrow;
  if (t && t.shortage > 0) {
    items.push({
      kind: "tomorrow_shortage",
      urgency: "now",
      title: `明日（${shortDateJa(t.onDate)}）の人が ${t.shortage} 人足りません`,
      detail: `必要 ${t.need} 人・割り当て ${t.assigned} 人`,
      count: t.shortage,
      href: `/dispatch?from=${t.onDate}`,
    });
  }
  const unconfirmed = t ? Math.max(0, t.assigned - t.confirmed) : 0;
  if (t && unconfirmed > 0) {
    items.push({
      kind: "tomorrow_unconfirmed",
      urgency: "today",
      title: `明日の配車が未確定 ${unconfirmed} 件`,
      detail: "確定すると、夕方 6 時にドライバーへ知らせます",
      count: unconfirmed,
      href: `/dispatch?from=${t.onDate}`,
      action: "confirm_tomorrow",
    });
  }

  // 期日を過ぎた未入金
  const overdue = desk.invoicesIssued.filter((i) => i.dueDate && today && i.dueDate < today);
  if (overdue.length > 0) {
    const total = overdue.reduce((s, i) => s + i.total, 0);
    const names = Array.from(new Set(overdue.map((i) => i.clientName).filter(Boolean)));
    items.push({
      kind: "invoices_overdue",
      urgency: "now",
      title: `期日を過ぎた未入金 ${overdue.length} 件（${yen(total)}）`,
      detail: names.slice(0, 3).join("・") + (names.length > 3 ? ` ほか ${names.length - 3} 社` : ""),
      count: overdue.length,
      href: "/invoices",
    });
  }

  // 重要な「気になること」
  if (desk.alertsHigh.length > 0) {
    items.push({
      kind: "alerts_high",
      urgency: "today",
      title: `重要な「気になること」${desk.alertsHigh.length} 件`,
      detail: desk.alertsHigh
        .slice(0, 2)
        .map((a) => a.title)
        .join("・"),
      count: desk.alertsHigh.length,
      href: "/alerts",
    });
  }

  // 締めていない過去の月
  if (desk.openPastMonths.length > 0) {
    const oldest = desk.openPastMonths[0];
    items.push({
      kind: "open_months",
      urgency: "soon",
      title: `${formatMonthJa(oldest)}がまだ締まっていません`,
      detail: desk.openPastMonths.length > 1 ? `ほかに ${desk.openPastMonths.length - 1} か月` : "下の「月締めの手順」から進められます",
      count: desk.openPastMonths.length,
      href: `/office?m=${oldest}`,
    });
  }

  // 締めた月の残り（支払明細の送付・振込）
  const after = afterCloseRemaining(desk.afterClose);
  if (desk.afterClose && after.length > 0) {
    const month = desk.afterClose.month;
    items.push({
      kind: "after_close",
      urgency: "today",
      title: `${formatMonthJa(month)}の締めのあと：${after.map((a) => a.label).join("・")}`,
      detail: after.map((a) => a.detail).join("・"),
      count: after.length,
      href: `/office?m=${month}#closing`,
    });
  }

  // 消し込めていない入金
  if (desk.bankUnmatched > 0) {
    items.push({
      kind: "bank_unmatched",
      urgency: "soon",
      title: `消し込めていない入金 ${desk.bankUnmatched} 件`,
      detail: "金額と取引先名が合う請求書と自動で結びつけられます",
      count: desk.bankUnmatched,
      href: "/bank",
      action: "auto_match",
    });
  }

  return sortInbox(items);
}

/* ------------------------------------------------------------------ *
 * 月締めの手順
 * ------------------------------------------------------------------ */

/**
 * 手順の状態
 *   done … 終わっている
 *   todo … これをしないと締められない（締めても良いが、ほぼ確実にやり直しになる）
 *   warn … 確かめたほうが良い（締めを止めるほどではない）
 *   skip … この月は関係ない
 */
export type StepStatus = "done" | "todo" | "warn" | "skip";

export type StepAction = "apply_recurring" | "close_month" | "check" | "send_statements";

export interface ClosingStep {
  key: string;
  title: string;
  detail: string;
  status: StepStatus;
  href?: string;
  action?: StepAction;
  /** 手で付けるチェック（アプリが判定できない手順） */
  manual?: boolean;
  /** 締めたあとの手順（支払明細の送付・振込）。締める手順より下に並ぶ */
  afterClose?: boolean;
  doneAt?: string;
  doneBy?: string;
}

/** 手で付けるチェックの名前（month_close_checks.key） */
export const MANUAL_CLOSE_STEPS = [
  { key: "statements_sent", title: "支払明細をドライバーへ送った", detail: "LINE で送ると自動で済みになります。紙や PDF で渡したときはチェックを付けます" },
  { key: "transfer_done", title: "振込を済ませた", detail: "振込データで銀行に振込を依頼したら付けます" },
] as const;

export type ManualCloseKey = (typeof MANUAL_CLOSE_STEPS)[number]["key"];

export function isManualCloseKey(key: string): key is ManualCloseKey {
  return MANUAL_CLOSE_STEPS.some((s) => s.key === key);
}

/**
 * 月締めの手順を並べる。
 * @param month 対象月（"YYYY-MM"）
 * @param thisMonth 今月（"YYYY-MM"。まだ終わっていない月の締めを止めるために使う）
 */
export function buildClosingSteps(facts: ClosingFacts, month: string, thisMonth: string): ClosingStep[] {
  const q = `?m=${month}`;
  const steps: ClosingStep[] = [];

  steps.push(
    facts.pending > 0
      ? { key: "entries_approved", title: "稼働報告をすべて承認する", detail: `承認待ちが ${facts.pending} 件あります。承認するまで月の稼働に入りません`, status: "todo", href: `/daily${q}&tab=entries` }
      : { key: "entries_approved", title: "稼働報告をすべて承認する", detail: "承認待ちはありません", status: "done", href: `/daily${q}&tab=entries` },
  );

  steps.push(
    facts.entryCount === 0
      ? { key: "entries", title: "稼働が入っているか確かめる", detail: "この月の稼働がまだ 1 件もありません", status: "todo", href: `/entries${q}` }
      : facts.zeroQty > 0
        ? { key: "entries", title: "稼働が入っているか確かめる", detail: `数量が 0 の行が ${facts.zeroQty} 件あります（入れ忘れか、使わない行か）`, status: "warn", href: `/entries${q}` }
        : { key: "entries", title: "稼働が入っているか確かめる", detail: `${facts.entryCount} 行入っています`, status: "done", href: `/entries${q}` },
  );

  const reportIssues = [
    facts.rollCallMissing > 0 ? `点呼の記録が無い稼働日 ${facts.rollCallMissing} 件` : "",
    facts.noReport > 0 ? `予定があるのに報告が無い日 ${facts.noReport} 件` : "",
  ].filter(Boolean);
  steps.push(
    reportIssues.length > 0
      ? { key: "reports", title: "点呼と報告の漏れを確かめる", detail: reportIssues.join("・"), status: "warn", href: `/daily${q}` }
      : { key: "reports", title: "点呼と報告の漏れを確かめる", detail: "漏れはありません", status: "done", href: `/daily${q}` },
  );

  steps.push(
    facts.rateDiffs > 0
      ? { key: "rates", title: "単価がマスタと合っているか確かめる", detail: `マスタと違う単価の行が ${facts.rateDiffs} 件あります`, status: "warn", href: `/settings/rates${q}` }
      : { key: "rates", title: "単価がマスタと合っているか確かめる", detail: "すべてマスタどおりです", status: "done", href: `/settings/rates${q}` },
  );

  steps.push(
    facts.recurringDue === 0
      ? { key: "recurring", title: "毎月の経費を計上する", detail: "毎月の経費は登録されていません", status: "skip", href: `/expenses${q}` }
      : facts.recurringUnapplied > 0
        ? { key: "recurring", title: "毎月の経費を計上する", detail: `まだ計上していないものが ${facts.recurringUnapplied} 件あります`, status: "todo", href: `/expenses${q}`, action: "apply_recurring" }
        : { key: "recurring", title: "毎月の経費を計上する", detail: `${facts.recurringDue} 件とも計上済みです`, status: "done", href: `/expenses${q}` },
  );

  steps.push(
    facts.notices === 0
      ? { key: "notices", title: "元請の支払通知と突き合わせる", detail: "取り込んだ支払通知はありません（届いたら取り込むと、請求漏れ・単価違いが分かります）", status: "skip", href: "/invoices/notices" }
      : facts.noticeDiffs > 0
        ? { key: "notices", title: "元請の支払通知と突き合わせる", detail: `自社の売上と合わない明細が ${facts.noticeDiffs} 件あります`, status: "warn", href: "/invoices/notices" }
        : { key: "notices", title: "元請の支払通知と突き合わせる", detail: `${facts.notices} 件とも自社の売上と合っています`, status: "done", href: "/invoices/notices" },
  );

  steps.push(invoiceStep(facts, q));

  // 締める。ここまでが「締める前」の手順（締めてから明細を送り、振り込む）
  steps.push(closeStep(facts, month, thisMonth, steps));

  const closed = facts.status === "closed";
  for (const m of MANUAL_CLOSE_STEPS) {
    const c = facts.checks.find((x) => x.key === m.key);
    const base = {
      key: m.key,
      title: m.title,
      href: m.key === "transfer_done" ? `/payouts/transfer${q}` : `/payouts${q}`,
      action: "check" as StepAction,
      manual: true,
      afterClose: true,
      doneAt: c?.doneAt,
      doneBy: c?.doneByName,
    };
    if (c) {
      steps.push({ ...base, detail: `${c.doneByName || "だれか"}さんが付けました`, status: "done" });
      continue;
    }
    if (m.key === "statements_sent") {
      steps.push(statementStep(facts, base, closed));
      continue;
    }
    steps.push({ ...base, detail: closed ? m.detail : "締めてから振り込みます（締めると金額が確定します）", status: "todo" });
  }
  return steps;
}

/** 支払明細の送付。LINE で全員に送った記録があれば自動で済み。締める前は送れない */
function statementStep(facts: ClosingFacts, base: Omit<ClosingStep, "detail" | "status">, closed: boolean): ClosingStep {
  const { statementTargets: targets, statementSent: sent, statementLineReady: line } = facts;
  if (targets === 0) return { ...base, detail: "この月に稼働した人はいません", status: "skip", action: undefined };
  if (sent >= targets) return { ...base, detail: `${targets} 人全員に送りました`, status: "done" };
  if (!closed) return { ...base, detail: "締めてから送ります（締めると金額が確定します）", status: "todo" };
  const parts = [sent > 0 ? `${targets} 人中 ${sent} 人に送りました` : `${targets} 人にまだ送っていません`];
  parts.push(
    line > 0
      ? `LINE で送れる人 ${line} 人`
      : sent > 0
        ? "残りは LINE が届かない人です（PDF を渡したらチェックを付けます）"
        : "LINE が届く人はいません（PDF を渡したらチェックを付けます）",
  );
  return { ...base, detail: parts.join("・"), status: "todo", action: line > 0 ? "send_statements" : "check" };
}

function invoiceStep(facts: ClosingFacts, q: string): ClosingStep {
  const base = { key: "invoices", title: "請求書を作って発行する", href: `/invoices${q}` };
  const unassigned = facts.unassignedBill > 0 ? `取引先が付いていない案件の売上 ${yen(facts.unassignedBill)} は請求書に載りません` : "";
  if (facts.clients.length === 0) {
    return unassigned
      ? { ...base, detail: unassigned, status: "warn" }
      : { ...base, detail: "請求する売上はありません", status: "skip" };
  }
  const invoiced = new Set(facts.invoices.map((i) => i.clientId));
  const missing = facts.clients.filter((c) => !invoiced.has(c.clientId));
  const drafts = facts.invoices.filter((i) => i.status === "draft");
  if (missing.length > 0) {
    const names = missing.map((c) => c.clientName).slice(0, 3).join("・") + (missing.length > 3 ? ` ほか ${missing.length - 3} 社` : "");
    return { ...base, detail: [`まだ作っていない請求書 ${missing.length} 社（${names}）`, unassigned].filter(Boolean).join("。"), status: "todo" };
  }
  if (drafts.length > 0) {
    return { ...base, detail: [`下書きのままの請求書 ${drafts.length} 件`, unassigned].filter(Boolean).join("。"), status: "todo" };
  }
  if (unassigned) return { ...base, detail: `${facts.clients.length} 社とも発行済み。${unassigned}`, status: "warn" };
  return { ...base, detail: `${facts.clients.length} 社とも発行済みです`, status: "done" };
}

function closeStep(facts: ClosingFacts, month: string, thisMonth: string, before: readonly ClosingStep[]): ClosingStep {
  const base = { key: "close", title: "月を締める", href: "/settings/months", action: "close_month" as const };
  if (facts.status === "closed") return { ...base, detail: "締め済みです", status: "done", action: undefined };
  if (compareMonth(month, thisMonth) >= 0) {
    return { ...base, detail: "月が終わってから締めます", status: "skip", action: undefined };
  }
  const left = before.filter((s) => s.status === "todo").length;
  return {
    ...base,
    detail: left > 0 ? `残りの手順が ${left} つあります（締めると稼働・管理費・調整が変えられなくなります）` : "すべての手順が終わりました。締めると稼働・管理費・調整を固定し、バックアップを保存します",
    status: "todo",
  };
}

export interface ClosingProgress {
  /** 終わった手順（done）の数。skip は数えない */
  done: number;
  /** 数える手順の数（skip を除く） */
  total: number;
  /** 締める手順より前に todo が残っていない（締めたあとの手順は数えない） */
  ready: boolean;
  closed: boolean;
}

export function closingProgress(steps: readonly ClosingStep[]): ClosingProgress {
  const counted = steps.filter((s) => s.status !== "skip");
  // 締めたあとの手順（明細の送付・振込）は締める条件に入れない
  const beforeClose = steps.filter((s) => s.key !== "close" && !s.afterClose);
  const close = steps.find((s) => s.key === "close");
  return {
    done: counted.filter((s) => s.status === "done").length,
    total: counted.length,
    ready: beforeClose.every((s) => s.status !== "todo"),
    // 締める手順が done になるのは締め済みのときだけ
    closed: close?.status === "done",
  };
}

/** 手順の状態の表示名 */
export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  done: "済み",
  todo: "まだ",
  warn: "確認",
  skip: "対象外",
};
