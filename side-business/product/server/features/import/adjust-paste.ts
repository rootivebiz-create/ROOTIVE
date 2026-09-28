/**
 * 稼働と調整：Excel から貼り付けた表（名前・内容・金額）を、その月の調整の行にする（純関数。DB に触らない）。
 * 燃料・高速代・立替・事故の負担など、人ごとに額が変わるものを 1 件ずつ打たなくてよいように。
 * 1 行でも読めない行があれば、どの行がなぜかを返す（入れるのは、全部そろってから）。
 */
import { matchName, type Candidate } from "~/server/names";
import { parseNumberCell } from "~/server/tabular";

export const PASTE_MAX_LINES = 500;
const LABEL_MAX = 60;

export type PasteSign = "asIs" | "minus" | "plus";

export type PasteRow = { line: number; driverId: string; driverName: string; label: string; amount: number };
export type PasteResult = { rows: PasteRow[]; problems: string[]; skipped: number };

/** 貼り付けた 1 行をセルに分ける（Excel はタブ区切り。無ければカンマか、2 つ以上の空白） */
function cellsOf(line: string): string[] {
  const parts = line.includes("\t") ? line.split("\t") : line.includes(",") && !/\d,\d{3}/.test(line) ? line.split(",") : line.split(/\s{2,}/);
  return parts.map((c) => c.trim());
}

/** 金額のセル（△1,000・(1,000)・−1,000・1,000円 も読む） */
function amountOf(raw: string): number | null {
  const v = raw.normalize("NFKC").trim().replace(/^[−ー–—]/, "-");
  return parseNumberCell(v);
}

/**
 * 貼り付けた表を読む。列は「名前・内容・金額」（内容が無ければ defaultLabel）。
 * 金額はいちばん右の数の列。見出しの行（名前・金額 など）は飛ばす。0 円の行は入れない。
 * sign：asIs は書いてある符号のまま（−は支払を減らす）、minus はすべて引く、plus はすべて足す
 */
export function parseAdjustmentPaste(text: string, drivers: Candidate[], opts: { defaultLabel?: string | null; sign?: PasteSign } = {}): PasteResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const rows: PasteRow[] = [];
  const problems: string[] = [];
  let skipped = 0;
  const sign = opts.sign ?? "asIs";
  const defaultLabel = (opts.defaultLabel ?? "").trim();
  const filled = lines.filter((l) => l.trim()).length;
  if (filled > PASTE_MAX_LINES) return { rows: [], problems: [`一度に入れられるのは ${PASTE_MAX_LINES} 行までです（${filled} 行あります）。分けて貼り付けてください`], skipped: 0 };
  lines.forEach((line, i) => {
    const no = i + 1;
    if (!line.trim()) return;
    const cells = cellsOf(line);
    let amountAt = -1;
    for (let c = cells.length - 1; c >= 1; c--) {
      if (cells[c] && amountOf(cells[c]) !== null) {
        amountAt = c;
        break;
      }
    }
    const name = cells[0] ?? "";
    if (amountAt < 0) {
      // 見出しの行（名前・内容・金額）は黙って飛ばす
      if (rows.length === 0 && problems.length === 0 && /名前|氏名|ドライバー|金額|内容|項目/.test(line)) {
        skipped++;
        return;
      }
      problems.push(`${no}行目「${line.trim().slice(0, 30)}」：金額が見つかりません（名前・内容・金額の順に並べてください）`);
      return;
    }
    const raw = amountOf(cells[amountAt])!;
    if (!Number.isInteger(raw)) {
      problems.push(`${no}行目：金額「${cells[amountAt]}」は 1 円単位にしてください`);
      return;
    }
    if (raw === 0) {
      skipped++;
      return;
    }
    if (Math.abs(raw) > 10_000_000) {
      problems.push(`${no}行目：金額「${cells[amountAt]}」が大きすぎます。桁を確かめてください`);
      return;
    }
    if (!name) {
      problems.push(`${no}行目：名前が空です`);
      return;
    }
    const label = (cells.slice(1, amountAt).filter(Boolean).join(" ") || defaultLabel).slice(0, LABEL_MAX);
    if (!label) {
      problems.push(`${no}行目（${name}）：内容がありません。内容の列を入れるか、上の「内容（全員同じとき）」に入れてください`);
      return;
    }
    const m = matchName(name, drivers);
    if (!m) {
      problems.push(`${no}行目：「${name}」は台帳に見つかりません。台帳の名前か番号で書いてください`);
      return;
    }
    if (m.how === "partial") {
      problems.push(`${no}行目：「${name}」は名前の一部だけが「${m.name}」さんと同じです。別の人に入れないよう、台帳の名前で書いてください`);
      return;
    }
    const amount = sign === "asIs" ? raw : sign === "minus" ? -Math.abs(raw) : Math.abs(raw);
    rows.push({ line: no, driverId: m.id, driverName: m.name, label, amount });
  });
  if (rows.length === 0 && problems.length === 0) problems.push("入れる行がありません。Excel の「名前・内容・金額」の列を選んでコピーし、ここに貼り付けてください");
  return { rows, problems, skipped };
}
