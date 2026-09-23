import "server-only";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { ackKey, runWatch, type WatchOptions } from "~/server/features/watch";
import type { WatchIssue } from "~/server/features/watch-types";
import { shiftMonth } from "~/server/month";
import { getTenant, isMonthClosed } from "~/server/repo";

/**
 * 見張り番の「確認済み」：何を確かめたかのメモを残して、その月の指摘に印を付ける。
 * - 印を付けられるのは、いま出ている指摘だけ（画面から来た種類・対象を、その場で見張り番に照らして確かめる）
 * - 締めた月は変えられない（見るだけ）。ただし、締めたあとに入れる記録（振り込んだ日）から出る指摘だけは、
 *   締めたあとでもメモを残せる（振込はふつう締めのあと。メモは明細や金額を変えない）
 * - 誰がいつ付けた・外したかは watch_acks と操作の記録に残す
 */

/** メモの最低の文字数（赤は締めを止めるので、少し長めに書いてもらう） */
export const ACK_NOTE_MIN = { red: 10, other: 4 } as const;
export const ACK_NOTE_MAX = 500;

export function ackNoteMin(severity: WatchIssue["severity"]): number {
  return severity === "red" ? ACK_NOTE_MIN.red : ACK_NOTE_MIN.other;
}

/**
 * 締めたあとでも確認済みにできる指摘（締めたあとの記録から出るもの）。
 * 振込はふつう締めのあと。明細への質問も、締めたあとに届くことがある（返事も締めたあとにできる）
 */
export const AFTER_CLOSE_CODES: ReadonlySet<string> = new Set(["paid_late", "late_payment_prev", "open_questions"]);

/** その月の状態で、この種類の指摘に印を付け外しできるか */
export function ackAllowed(code: string, closed: boolean): boolean {
  return !closed || AFTER_CLOSE_CODES.has(code);
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function assertMonth(month: string): void {
  if (!MONTH_RE.test(month)) throw new UserError("月の指定が正しくありません");
}

async function assertCanChange(db: Db, tenantId: string, month: string, code: string): Promise<void> {
  if (!ackAllowed(code, await isMonthClosed(db, tenantId, month))) {
    throw new UserError("この月は締め済みです。確認済みの印は変えられません（見るだけです）。");
  }
}

export type AckInput = { month: string; code: string; subjectId: string; note: string };

export async function ackWatchIssue(db: Db, tenantId: string, input: AckInput, userId: string | null, options: WatchOptions = {}): Promise<WatchIssue> {
  assertMonth(input.month);
  await getTenant(db, tenantId);
  await assertCanChange(db, tenantId, input.month, input.code);
  const issues = await runWatch(db, tenantId, input.month, options);
  const issue = issues.find((i) => i.code === input.code && i.subjectId === input.subjectId);
  if (!issue) throw new UserError("この指摘は、いまは出ていません。画面を開き直してください（直したあとなら、確認済みにする必要はありません）。");
  const note = input.note.trim();
  const min = ackNoteMin(issue.severity);
  if (note.length < min) throw new UserError(`何を確かめたかを ${min} 文字以上で書いてください。`);
  if (note.length > ACK_NOTE_MAX) throw new UserError(`メモは ${ACK_NOTE_MAX} 文字までにしてください。`);

  await db
    .insert(s.watchAcks)
    .values({ tenantId, month: input.month, code: issue.code, subjectId: issue.subjectId, note, ackedBy: userId })
    .onConflictDoUpdate({
      target: [s.watchAcks.tenantId, s.watchAcks.month, s.watchAcks.code, s.watchAcks.subjectId],
      set: { note, ackedBy: userId, createdAt: new Date() },
    });
  await audit(db, {
    tenantId,
    userId,
    action: "watch.ack",
    entity: "watch_issue",
    entityId: `${issue.code}:${issue.subjectId}`,
    // detail：確認したときの中身（あとで数字や日付が変わったら、画面で「確かめ直して」と出すため）
    detail: {
      month: input.month,
      code: issue.code,
      subjectId: issue.subjectId,
      severity: issue.severity,
      title: issue.title,
      subject: issue.subjectLabel,
      note,
      previousNote: issue.ackNote ?? null,
      issueDetail: issue.detail,
    },
  });
  return { ...issue, acked: true, ackNote: note, blocksClose: false };
}

export async function unackWatchIssue(db: Db, tenantId: string, input: Omit<AckInput, "note">, userId: string | null): Promise<void> {
  assertMonth(input.month);
  await getTenant(db, tenantId);
  await assertCanChange(db, tenantId, input.month, input.code);
  const removed = await db
    .delete(s.watchAcks)
    .where(
      and(
        eq(s.watchAcks.tenantId, tenantId),
        eq(s.watchAcks.month, input.month),
        eq(s.watchAcks.code, input.code),
        eq(s.watchAcks.subjectId, input.subjectId),
      ),
    )
    .returning({ note: s.watchAcks.note });
  if (!removed.length) throw new UserError("確認済みの記録が見つかりません。画面を開き直してください。");
  await audit(db, {
    tenantId,
    userId,
    action: "watch.unack",
    entity: "watch_issue",
    entityId: `${input.code}:${input.subjectId}`,
    detail: { month: input.month, code: input.code, subjectId: input.subjectId, previousNote: removed[0].note },
  });
}

export type AckDetail = { note: string | null; byName: string | null; at: Date };

/** その月の確認済み：誰が・いつ・何と書いたか（画面に出す） */
export async function monthAckDetails(db: Db, tenantId: string, month: string): Promise<Map<string, AckDetail>> {
  const [acks, users] = await Promise.all([
    db
      .select()
      .from(s.watchAcks)
      .where(and(eq(s.watchAcks.tenantId, tenantId), eq(s.watchAcks.month, month))),
    db.select({ id: s.users.id, name: s.users.name }).from(s.users).where(eq(s.users.tenantId, tenantId)),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return new Map(acks.map((a) => [ackKey(a.code, a.subjectId), { note: a.note, byName: a.ackedBy ? userName.get(a.ackedBy) ?? null : null, at: a.createdAt }]));
}

export type PreviousAck = { month: string; note: string | null };

/**
 * 前の月（12 か月前まで）に、同じ種類・同じ対象を確認済みにしたメモ（いちばん新しいもの）。
 * 同じ指摘を毎月いちから書かなくてよいよう、画面でメモの下書きに使う。
 */
export async function previousAcks(db: Db, tenantId: string, month: string): Promise<Map<string, PreviousAck>> {
  const rows = await db
    .select({ month: s.watchAcks.month, code: s.watchAcks.code, subjectId: s.watchAcks.subjectId, note: s.watchAcks.note })
    .from(s.watchAcks)
    .where(and(eq(s.watchAcks.tenantId, tenantId), lt(s.watchAcks.month, month), gte(s.watchAcks.month, shiftMonth(month, -12))))
    .orderBy(desc(s.watchAcks.month));
  const out = new Map<string, PreviousAck>();
  for (const r of rows) {
    const key = ackKey(r.code, r.subjectId);
    if (!out.has(key)) out.set(key, { month: r.month, note: r.note });
  }
  return out;
}

/**
 * 確認済みにしたあとで、中身（数字・日付・人）が変わった赤い指摘のキー。
 * 確認済みにしたときの中身は操作の記録（watch.ack）に残しているので、いまの中身と比べる。
 * - 見るのは赤だけ（締めを止めない確認をしたもの。黄・お知らせは取り込みのたびに数字が動くので出さない）
 * - 締めを止めるかどうかは変えない（画面で「確かめ直してください」と知らせるだけ）
 * - 記録が無い・古い形の記録は「分からない」として数えない
 */
export async function changedSinceAck(db: Db, tenantId: string, month: string, issues: WatchIssue[]): Promise<Set<string>> {
  const acked = issues.filter((i) => i.acked && i.severity === "red");
  if (!acked.length) return new Set();
  const rows = await db
    .select({ detail: s.auditLog.detail })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "watch.ack"), sql`${s.auditLog.detail}->>'month' = ${month}`))
    .orderBy(desc(s.auditLog.id));
  const latest = new Map<string, unknown>();
  for (const r of rows) {
    const d = r.detail as { code?: unknown; subjectId?: unknown; issueDetail?: unknown };
    if (typeof d.code !== "string" || typeof d.subjectId !== "string") continue;
    const key = ackKey(d.code, d.subjectId);
    if (!latest.has(key)) latest.set(key, d.issueDetail);
  }
  const out = new Set<string>();
  for (const i of acked) {
    const key = ackKey(i.code, i.subjectId);
    const then = latest.get(key);
    if (typeof then === "string" && then !== i.detail) out.add(key);
  }
  return out;
}
