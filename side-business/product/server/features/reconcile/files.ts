/**
 * 1 通のお支払通知（元請 × 月）を作るファイル。営業所ごとなど、同じ元請・同じ月に何通も届くときは、
 * ファイルを「足して」合計で突き合わせる。ファイルごとに入れ替え・外すができるよう、どの行がどのファイルのものかを覚える
 * （取り込みの記録 import_batches の summary.lineIds）。DB に触らない純関数。
 */

export type FileClaim = {
  id: string;
  /** そのファイルから入れた行の id（前の版で取り込んだファイルは持っていない） */
  lineIds: string[] | null;
};

/**
 * ファイルごとの行。lineIds を持つファイルは、その行のうち今も残っている行。
 * 持たないファイル（前の版で取り込んだもの。1 通だけのとき）は、ほかのファイルのものでない残りの行。
 * どのファイルのものでもない行（ファイルの記録が無いお支払通知の行）は unclaimed に入れる
 */
export function assignLines(files: FileClaim[], lineIds: string[]): { byFile: Map<string, string[]>; unclaimed: string[] } {
  const exists = new Set(lineIds);
  const taken = new Set<string>();
  const byFile = new Map<string, string[]>();
  for (const f of files) {
    if (!f.lineIds) continue;
    const mine = f.lineIds.filter((id) => exists.has(id) && !taken.has(id));
    for (const id of mine) taken.add(id);
    byFile.set(f.id, mine);
  }
  const rest = lineIds.filter((id) => !taken.has(id));
  const legacy = files.filter((f) => !f.lineIds);
  for (const [i, f] of legacy.entries()) byFile.set(f.id, i === 0 ? rest : []);
  return { byFile, unclaimed: legacy.length > 0 ? [] : rest };
}

export type LineContent = { rawProject: string; rawDriver: string | null; qty: number | null; unitPrice: number | null; amount: number };

function contentKey(l: LineContent): string {
  const n = (v: number | null) => (v === null ? "" : String(Math.round(v * 10000) / 10000));
  return [l.rawProject.trim(), (l.rawDriver ?? "").trim(), n(l.qty), n(l.unitPrice), String(l.amount)].join("\u0000");
}

/** 2 つのファイルの行の中身が同じか（並びは問わない。同じお支払通知を二重に足すのを止める） */
export function sameLines(a: LineContent[], b: LineContent[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const count = new Map<string, number>();
  for (const l of a) count.set(contentKey(l), (count.get(contentKey(l)) ?? 0) + 1);
  for (const l of b) {
    const k = contentKey(l);
    const c = count.get(k) ?? 0;
    if (c === 0) return false;
    count.set(k, c - 1);
  }
  return true;
}

/**
 * 中身が同じファイルを、それでも足すときのチェックの名前（別の営業所の分で、たまたま同じ数・同じ金額のとき）。
 * 止めたときの知らせと、画面のチェックの両方で使う
 */
export const SAME_CONTENT_OVERRIDE = "中身が同じでも足す";

/** お支払通知の名前（画面の見出し・一覧に出す）：ファイル名を取り込んだ順に「、」でつなぐ */
export function joinFileNames(names: string[]): string {
  return names.filter((n) => n.trim()).join("、");
}
