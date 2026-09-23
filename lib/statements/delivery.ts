/**
 * 支払明細の送付（純関数。0028）。
 *
 * 締めた月の支払明細を、LINE と端末への通知でドライバーへ届ける。
 * 送った記録（statement_deliveries）はドライバー × 月で 1 件で、ここでは
 *   - 誰に送るか（planStatementSend）… 送信済みの人は飛ばす（送り直すときだけ含める）。金額が変わった人は必ず送る
 *   - 1 人ずつの状態（statementTargetStatus）… 送信済み・金額が変わった・送れる・連絡手段なし
 *   - 結果の文面（sendStatementsMessage）
 * を決める。React・DB に依存しない。
 */
import { yen } from "@/lib/format";

export type DeliveryChannel = "line" | "push";

export interface StatementTarget {
  driverId: string;
  driverName: string;
  /** いまの税込のお支払額 */
  payoutIncl: number;
  /** LINE と連携していて、会社の LINE 連携が有効 */
  lineReady: boolean;
  /** ドライバーのアプリで通知を受け取る設定がある */
  pushReady: boolean;
  sentAt: string | null;
  sentChannel: DeliveryChannel | null;
  sentByName: string;
  /** 送った時点の税込のお支払額（締めを解除して直したら、いまの額と違ってくる） */
  sentPayoutIncl: number | null;
}

export type TargetStatus = "sent" | "changed" | "ready" | "no_contact";

export const TARGET_STATUS_LABELS: Record<TargetStatus, string> = {
  sent: "送信済み",
  changed: "金額が変わった",
  ready: "まだ",
  no_contact: "連絡手段なし",
};

/** 金額は 1 円未満の差を同じとみなす（numeric の丸め） */
function samePayout(a: number | null, b: number): boolean {
  return a == null || Math.abs(a - b) < 0.5;
}

export function statementTargetStatus(t: StatementTarget): TargetStatus {
  if (t.sentAt) return samePayout(t.sentPayoutIncl, t.payoutIncl) ? "sent" : "changed";
  return t.lineReady || t.pushReady ? "ready" : "no_contact";
}

export function canReach(t: StatementTarget): boolean {
  return t.lineReady || t.pushReady;
}

export interface SendPlan {
  send: StatementTarget[];
  /** 送信済みで飛ばした人 */
  alreadySent: number;
  /** 連絡手段が無くて送れない人 */
  noContact: number;
}

/**
 * 送る相手を決める。
 * @param driverIds 指定したら、その人だけ（指定しなければ全員）
 * @param resend 送信済みの人にも送り直す
 */
export function planStatementSend(targets: readonly StatementTarget[], opts: { driverIds?: readonly string[] | null; resend?: boolean } = {}): SendPlan {
  const only = opts.driverIds && opts.driverIds.length > 0 ? new Set(opts.driverIds) : null;
  const plan: SendPlan = { send: [], alreadySent: 0, noContact: 0 };
  for (const t of targets) {
    if (only && !only.has(t.driverId)) continue;
    const status = statementTargetStatus(t);
    if (status === "sent" && !opts.resend) {
      plan.alreadySent += 1;
      continue;
    }
    if (!canReach(t)) {
      plan.noContact += 1;
      continue;
    }
    plan.send.push(t);
  }
  return plan;
}

/** 送信済みの人数（金額が変わった人は数えない） */
export function sentCount(targets: readonly StatementTarget[]): number {
  return targets.filter((t) => statementTargetStatus(t) === "sent").length;
}

/** 送る前の確認の文面（「LINE で 3 人・通知で 1 人に送ります」） */
export function sendPreviewText(plan: SendPlan): string {
  const line = plan.send.filter((t) => t.lineReady).length;
  const pushOnly = plan.send.length - line;
  const parts: string[] = [];
  if (line > 0) parts.push(`LINE で ${line} 人`);
  if (pushOnly > 0) parts.push(`アプリの通知で ${pushOnly} 人`);
  const head = parts.length > 0 ? `${parts.join("・")}に送ります` : "送れる人がいません";
  const notes: string[] = [];
  if (plan.alreadySent > 0) notes.push(`送信済みの ${plan.alreadySent} 人には送りません`);
  if (plan.noContact > 0) notes.push(`連絡手段が無い ${plan.noContact} 人は PDF を渡してください`);
  return notes.length > 0 ? `${head}（${notes.join("。")}）` : head;
}

export interface SendStatementsResult {
  /** 届けた人数（LINE か通知のどちらかが届いた） */
  sent: number;
  line: number;
  push: number;
  /** 送ろうとしたが、どちらでも届かなかった人数 */
  failed: number;
  alreadySent: number;
  noContact: number;
}

export function sendStatementsMessage(r: SendStatementsResult): string {
  if (r.sent === 0 && r.failed === 0) {
    if (r.noContact > 0) {
      return `送れる人はもういません（${r.alreadySent > 0 ? `送信済み ${r.alreadySent} 人・` : ""}連絡手段なし ${r.noContact} 人）。連絡手段が無い人には PDF を渡してください。`;
    }
    if (r.alreadySent > 0) return `全員に送信済みです（${r.alreadySent} 人）。送り直すときは「選んで送る・送り直す」から選んでください。`;
    return "送れる人がいませんでした。LINE 連携か、ドライバーのアプリの通知を設定してください。";
  }
  const how = [r.line > 0 ? `LINE ${r.line}` : "", r.push > 0 ? `通知 ${r.push}` : ""].filter(Boolean).join("・");
  const notes = [
    r.failed > 0 ? `${r.failed} 人は送れませんでした` : "",
    r.alreadySent > 0 ? `送信済みの ${r.alreadySent} 人は飛ばしました` : "",
    r.noContact > 0 ? `連絡手段が無い人 ${r.noContact} 人` : "",
  ].filter(Boolean);
  return `支払明細を ${r.sent} 人に送りました${how ? `（${how}）` : ""}。${notes.length > 0 ? `${notes.join("・")}。` : ""}`;
}

/** 端末の通知の文面（ドライバー本人あて） */
export function statementPushPayload(opts: { month: string; monthLabel: string; payoutIncl: number }) {
  return {
    title: `${opts.monthLabel}の支払明細が届きました`,
    body: `お支払額（税込）は ${yen(opts.payoutIncl)} です。押すと明細を開きます。`,
    url: `/driver/statements/${opts.month}`,
    tag: `statement-${opts.month}`,
  };
}
