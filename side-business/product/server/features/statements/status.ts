/**
 * 明細の「届いたか・見たか・確認したか」の状態（純関数。DB の値から毎回計算する。保存しない）。
 *
 * - 確認済み：今の版を確認した記録がある
 * - みなし確認：今の中身を送ってから決めた日数が過ぎ、その間にドライバーからの連絡（質問）が無い。
 *   明細の注記（「連絡が無ければ確認とみなす」）に沿った状態の表示で、法的な結論ではない
 * - 確認後に変更あり：前の版を確認したが、そのあと中身が変わった（もう一度の確認が要る）
 * - 開封・送付済み・未送付：送った・開いた記録から
 */

export type StatusKey = "unsent" | "sent" | "viewed" | "changed" | "deemed" | "confirmed";
export type Tone = "red" | "yellow" | "green" | "gray";

export const STATUS_LABEL: Record<StatusKey, string> = {
  unsent: "未送付",
  sent: "送付済み",
  viewed: "開封",
  changed: "確認後に変更あり",
  deemed: "みなし確認",
  confirmed: "確認済み",
};

export const STATUS_TONE: Record<StatusKey, Tone> = {
  unsent: "gray",
  sent: "gray",
  viewed: "gray",
  changed: "yellow",
  deemed: "green",
  confirmed: "green",
};

export type StatusInput = {
  version: number;
  sentAt: Date | null;
  viewedAt: Date | null;
  /** 中身が最後に変わった日時（作り直しで版が上がったとき） */
  updatedAt: Date;
  confirmations: { version: number; createdAt: Date }[];
  /** ドライバーからの連絡だけ（事務の返事は入れない） */
  driverMessages: { createdAt: Date; resolvedAt: Date | null; readAt: Date | null }[];
};

export type StatementStatus = {
  key: StatusKey;
  label: string;
  tone: Tone;
  /** 送ったあとで中身が変わり、新しい中身をまだ送っていない */
  needsResend: boolean;
  /** 今の中身をドライバーが開いた（前の中身を開いただけなら false） */
  viewedCurrent: boolean;
  /** 解決していない質問の数 */
  openQuestions: number;
  /** 事務がまだ読んでいない質問の数 */
  unread: number;
  /** みなし確認のとき、送ってから何日たったか */
  deemedDays: number | null;
  /** 今の版を確認した日時（いちばん早いもの） */
  confirmedAt: Date | null;
  /** 確認した版のうちいちばん新しいもの（無ければ null） */
  lastConfirmedVersion: number | null;
};

const DAY_MS = 86_400_000;
export const DEFAULT_DEEMED_DAYS = 7;

/** 会社の設定から「みなし確認」までの日数（既定 7。1〜60 日に収める） */
export function deemedDaysOf(settings: { deemedConfirmDays?: number } | null | undefined): number {
  const v = Number(settings?.deemedConfirmDays);
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_DEEMED_DAYS;
  return Math.min(60, Math.max(1, Math.floor(v)));
}

export function statementStatus(input: StatusInput, now: Date, deemedAfterDays: number): StatementStatus {
  const current = input.confirmations.filter((c) => c.version === input.version);
  const older = input.confirmations.filter((c) => c.version !== input.version);
  const openQuestions = input.driverMessages.filter((m) => !m.resolvedAt).length;
  const unread = input.driverMessages.filter((m) => !m.readAt).length;
  const sentAt = input.sentAt;
  // 今の中身を送ったか（送ったあとで作り直して中身が変わったら、送り直しが要る）
  const sentCurrent = !!sentAt && sentAt.getTime() >= input.updatedAt.getTime();
  const needsResend = !!sentAt && !sentCurrent;
  // 前の中身を開いただけなら「開封」にしない（作り直したあとで開けば、開いた日時が今の中身のものになる）
  const viewedCurrent = !!input.viewedAt && input.viewedAt.getTime() >= input.updatedAt.getTime();

  let deemedDays: number | null = null;
  if (sentAt && sentCurrent) {
    const days = Math.floor((now.getTime() - sentAt.getTime()) / DAY_MS);
    const contacted = openQuestions > 0 || input.driverMessages.some((m) => m.createdAt.getTime() >= sentAt.getTime());
    if (days >= deemedAfterDays && !contacted) deemedDays = days;
  }

  let key: StatusKey;
  if (current.length > 0) key = "confirmed";
  else if (deemedDays !== null) key = "deemed";
  else if (older.length > 0) key = "changed";
  else if (viewedCurrent) key = "viewed";
  else if (sentAt) key = "sent";
  else key = "unsent";

  const confirmedAt = current.length > 0 ? new Date(Math.min(...current.map((c) => c.createdAt.getTime()))) : null;
  const lastConfirmedVersion = input.confirmations.length > 0 ? Math.max(...input.confirmations.map((c) => c.version)) : null;
  const label = key === "deemed" ? `${STATUS_LABEL.deemed}（${deemedDays}日経過）` : STATUS_LABEL[key];

  return {
    key,
    label,
    tone: STATUS_TONE[key],
    needsResend: needsResend && key !== "confirmed",
    viewedCurrent,
    openQuestions,
    unread,
    deemedDays,
    confirmedAt,
    lastConfirmedVersion,
  };
}

// ---------------------------------------------------------------- 一覧の絞り込みと件数

export type FilterKey = "all" | "todo" | StatusKey | "question" | "resend";

export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "todo", label: "まだ確認されていない" },
  { key: "unsent", label: STATUS_LABEL.unsent },
  { key: "sent", label: STATUS_LABEL.sent },
  { key: "viewed", label: STATUS_LABEL.viewed },
  { key: "confirmed", label: STATUS_LABEL.confirmed },
  { key: "deemed", label: STATUS_LABEL.deemed },
  { key: "changed", label: STATUS_LABEL.changed },
  { key: "question", label: "質問あり" },
  { key: "resend", label: "送り直しが要る" },
];

export function parseFilter(value: string | string[] | undefined): FilterKey {
  const v = Array.isArray(value) ? value[0] : value;
  return FILTERS.some((f) => f.key === v) ? (v as FilterKey) : "all";
}

export function matchesFilter(status: StatementStatus, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "todo":
      return status.key !== "confirmed" && status.key !== "deemed";
    case "question":
      return status.openQuestions > 0;
    case "resend":
      return status.needsResend;
    default:
      return status.key === filter;
  }
}

export type StatusCounts = Record<FilterKey, number>;

export function countStatuses(list: StatementStatus[]): StatusCounts {
  const out = Object.fromEntries(FILTERS.map((f) => [f.key, 0])) as StatusCounts;
  for (const st of list) for (const f of FILTERS) if (matchesFilter(st, f.key)) out[f.key]++;
  return out;
}

/** 「8人中 5人が確認済み」（みなし確認があれば添える） */
export function countsSentence(counts: StatusCounts): string {
  const base = `${counts.all}人中 ${counts.confirmed}人が確認済み`;
  return counts.deemed > 0 ? `${base}（ほかに みなし確認 ${counts.deemed}人）` : base;
}
