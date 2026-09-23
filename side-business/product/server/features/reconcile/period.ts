/**
 * 突き合わせる稼働の期間（純関数。DB に触らない）。
 *
 * - 元請の締め日（clients.closing_day）が当社の締め日と同じなら、当社の月の稼働をそのまま使う
 * - 違う（例：元請は 20 日締め、当社は末締め）ときは、元請の締めの期間（例：9/21〜10/20）の稼働を、
 *   稼働の日付（work_entries.work_date）で拾い直して比べる。期間にかかる当社の月（前後の月）からも拾う
 * - 期間にかかる稼働に、日付の無いものが 1 件でもあれば、期間では比べられないので当社の月で比べる
 *   （画面に「締め日が違うため月単位で比べています」と出す）
 */
import { periodOf } from "~/server/calc/statement";
import type { CmpWork } from "./compare";
import { dateJa, monthJa } from "./labels";

export type PeriodWork = { month: string; projectId: string; driverId: string; qty: number; workDate: string | null };

export type ComparePeriod = {
  /** closing：元請の締めの期間で比べた／month：当社の月（稼働の月）で比べた */
  mode: "closing" | "month";
  /** 比べた稼働の期間（month のときは、当社のその月の締めの期間） */
  from: string;
  to: string;
  /** 元請の締め日（0＝月末。元請が分からなければ null） */
  closingDay: number | null;
  /** 元請の締めの期間 */
  clientPeriod: { from: string; to: string };
  /** 元請の締めの期間が、当社の月と違う */
  differs: boolean;
  /** 締め日が違うのに、日付の無い稼働があるため、当社の月で比べた */
  fallback: boolean;
  /** 締めの期間にかかる稼働のうち、日付の無いものの数 */
  undatedCount: number;
  /** 締めの期間にかかる当社の月のうち、稼働が 1 件も入っていない月（その部分は 0 として数えている） */
  emptyMonths: string[];
};

function shift(month: string, delta: number): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * その月の突き合わせに使う稼働を選ぶ。
 * work は、その月と前後の月（当社の月）の稼働。projectIds は突き合わせる案件（その元請の案件 ＋ 通知の行が当たった案件）
 */
export function selectPeriodWork(input: {
  month: string;
  tenantClosingDay: number;
  clientClosingDay: number | null;
  projectIds: ReadonlySet<string>;
  work: PeriodWork[];
}): { work: CmpWork[]; period: ComparePeriod } {
  const { month } = input;
  const own = periodOf(month, input.tenantClosingDay);
  const clientPeriod = input.clientClosingDay === null ? own : periodOf(month, input.clientClosingDay);
  const differs = clientPeriod.from !== own.from || clientPeriod.to !== own.to;
  const clean = (list: PeriodWork[]): CmpWork[] => list.map((w) => ({ projectId: w.projectId, driverId: w.driverId, qty: w.qty }));
  const base = { closingDay: input.clientClosingDay, clientPeriod, differs, undatedCount: 0, emptyMonths: [] as string[] };
  const byMonth = () => ({ work: clean(input.work.filter((w) => w.month === month)), from: own.from, to: own.to });

  if (!differs) {
    const m = byMonth();
    return { work: m.work, period: { ...base, mode: "month", from: m.from, to: m.to, fallback: false } };
  }

  // 元請の締めの期間にかかる当社の月（前の月・その月・次の月のうち、期間が重なるもの）
  const months = [shift(month, -1), month, shift(month, 1)].filter((m) => {
    const p = periodOf(m, input.tenantClosingDay);
    return p.from <= clientPeriod.to && p.to >= clientPeriod.from;
  });
  const inMonths = input.work.filter((w) => months.includes(w.month));
  const relevant = inMonths.filter((w) => w.qty > 0 && input.projectIds.has(w.projectId));
  const undatedCount = relevant.filter((w) => !w.workDate).length;
  if (undatedCount > 0) {
    const m = byMonth();
    return { work: m.work, period: { ...base, mode: "month", from: m.from, to: m.to, fallback: true, undatedCount } };
  }
  const picked = inMonths.filter((w) => w.workDate !== null && w.workDate >= clientPeriod.from && w.workDate <= clientPeriod.to);
  // 稼働がまだ 1 件も入っていない月（取り込む前の月）は、その部分を 0 で数えていることを知らせる
  const emptyMonths = months.filter((m) => m !== month && !input.work.some((w) => w.month === m));
  return {
    work: clean(picked),
    period: { ...base, mode: "closing", from: clientPeriod.from, to: clientPeriod.to, fallback: false, emptyMonths },
  };
}

/** 2026-09-21〜2026-10-20 → 2026年9月21日〜2026年10月20日 */
export function periodText(p: { from: string; to: string }): string {
  return `${dateJa(p.from)}〜${dateJa(p.to)}`;
}

/** 締め日の言い方：0 → 末日、20 → 20日 */
export function closingDayText(day: number | null): string {
  return day === null || day === 0 || day >= 31 ? "末日" : `${day}日`;
}

/** 締めの期間についての、画面に出す注記（無ければ null）。clientName は元請の名前 */
export function periodNotes(p: ComparePeriod, clientName: string): { tone: "info" | "warn"; title: string; body: string }[] {
  const out: { tone: "info" | "warn"; title: string; body: string }[] = [];
  if (!p.differs) return out;
  if (p.mode === "closing") {
    out.push({
      tone: "info",
      title: `${clientName}の締めの期間（${periodText(p.clientPeriod)}）で比べています`,
      body: `${clientName}の締め日は毎月${closingDayText(p.closingDay)}です。当社の記録は、日付のある稼働のうち、この期間に入るものだけを数えています。`,
    });
    for (const m of p.emptyMonths) {
      out.push({
        tone: "warn",
        title: `${monthJa(m)}の稼働がまだ入っていません`,
        body: `締めの期間のうち、${monthJa(m)}の分は 0 として数えています。${monthJa(m)}の稼働を取り込んでから、突き合わせ直してください。`,
      });
    }
  } else {
    out.push({
      tone: "warn",
      title: "締め日が違うため月単位で比べています",
      body: `${clientName}の締め日は毎月${closingDayText(p.closingDay)}で、お支払通知は ${periodText(p.clientPeriod)} の分です。当社の稼働の記録に日付の無いものがある（${p.undatedCount}件）ため、当社の月（${periodText({ from: p.from, to: p.to })}）の稼働で比べています。期間の違いで差が出ることがあります。日付のある稼働表（1 日 1 行）を取り込むと、締めの期間で比べます。`,
    });
  }
  return out;
}
