/**
 * 本番に切り替える（Excel をやめて、しめ日ラボだけで締める）ための条件（純関数。DB に触らない）。
 * SPEC P0-9.5：比べた人が全員「一致」か、差のある人全員に理由のメモが付くまで切り替えない。
 * 画面（押せるか・何が足りないか）・PDF・切り替えの処理（goLive）が、同じこの関数で決める。
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/;

/** 切り替えの目安：続けて一致（または説明済み）の月の数 */
export const GOLIVE_STREAK_TARGET = 2;

/** tenants.onboarding.golive から、本番に切り替えた月（YYYY-MM-01）を読む（無ければ null） */
export function goLiveFrom(onboarding: Record<string, string> | null | undefined): string | null {
  const v = onboarding?.golive;
  return typeof v === "string" && MONTH_RE.test(v) ? v : null;
}

type GateRow = {
  driverId: string;
  name: string;
  ours: number | null;
  excelTotal: number | null;
  diff: number | null;
  note: string | null;
  stale?: boolean;
  source?: "saved" | "draft" | null;
  explanations?: { title: string }[];
};

export type GoLiveGate = {
  /** 押せるか（比べた人が 1 人以上いて、差のある人全員に理由のメモがある） */
  ready: boolean;
  /** 押せない理由（画面にそのまま出す文。押せるときは空） */
  blockers: string[];
  /** 差があって、理由のメモがまだ無い人（差の大きい順） */
  missingNotes: { driverId: string; name: string; diff: number; candidate: string | null }[];
  /** 差があって、理由のメモがある人 */
  explained: { driverId: string; name: string; diff: number; note: string }[];
  /** しめ日ラボに額があるのに、Excel の額がまだ入っていない人（押すのは止めないが、知らせる） */
  notEntered: { driverId: string; name: string }[];
  /** 明細を保存したあとに稼働・設定が変わった人（押すのは止めないが、知らせる） */
  stale: number;
  compared: number;
  matched: number;
  /** 続けて一致（または説明済み）の月の数と、目安に届いているか */
  streak: number;
  streakOk: boolean;
  /** 押す前に確かめてほしいこと（止めはしない） */
  cautions: string[];
};

/** 「遠藤 大輔さん・木村 誠さん ほか 2人」 */
export function namesText(names: string[], max = 3): string {
  const shown = names.slice(0, max).map((n) => `${n}さん`).join("・");
  return names.length > max ? `${shown} ほか ${names.length - max}人` : shown;
}

function yen(n: number): string {
  return `${n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("ja-JP")}円`;
}

/**
 * 切り替えの条件を確かめる。rows は比べ合わせの行（loadParallel の rows）、streak は parallelHistory の streak。
 * 止めるのは「比べた人がいない」「差があるのに理由のメモが無い人がいる」の 2 つだけ（SPEC のとおり）。
 */
export function goLiveGate(rows: GateRow[], streak = 0): GoLiveGate {
  const compared = rows.filter((r) => r.excelTotal !== null && r.diff !== null);
  const diffs = compared.filter((r) => r.diff !== 0);
  const missingNotes = diffs
    .filter((r) => !r.note?.trim())
    .map((r) => ({ driverId: r.driverId, name: r.name, diff: r.diff!, candidate: r.explanations?.[0]?.title ?? null }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name, "ja"));
  const explained = diffs
    .filter((r) => r.note?.trim())
    .map((r) => ({ driverId: r.driverId, name: r.name, diff: r.diff!, note: r.note!.trim() }));
  const notEntered = rows.filter((r) => r.excelTotal === null && r.ours !== null).map((r) => ({ driverId: r.driverId, name: r.name }));
  const stale = rows.filter((r) => r.stale).length;

  const blockers: string[] = [];
  if (compared.length === 0) blockers.push("まだ Excel の振込額を 1 人も入れていません。Excel の額を入れて比べてから切り替えてください。");
  if (missingNotes.length > 0) {
    blockers.push(
      `差があって、理由のメモがまだ無い人が ${missingNotes.length}人います（${missingNotes
        .slice(0, 3)
        .map((m) => `${m.name}さん ${yen(m.diff)}`)
        .join("・")}${missingNotes.length > 3 ? ` ほか ${missingNotes.length - 3}人` : ""}）。どちらに合わせるかを決めて、メモに残してください。`,
    );
  }

  const cautions: string[] = [];
  if (notEntered.length > 0) {
    cautions.push(`Excel の額をまだ入れていない人が ${notEntered.length}人います（${namesText(notEntered.map((n) => n.name))}）。この人たちは比べていません。`);
  }
  if (stale > 0) cautions.push(`明細を作ったあとに稼働・設定が変わった人が ${stale}人います。比べているのは保存した明細の額です。`);
  const streakOk = streak >= GOLIVE_STREAK_TARGET;
  if (!streakOk) cautions.push(`続けて一致（または説明済み）の月は ${streak} か月です。目安の ${GOLIVE_STREAK_TARGET}〜3 か月に届いていません。`);

  return {
    ready: blockers.length === 0,
    blockers,
    missingNotes,
    explained,
    notEntered,
    stale,
    compared: compared.length,
    matched: compared.length - diffs.length,
    streak,
    streakOk,
    cautions,
  };
}
