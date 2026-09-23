/**
 * 取り込み：表の形を見分ける（純関数。DB に触らない）。
 * - 見出しの行（2 段の見出しも）・列の役目（見出しの言葉と、中の値が台帳の名前に当たるか）・縦持ちか横持ちか
 * - 覚えた読み方（mapping_profiles）との対応づけ
 * - 何月分かの推測（日付の列・表題・ファイル名）
 */
import { matchName, normalizeName, type Candidate } from "~/server/names";
import { dataRows, detectHeaderRow, headerSignature, isBlankRow, isTotalRow, normalizeHeader, parseDateCell, parseNumberCell } from "~/server/tabular";
import { SINGLE_ROLES, type ColumnRole, type WorkMapping } from "./types";

export type KnownNames = { drivers: Candidate[]; projects: Candidate[] };

// ---------------------------------------------------------------- 小さな道具

/** 列の番号 → Excel の列の名前（0 → A、26 → AA） */
export function colLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function sheetWidth(rows: string[][]): number {
  return rows.reduce((w, r) => Math.max(w, r.length), 0);
}

/** 保存する前に、末尾の空の行とセルを落とす（中身は変えない） */
export function trimSheet(rows: string[][]): string[][] {
  const out = rows.map((r) => {
    let end = r.length;
    while (end > 0 && (r[end - 1] ?? "").trim() === "") end--;
    return r.slice(0, end);
  });
  let last = out.length;
  while (last > 0 && out[last - 1].length === 0) last--;
  return out.slice(0, last);
}

/** データの行の数（見出しより下の、空でも合計でもない行） */
export function dataRowCount(rows: string[][]): number {
  if (rows.length === 0) return 0;
  return dataRows(rows, detectHeaderRow(rows)).length;
}

/**
 * シートが複数あるときは、データの行がいちばん多いものを選ぶ。
 * month を渡すと、その月のシート（シート名「10月」「2026年10月」や表題）を先に選ぶ
 * （月ごとにシートを足していくブックで、行の多い別の月を選ばないように）。
 */
export function chooseSheet(sheets: { name?: string; rows: string[][] | null; dataRows?: number }[], month?: string): number {
  const count = (s: (typeof sheets)[number]) => s.dataRows ?? (s.rows ? dataRowCount(s.rows) : 0);
  const pick = (idx: number[]) => idx.reduce((best, i) => (count(sheets[i]) > count(sheets[best]) ? i : best), idx[0]);
  if (month) {
    const same = sheets.flatMap((s, i) => (count(s) > 0 && sheetMonth(s.name ?? "", s.rows ?? [], month) === month ? [i] : []));
    if (same.length > 0) return pick(same);
  }
  return pick(sheets.map((_, i) => i));
}

/**
 * シートの月：シート名（「2026年10月」「10月」「R8.10」）か、表題（上の 5 行の「2026年10月」）から。
 * 年の無い「10月」は、near（取り込む月）にいちばん近い年にする。分からなければ null
 */
export function sheetMonth(name: string, rows: string[][], near: string): string | null {
  const byName = monthInText(name) ?? monthNoYear(name, near);
  if (byName) return byName;
  return monthInText(
    rows
      .slice(0, 5)
      .map((r) => r.join(" "))
      .join(" "),
  );
}

/** 「10月」「10月分」のように年の無い月を、near にいちばん近い年の YYYY-MM-01 に */
export function monthNoYear(text: string, near: string): string | null {
  const m = text.normalize("NFKC").match(/(?:^|[^\d])(\d{1,2})\s*月/);
  if (!m) return null;
  const mm = Number(m[1]);
  if (mm < 1 || mm > 12) return null;
  const ny = Number(near.slice(0, 4));
  const nm = Number(near.slice(5, 7));
  let y = ny;
  if (mm - nm > 6) y = ny - 1;
  else if (nm - mm > 6) y = ny + 1;
  return `${y}-${String(mm).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------- 日付の見出し（1〜31 日・10/1 など）

export type DayHeader = { y?: number; m?: number; d: number };

/** 見出しが日付（「1」「1日」「10/1」「10月1日」「2026-10-01」「1(水)」）なら日を返す */
export function dayOfHeader(value: string): DayHeader | null {
  const v = value
    .normalize("NFKC")
    .trim()
    .replace(/\s*[(（][^)）]*[)）]\s*$/, "");
  if (!v) return null;
  let m = v.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return valid({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  m = v.match(/^(\d{1,2})[/月](\d{1,2})日?$/);
  if (m) return valid({ m: Number(m[1]), d: Number(m[2]) });
  m = v.match(/^(\d{1,2})日?$/);
  if (m) return valid({ d: Number(m[1]) });
  return null;
}

function valid(h: DayHeader): DayHeader | null {
  if (h.d < 1 || h.d > 31) return null;
  if (h.m !== undefined && (h.m < 1 || h.m > 12)) return null;
  return h;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function ymd(y: number, m: number, d: number): string | null {
  if (d > daysInMonth(y, m)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 日付の見出しの列 → 日付。日だけの見出しは、取り込む月の日にする。
 * 締め日が月末でない表（21, 22, …, 31, 1, …, 20）は、日が戻ったところより前を前の月にする。
 */
export function dayColumnDates(headers: { col: number; header: string }[], month: string): Map<number, string> {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const out = new Map<number, string>();
  const days = headers.map((h) => ({ col: h.col, day: dayOfHeader(h.header) })).filter((x): x is { col: number; day: DayHeader } => x.day !== null);
  // 日だけの見出しで、途中で日が戻るか
  const onlyDays = days.filter((x) => x.day.m === undefined);
  let wrapAt = -1;
  for (let i = 1; i < onlyDays.length; i++) {
    if (onlyDays[i].day.d < onlyDays[i - 1].day.d) {
      wrapAt = i;
      break;
    }
  }
  const beforeWrap = new Set(wrapAt > 0 ? onlyDays.slice(0, wrapAt).map((x) => x.col) : []);
  for (const { col, day } of days) {
    let yy = day.y ?? y;
    let mm = day.m ?? m;
    if (day.m === undefined && beforeWrap.has(col)) {
      mm = m - 1;
      if (mm === 0) {
        mm = 12;
        yy = y - 1;
      }
    } else if (day.m !== undefined && day.y === undefined) {
      // 10/1 のように月だけ：取り込む月より 6 か月以上あとなら前の年
      if (mm - m > 6) yy = y - 1;
      else if (m - mm > 6) yy = y + 1;
    }
    const date = ymd(yy, mm, day.d);
    if (date) out.set(col, date);
  }
  return out;
}

// ---------------------------------------------------------------- 見出し

/** 見出しの下の行が「日付の段」なら 2 段の見出し（上に月、下に 1, 2, 3 …） */
export function detectHeaderDepth(rows: string[][], headerRow: number): 1 | 2 {
  const next = rows[headerRow + 1];
  if (!next) return 1;
  const texty = next.filter((c) => c && dayOfHeader(c) === null && parseNumberCell(c) === null && !isTotalHeader(c));
  if (texty.length > 0) return 1;
  // 隣り合う 3 つの列が 1 日ずつ続いていれば、日付の段とみなす
  for (let c = 0; c + 2 < next.length; c++) {
    const a = dayOfHeader(next[c] ?? "");
    const b = dayOfHeader(next[c + 1] ?? "");
    const d = dayOfHeader(next[c + 2] ?? "");
    if (a && b && d && step(a, b) && step(b, d)) return 2;
  }
  return 1;
}

function step(a: DayHeader, b: DayHeader): boolean {
  return b.d === a.d + 1 || (b.d === 1 && a.d >= 28);
}

/** 使う見出し（2 段なら下の段を優先し、空なら上の段） */
export function effectiveHeader(rows: string[][], headerRow: number, depth: 1 | 2): string[] {
  const width = sheetWidth(rows);
  const top = rows[headerRow] ?? [];
  const bottom = depth === 2 ? (rows[headerRow + 1] ?? []) : [];
  return Array.from({ length: width }, (_, c) => (depth === 2 ? bottom[c] || top[c] || "" : top[c] || ""));
}

/** ファイルの形の目印。日付の見出しは 1 つにまとめる（30 日の月と 31 日の月で同じ形にする） */
export function shapeSignature(header: string[]): string {
  const tokens: string[] = [];
  for (const h of header) {
    const t = dayOfHeader(h) ? "#日" : h;
    if (t === "#日" && tokens.at(-1) === "#日") continue;
    tokens.push(t);
  }
  return headerSignature(tokens);
}

// ---------------------------------------------------------------- 見出しの言葉

type Keyword = "total" | "ignore" | "money" | "date" | "qty" | "code" | "note" | "driver" | "project";

const KW: [Keyword, RegExp][] = [
  ["total", /^(総?合計|小計|計|total|sum)$/],
  ["ignore", /^(no\.?|#|連番|行|行番号|順|順番)$|車両|車番|ナンバー/],
  ["money", /単価|金額|円|売上|報酬|支払|請求|税|料金|代金|手当|控除|ロイヤリティ|管理費|リース|保険/],
  ["date", /日付|稼働日(?!数)|配達日(?!数)|作業日(?!数)|年月日|日時|^日$|date/],
  ["qty", /数量|個数|件数|日数|時間|回数|便数|台数|本数|実績|qty|quantity|^数$/],
  ["code", /コード|code|社員番号|従業員番号|社員no|^番号$|^id$|ドライバー番号|ドライバーno/],
  ["note", /備考|メモ|摘要|コメント|note|memo/],
  ["driver", /ドライバー|ドライバ|氏名|名前|^担当者?名?$|乗務員|委託者|委託先|配達員|作業者|社員名|スタッフ|driver|^name$|^名$/],
  ["project", /コース|案件|品目|品名|業務|種別|種類|内容|作業|サービス|区分|便名|project|course|item/],
];

/** 数量だけを表す見出し（「個数」「稼働日数」など。案件名を含まない） */
const PURE_QTY = /^(稼働|配達|配送|作業|実績|合計)?(数量|個数|件数|日数|時間|回数|便数|台数|本数|個数日数|数)$/;

export function headerKeyword(header: string): Keyword | null {
  const n = normalizeHeader(header);
  if (!n) return null;
  for (const [k, re] of KW) if (re.test(n)) return k;
  return null;
}

export function isTotalHeader(header: string): boolean {
  return headerKeyword(header) === "total";
}

// ---------------------------------------------------------------- 列の役目を推測する

type ColStat = {
  col: number;
  header: string;
  kw: Keyword | null;
  nonEmpty: number;
  numericRate: number;
  dateRate: number;
  driverRate: number;
  codeRate: number;
  projectRate: number;
  headerProject: boolean;
  headerDay: boolean;
};

const SAMPLE_ROWS = 300;

function rate(values: string[], hit: (v: string) => boolean): number {
  if (values.length === 0) return 0;
  const cache = new Map<string, boolean>();
  let n = 0;
  for (const v of values) {
    let h = cache.get(v);
    if (h === undefined) {
      h = hit(v);
      cache.set(v, h);
    }
    if (h) n++;
  }
  return n / values.length;
}

function looseCode(v: string): string {
  return v.normalize("NFKC").toLowerCase().replace(/\s/g, "");
}

function columnStats(rows: string[][], headerRow: number, depth: 1 | 2, header: string[], known: KnownNames): ColStat[] {
  const body: string[][] = [];
  for (let i = headerRow + depth; i < rows.length && body.length < SAMPLE_ROWS; i++) {
    if (isBlankRow(rows[i]) || isTotalRow(rows[i])) continue;
    body.push(rows[i]);
  }
  const codes = new Set(known.drivers.map((d) => (d.code ? looseCode(d.code) : "")).filter(Boolean));
  return header.map((h, col) => {
    const values = body.map((r) => (r[col] ?? "").trim()).filter(Boolean);
    const kw = headerKeyword(h);
    const hp = h ? matchName(h, known.projects) : null;
    return {
      col,
      header: h,
      kw,
      nonEmpty: values.length,
      numericRate: rate(values, (v) => parseNumberCell(v) !== null),
      dateRate: rate(values, (v) => parseDateCell(v, 2000) !== null && parseNumberCell(v) === null),
      driverRate: rate(values, (v) => {
        const m = matchName(v, known.drivers);
        return m !== null && m.how !== "code";
      }),
      codeRate: rate(values, (v) => codes.has(looseCode(v))),
      projectRate: rate(values, (v) => matchName(v, known.projects) !== null),
      headerProject: hp !== null && (hp.how !== "partial" || kw === null),
      headerDay: dayOfHeader(h) !== null,
    };
  });
}

export type Guess = { mapping: WorkMapping; header: string[]; notes: string[] };

/**
 * 列の役目を推測する。見出しの言葉と、中の値（台帳の名前に当たる割合・数の割合）の両方を見る。
 * headerRow を渡すとその行を見出しにする（利用者が選び直したとき）。
 */
export function guessMapping(rows: string[][], known: KnownNames, opts: { headerRow?: number } = {}): Guess {
  const headerRow = opts.headerRow ?? detectHeaderRow(rows);
  const depth = detectHeaderDepth(rows, headerRow);
  const header = effectiveHeader(rows, headerRow, depth);
  const stats = columnStats(rows, headerRow, depth, header, known);
  const roles: ColumnRole[] = header.map(() => "ignore");
  const notes: string[] = [];
  const taken = new Set<number>();

  const isNumeric = (s: ColStat) => s.nonEmpty > 0 && s.numericRate >= 0.6;
  const blocked = (s: ColStat) => s.kw === "total" || s.kw === "ignore" || s.kw === "money";

  // 日付の列（見出しの言葉か、中が日付）
  const dateCol = stats
    .filter((s) => !blocked(s) && s.nonEmpty > 0 && (s.kw === "date" || s.dateRate >= 0.6) && !s.headerDay)
    .sort((a, b) => Number(b.kw === "date") - Number(a.kw === "date") || b.dateRate - a.dateRate)[0];
  if (dateCol) {
    roles[dateCol.col] = "date";
    taken.add(dateCol.col);
  }

  // ドライバーの番号（見出しの言葉か、中が台帳の番号）
  const codeCol = stats
    .filter((s) => !taken.has(s.col) && !blocked(s) && s.nonEmpty > 0 && (s.kw === "code" || (s.codeRate >= 0.6 && s.codeRate >= s.driverRate)))
    .sort((a, b) => b.codeRate - a.codeRate)[0];
  if (codeCol) {
    roles[codeCol.col] = "driverCode";
    taken.add(codeCol.col);
  }

  const textCols = stats.filter((s) => !taken.has(s.col) && !blocked(s) && s.nonEmpty > 0 && !isNumeric(s) && s.kw !== "date" && s.kw !== "qty");

  // ドライバーの名前：台帳の名前に当たる割合 ＋ 見出しの言葉
  const driverScore = (s: ColStat) => s.driverRate + (s.kw === "driver" ? 0.5 : 0) - (s.kw === "project" || s.kw === "note" ? 0.3 : 0);
  let driverCol = [...textCols].sort((a, b) => driverScore(b) - driverScore(a))[0];
  if (driverCol && driverScore(driverCol) < 0.5) {
    // 台帳がまだ空の会社：見出しの言葉が無ければ、いちばん左の文字の列
    driverCol = textCols.find((s) => s.kw === null || s.kw === "driver") ?? driverCol;
    if (driverCol) notes.push(`「${driverCol.header || colLetter(driverCol.col) + "列"}」をドライバーの名前とみなしました`);
  }
  if (driverCol) {
    roles[driverCol.col] = "driver";
    taken.add(driverCol.col);
  }

  // 案件：台帳の案件に当たる割合 ＋ 見出しの言葉
  const projectScore = (s: ColStat) => s.projectRate + (s.kw === "project" ? 0.5 : 0) - (s.kw === "driver" || s.kw === "note" ? 0.3 : 0);
  const projectCol = textCols.filter((s) => !taken.has(s.col)).sort((a, b) => projectScore(b) - projectScore(a))[0];
  if (projectCol && projectScore(projectCol) >= 0.5) {
    roles[projectCol.col] = "project";
    taken.add(projectCol.col);
  }

  const noteCol = stats.find((s) => !taken.has(s.col) && s.kw === "note");
  if (noteCol) {
    roles[noteCol.col] = "note";
    taken.add(noteCol.col);
  }

  // 数の列：縦持ち（数量の列が 1 つ）か横持ち（案件名・日付の見出しの列が並ぶ）か
  const numeric = stats.filter((s) => !taken.has(s.col) && !blocked(s) && s.kw !== "code" && s.kw !== "date" && isNumeric(s));
  const hints = numeric.filter((s) => s.headerProject || s.headerDay);
  const qtyKw = numeric.filter((s) => s.kw === "qty" && !s.headerProject);
  const pureQty = qtyKw.filter((s) => PURE_QTY.test(normalizeHeader(s.header)));
  const hasProjectCol = roles.includes("project");
  let qtyCol: ColStat | undefined;
  let values: ColStat[] = [];
  if (hints.length >= 2) values = numeric;
  else if (hasProjectCol) qtyCol = pureQty[0] ?? qtyKw[0] ?? (numeric.length === 1 ? numeric[0] : undefined);
  else if (numeric.length === 1) qtyCol = numeric[0];
  else if (numeric.length >= 2) {
    // 案件の列が無く、数の列が 2 つ以上：「個数」のような数量だけの見出しが 1 つなら縦持ち、ほかは横持ち
    if (hints.length === 0 && pureQty.length === 1) qtyCol = pureQty[0];
    else values = numeric;
  }

  if (qtyCol) roles[qtyCol.col] = "qty";
  for (const v of values) roles[v.col] = "value";

  const useDates = dateCol ? distinctDates(rows, headerRow + depth, dateCol.col) >= 2 : false;
  if (dateCol && !useDates) notes.push(`日付の列はすべて同じ日なので、集計した日とみなし、日ごとには分けません`);
  if (!qtyCol && values.length === 0) notes.push("数の入った列が見つかりませんでした。下の表を見て、数量の列を選んでください");

  return { mapping: { headerRow, headerDepth: depth, roles, fixedProjectId: null, useDates }, header, notes };
}

function distinctDates(rows: string[][], start: number, col: number): number {
  const set = new Set<string>();
  for (let i = start; i < rows.length; i++) {
    const d = parseDateCell(rows[i][col] ?? "", 2000);
    if (d) set.add(d);
    if (set.size >= 2) break;
  }
  return set.size;
}

/** 同じ役目が 2 つの列に付いていないか・足りないものは何か（画面の「読み方」の確かめ） */
export function mappingProblem(mapping: WorkMapping): string | null {
  const roles = mapping.roles;
  for (const r of SINGLE_ROLES) {
    if (roles.filter((x) => x === r).length > 1) return `「${ROLE_NAMES[r]}」が 2 つ以上の列に付いています。1 つの列にしてください`;
  }
  if (!roles.includes("driver") && !roles.includes("driverCode")) return "ドライバーの名前（または番号）の列を選んでください";
  const hasQty = roles.includes("qty");
  const hasValues = roles.includes("value");
  if (hasQty && hasValues) return "「数量」の列と「数（見出しが案件名か日付）」の列は、どちらか一方にしてください";
  if (!hasQty && !hasValues) return "数の入った列が決まっていません。数量の列を選んでください";
  return null;
}

const ROLE_NAMES: Record<ColumnRole, string> = {
  driver: "ドライバーの名前",
  driverCode: "ドライバーの番号",
  project: "案件",
  qty: "数量",
  date: "日付",
  note: "備考",
  value: "数",
  ignore: "使わない",
};

// ---------------------------------------------------------------- 覚えた読み方（mapping_profiles）

export type ProfileLike = { id: string; headerSignature: string; mapping: Record<string, string>; options: Record<string, unknown> };

type ProfileOptions = { headerRow?: number; headerDepth?: 1 | 2; fixedProjectId?: string | null; useDates?: boolean; dayRole?: ColumnRole };

/** 見出しごとの鍵（同じ見出しが 2 つあれば #1, #2 …） */
function headerKeys(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((h) => {
    if (dayOfHeader(h)) return "#日";
    const n = normalizeHeader(h) || "(空)";
    const k = seen.get(n) ?? 0;
    seen.set(n, k + 1);
    return `${n}#${k}`;
  });
}

/** 読み方を mapping_profiles に入れる形にする */
export function profileData(header: string[], mapping: WorkMapping): { mapping: Record<string, string>; options: Record<string, unknown> } {
  const keys = headerKeys(header);
  const out: Record<string, string> = {};
  let dayRole: ColumnRole | undefined;
  keys.forEach((k, i) => {
    const role = mapping.roles[i] ?? "ignore";
    if (k === "#日") dayRole ??= role;
    else out[k] = role;
  });
  const options: ProfileOptions = {
    headerRow: mapping.headerRow,
    headerDepth: mapping.headerDepth,
    fixedProjectId: mapping.fixedProjectId,
    useDates: mapping.useDates,
    ...(dayRole ? { dayRole } : {}),
  };
  return { mapping: out, options };
}

function isRole(v: unknown): v is ColumnRole {
  return typeof v === "string" && ["driver", "driverCode", "project", "qty", "date", "note", "value", "ignore"].includes(v);
}

/** 同じ形のファイルの読み方を探す（自動で見つけた見出しの行、または前回選んだ見出しの行で比べる） */
export function findProfile<P extends ProfileLike>(rows: string[][], profiles: P[]): { profile: P; mapping: WorkMapping } | null {
  if (profiles.length === 0) return null;
  const tries = new Set<number>([detectHeaderRow(rows)]);
  for (const p of profiles) {
    const hr = (p.options as ProfileOptions).headerRow;
    if (typeof hr === "number" && hr >= 0 && hr < rows.length) tries.add(hr);
  }
  for (const headerRow of tries) {
    for (const depth of [detectHeaderDepth(rows, headerRow), (detectHeaderDepth(rows, headerRow) === 2 ? 1 : 2) as 1 | 2]) {
      const header = effectiveHeader(rows, headerRow, depth);
      const sig = shapeSignature(header);
      const p = profiles.find((x) => x.headerSignature === sig);
      if (!p) continue;
      const opts = p.options as ProfileOptions;
      if (opts.headerDepth && opts.headerDepth !== depth) continue;
      const keys = headerKeys(header);
      const roles = keys.map((k) => {
        const r = k === "#日" ? opts.dayRole : p.mapping[k];
        return isRole(r) ? r : "ignore";
      });
      return {
        profile: p,
        mapping: { headerRow, headerDepth: depth, roles, fixedProjectId: opts.fixedProjectId ?? null, useDates: opts.useDates ?? false },
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------- 何月分か

/** 文の中の「2026年10月」「令和8年10月」「2026-10」「202610」を YYYY-MM-01 に */
export function monthInText(text: string): string | null {
  const v = text.normalize("NFKC");
  let m = v.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (m) return monthOf(Number(m[1]), Number(m[2]));
  m = v.match(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月/);
  if (m) return monthOf(2018 + (m[1] === "元" ? 1 : Number(m[1])), Number(m[2]));
  m = v.match(/(?:^|[^\d])(20\d{2})[-_/.](\d{1,2})(?![\d])/);
  if (m) return monthOf(Number(m[1]), Number(m[2]));
  m = v.match(/(?:^|[^\d])(20\d{2})(0[1-9]|1[0-2])(?!\d)/);
  if (m) return monthOf(Number(m[1]), Number(m[2]));
  return null;
}

function monthOf(y: number, m: number): string | null {
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * 日付のセルを読む。「12/28」のように年の無い日付は、month（YYYY-MM-01）にいちばん近い年にする
 * （2027年1月分の表にある 12/28 は 2026年12月28日。month の年をそのまま付けると 1 年先になる）
 */
export function dateNear(raw: string, month: string): string | null {
  const year = Number(month.slice(0, 4));
  const d = parseDateCell(raw, year);
  if (!d || !/^\d{1,2}[/月]\d{1,2}日?$/.test(raw.normalize("NFKC").trim())) return d;
  const target = year * 12 + Number(month.slice(5, 7)) - 1;
  const got = Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  if (got - target > 6) return parseDateCell(raw, year - 1);
  if (target - got > 6) return parseDateCell(raw, year + 1);
  return d;
}

export type MonthGuess = { month: string; from: "dates" | "title" | "sheet" | "file" };

/**
 * 何月分かを推測する：日付の列 → 表題（見出しより上の行）→ シート名 → ファイル名。
 * シート名の「10月」のように年が無いものは、near（開いていた月）にいちばん近い年にする
 */
export function suggestMonth(rows: string[][], mapping: WorkMapping, fileName: string, sheet?: { name: string; near: string }): MonthGuess | null {
  const title = rows
    .slice(0, mapping.headerRow)
    .map((r) => r.join(" "))
    .join(" ");
  const titleMonth = monthInText(title);
  const fileMonth = monthInText(fileName);
  const sheetName = sheet ? (monthInText(sheet.name) ?? monthNoYear(sheet.name, sheet.near)) : null;
  // 年の無い日付（10/31）は、表題・シート名・ファイル名の月にいちばん近い年で読む（どれも無ければ読まない）
  const near = titleMonth ?? sheetName ?? fileMonth;

  const counts = new Map<string, number>();
  const dateCol = mapping.roles.indexOf("date");
  if (dateCol >= 0) {
    for (let i = mapping.headerRow + mapping.headerDepth; i < rows.length; i++) {
      const raw = rows[i][dateCol] ?? "";
      const d = near ? dateNear(raw, near) : parseDateCell(raw);
      if (d) counts.set(`${d.slice(0, 7)}-01`, (counts.get(`${d.slice(0, 7)}-01`) ?? 0) + 1);
    }
  }
  // 見出しがまるごとの日付（2026-10-01 …）
  const header = effectiveHeader(rows, mapping.headerRow, mapping.headerDepth);
  header.forEach((h, c) => {
    if (mapping.roles[c] !== "value") return;
    const d = dayOfHeader(h);
    if (d?.y && d.m) counts.set(monthOf(d.y, d.m) ?? "", (counts.get(monthOf(d.y, d.m) ?? "") ?? 0) + 1);
  });
  counts.delete("");
  const stated: MonthGuess | null = titleMonth
    ? { month: titleMonth, from: "title" }
    : sheetName
      ? { month: sheetName, from: "sheet" }
      : fileMonth
        ? { month: fileMonth, from: "file" }
        : null;
  if (counts.size > 0) {
    const [month] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    // 10 日締めの「10月分」（9/11〜10/10）のように、日付の多い月と書いてある月が違っても、
    // 書いてある月の日付が 1 行でもあれば、書いてある月にする（日付がまったく無ければ、写し忘れた表題とみなして日付に従う）
    if (stated && stated.month !== month && counts.has(stated.month)) return stated;
    return { month, from: "dates" };
  }
  return stated;
}

/** 案件の見出し「宅配（個）」から単位「個」を拾う（新しく登録するときの下書き） */
export function unitHint(raw: string): string | null {
  const m = raw.normalize("NFKC").match(/[(]([^)]{1,4})[)]\s*$/) ?? raw.match(/[（]([^）]{1,4})[）]\s*$/);
  const u = m?.[1]?.trim();
  if (!u) return null;
  if (/^(個|件|日|時間|便|台|回|本|km|h|口|箱|kg)$/i.test(u)) return u === "h" ? "時間" : u;
  return null;
}

/** 括弧書きを外した名前（新しく登録するときの下書き） */
export function baseName(raw: string): string {
  const cut = raw.replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
  return cut || raw.trim();
}

export { normalizeName };
