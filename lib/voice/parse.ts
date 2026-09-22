/**
 * 話した言葉から稼働の行を組み立てる（純関数）。
 *
 * 運転席や倉庫で、片手で数字を入れられるようにするためのもの。
 * 例：「相曽さん 三郷アマゾン 10件」「相曽 三郷アマゾン 十、安藤 川崎ヤマト 5」
 *
 * 認識した文字列とマスタ（ドライバー・案件内容）だけを受け取り、
 * **DB には触らない**。保存は既存の稼働の Server Action に任せる。
 */
import { normalizeText } from "@/lib/text";

export interface VoiceDriver {
  id: string;
  name: string;
  kana?: string | null;
}

export interface VoiceItem {
  id: string;
  /** 「三郷Amazon / 標準」のように案件名と内容名をつなげたもの */
  label: string;
  projectName: string;
  itemName: string;
  unit?: string | null;
}

export interface VoiceMasters {
  drivers: VoiceDriver[];
  items: VoiceItem[];
}

export interface VoiceEntry {
  driverId: string | null;
  driverName: string;
  itemId: string | null;
  itemLabel: string;
  qty: number | null;
  /** 元の言葉（画面で見せて直せるように） */
  source: string;
  /** すべて埋まっていて、そのまま保存できるか */
  ready: boolean;
}

export interface VoiceParseResult {
  entries: VoiceEntry[];
  /** どれにも当てはめられなかった言葉（画面で伝える） */
  leftovers: string[];
}

/* ------------------------------------------------------------------ *
 * かな → ローマ字
 * 音声認識は「アマゾン」と返すのに、案件名は「Amazon」で登録されている。
 * かなをローマ字に直してから比べることで、この 2 つを同じものとして扱う。
 * （漢字は直せないので、案件名の漢字の部分はそのまま比べる）
 * ------------------------------------------------------------------ */

const ROMAJI_2: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho", しぇ: "she",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho", ちぇ: "che",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  じゃ: "ja", じゅ: "ju", じょ: "jo", じぇ: "je",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  てぃ: "ti", でぃ: "di", とぅ: "tu", どぅ: "du",
  うぃ: "wi", うぇ: "we", うぉ: "wo",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
};

const ROMAJI_1: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "wi", ゑ: "we", を: "wo", ん: "n",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ゔ: "vu",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo", ゎ: "wa",
};

/** ひらがなをローマ字に直す（かな以外はそのまま残す） */
export function toRomaji(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    const r2 = ROMAJI_2[two];
    if (r2) {
      out += r2;
      i += 2;
      continue;
    }
    const ch = s[i];
    if (ch === "っ") {
      // 次の子音を重ねる（「さっぽろ」→ sapporo）
      const next = ROMAJI_2[s.slice(i + 1, i + 3)] ?? ROMAJI_1[s[i + 1]] ?? "";
      if (next) out += next[0];
      i += 1;
      continue;
    }
    const r1 = ROMAJI_1[ch];
    out += r1 ?? ch;
    i += 1;
  }
  return out;
}

/** 比べるための形（そのままの正規化と、かなをローマ字にしたもの） */
function forms(s: string): [string, string] {
  const n = normalizeText(s);
  return [n, toRomaji(n)];
}

/* ------------------------------------------------------------------ *
 * 数量
 * ------------------------------------------------------------------ */

/** 漢数字 → 数字 */
const KANJI_DIGITS: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 数量に付く単位（あっても無くてもよい）。日給型の案件は「21日」と言うことが多い */
const UNIT = "件|個|台|本|箱|口|回|日|コース|ケース|カゴ|棚";

/** 言葉の切れ目（空白と句読点。ここで区切られていれば独立した言葉とみなす） */
const SEPARATOR = /[\s、,，。・]/;

/** 「十」「二十三」「百」などを数に直す（100 未満を想定。稼働の数量はそれで足りる） */
export function kanjiToNumber(s: string): number | null {
  if (!s) return null;
  if (/^[0-9]+$/.test(s)) return Number(s);
  let total = 0;
  let current = 0;
  let seen = false;
  for (const ch of s) {
    if (ch in KANJI_DIGITS) {
      current = KANJI_DIGITS[ch];
      seen = true;
      continue;
    }
    if (ch === "十") {
      total += (current === 0 ? 1 : current) * 10;
      current = 0;
      seen = true;
      continue;
    }
    if (ch === "百") {
      total += (current === 0 ? 1 : current) * 100;
      current = 0;
      seen = true;
      continue;
    }
    return null;
  }
  if (!seen) return null;
  return total + current;
}

function cut(t: string, index: number, length: number, qty: number): { qty: number; rest: string } {
  return { qty, rest: (t.slice(0, index) + " " + t.slice(index + length)).trim() };
}

/** 数量になりうる場所 */
interface QtyCandidate {
  start: number;
  length: number;
  value: number;
  /** 単位（件・個など）が続いていたか。付いているほうが確からしい */
  hasUnit: boolean;
}

/**
 * 候補の中から 1 つ選ぶ。
 * 単位が付いたものを優先し、同じなら**後ろのもの**（「相曽 三郷 10件」のように
 * 数量は文の後ろに来るのが普通で、案件名に入った数字を拾わないため）。
 */
function pickQty(candidates: QtyCandidate[]): QtyCandidate | null {
  if (candidates.length === 0) return null;
  const withUnit = candidates.filter((c) => c.hasUnit);
  const pool = withUnit.length > 0 ? withUnit : candidates;
  return pool[pool.length - 1];
}

/**
 * 文の中から数量を 1 つ取り出す（「10件」「10個」「十」「1.5」）。
 *
 * 漢数字は **独立した言葉のとき（前後が切れ目）か、単位が続くときだけ** 数量として扱う。
 * そうしないと「三郷」の「三」を数量と読み違えて、案件名まで壊してしまう。
 */
export function extractQty(text: string): { qty: number | null; rest: string } {
  const t = text.normalize("NFKC");
  const unitRe = new RegExp(`^(?:${UNIT})`);

  // 数字（小数可）＋ 任意の単位
  const numRe = /\d+(?:\.\d+)?/g;
  const numbers: QtyCandidate[] = [];
  let n: RegExpExecArray | null;
  while ((n = numRe.exec(t)) != null) {
    const unit = unitRe.exec(t.slice(n.index + n[0].length));
    numbers.push({ start: n.index, length: n[0].length + (unit ? unit[0].length : 0), value: Number(n[0]), hasUnit: unit != null });
  }
  const num = pickQty(numbers);
  if (num) return cut(t, num.start, num.length, num.value);

  // 漢数字（「十」「二十三」など）
  const kanjiRe = /[〇零一二三四五六七八九十百]+/g;
  const kanji: QtyCandidate[] = [];
  let m: RegExpExecArray | null;
  while ((m = kanjiRe.exec(t)) != null) {
    const start = m.index;
    const before = start === 0 ? "" : t[start - 1];
    if (before && !SEPARATOR.test(before)) continue; // 「三郷」のように言葉の途中なら数量ではない
    const unit = unitRe.exec(t.slice(start + m[0].length));
    const end = start + m[0].length + (unit ? unit[0].length : 0);
    const after = t[end] ?? "";
    if (!unit && after && !SEPARATOR.test(after)) continue; // 「三郷」の「三」を弾く
    const value = kanjiToNumber(m[0]);
    if (value == null || value <= 0) continue;
    kanji.push({ start, length: end - start, value, hasUnit: unit != null });
  }
  const k = pickQty(kanji);
  if (k) return cut(t, k.start, k.length, k.value);

  return { qty: null, rest: t };
}

/* ------------------------------------------------------------------ *
 * マスタとの突き合わせ
 * ------------------------------------------------------------------ */

/** 一致の度合い（大きいほど良い。0 は不一致） */
function score(haystack: string, needle: string): number {
  if (!haystack || !needle) return 0;
  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 80 - Math.min(20, haystack.length - needle.length);
  if (haystack.includes(needle)) return 60 - Math.min(20, haystack.length - needle.length);
  if (needle.includes(haystack)) return 50 - Math.min(20, needle.length - haystack.length);
  return 0;
}

/** 正規化したものとローマ字にしたもの、良いほうの一致の度合いを返す */
function bestScore(target: [string, string], needle: [string, string]): number {
  return Math.max(score(target[0], needle[0]), score(target[1], needle[1]));
}

/** 言葉から 2 文字以上のかたまりを取り出す（名前の候補） */
function chunks(text: string): string[] {
  return text
    .split(/[\s、,，。・]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** いちばん近いドライバーを探す */
export function matchDriver(text: string, drivers: VoiceDriver[]): { driver: VoiceDriver | null; used: string } {
  const parts = chunks(text);
  let best: { driver: VoiceDriver; used: string; s: number } | null = null;
  for (const d of drivers) {
    const names = [d.name, d.kana ?? ""].filter(Boolean).map(forms);
    for (const p of parts) {
      const np = forms(p.replace(/(さん|くん|ちゃん)$/, ""));
      if (np[0].length < 2) continue;
      for (const n of names) {
        const s = bestScore(n, np);
        if (s > 0 && (!best || s > best.s)) best = { driver: d, used: p, s };
      }
    }
  }
  return best ? { driver: best.driver, used: best.used } : { driver: null, used: "" };
}

/** いちばん近い案件内容を探す */
export function matchItem(text: string, items: VoiceItem[]): { item: VoiceItem | null; used: string } {
  const parts = chunks(text);
  let best: { item: VoiceItem; used: string; s: number } | null = null;
  for (const it of items) {
    const targets = [it.label, it.projectName, `${it.projectName}${it.itemName}`].filter(Boolean).map(forms);
    // 1 語ずつと、隣り合う 2 語をつなげたものの両方で見る（「三郷 アマゾン」に対応）
    const candidates = [...parts, ...parts.slice(0, -1).map((p, i) => p + parts[i + 1])];
    for (const p of candidates) {
      const np = forms(p);
      if (np[0].length < 2) continue;
      for (const t of targets) {
        const s = bestScore(t, np);
        if (s > 0 && (!best || s > best.s)) best = { item: it, used: p, s };
      }
    }
  }
  return best ? { item: best.item, used: best.used } : { item: null, used: "" };
}

/** 「、」「と」「あと」などで複数の行に割る */
export function splitPhrases(text: string): string[] {
  return text
    .normalize("NFKC")
    .split(/[、,，。\n]+|\s+と\s+|\s*あと\s*|\s*つぎ\s*|\s*次\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 話した言葉を稼働の行に直す。
 * ドライバーを省いた 2 つ目以降は、直前のドライバーを引き継ぐ（「相曽、三郷10、川崎5」）。
 */
export function parseVoiceEntries(text: string, masters: VoiceMasters): VoiceParseResult {
  const phrases = splitPhrases(text);
  const entries: VoiceEntry[] = [];
  const leftovers: string[] = [];
  let lastDriver: VoiceDriver | null = null;

  for (const phrase of phrases) {
    const { qty, rest } = extractQty(phrase);
    const { driver, used: driverWord } = matchDriver(rest, masters.drivers);
    const afterDriver = driverWord ? rest.replace(driverWord, " ") : rest;
    const { item } = matchItem(afterDriver, masters.items);

    if (!driver && !item && qty == null) {
      leftovers.push(phrase);
      continue;
    }
    const useDriver = driver ?? lastDriver;
    if (driver) lastDriver = driver;
    entries.push({
      driverId: useDriver?.id ?? null,
      driverName: useDriver?.name ?? "",
      itemId: item?.id ?? null,
      itemLabel: item?.label ?? "",
      qty,
      source: phrase,
      ready: Boolean(useDriver && item && qty != null && qty > 0),
    });
  }

  return { entries, leftovers };
}

/** 聞き取れたことを 1 行で（画面の確認用） */
export function describeVoiceEntry(e: VoiceEntry): string {
  const parts = [e.driverName || "（ドライバー未指定）", e.itemLabel || "（案件未指定）", e.qty != null ? `${e.qty}` : "（数量未指定）"];
  return parts.join(" / ");
}

/** 保存する 1 行（画面で直したあとの形） */
export interface VoiceSaveRow {
  driverId: string;
  itemId: string;
  qty: number;
}

/**
 * 同じ「ドライバー × 案件内容」が 2 回以上出てきたら数量を足し合わせる。
 * （「相曽 三郷 5、相曽 三郷 3」＝ 8。同じ組み合わせは 1 行にしか保存できないため）
 */
export function mergeVoiceRows(rows: VoiceSaveRow[]): VoiceSaveRow[] {
  const out: VoiceSaveRow[] = [];
  const index = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.driverId}\u0000${r.itemId}`;
    const at = index.get(key);
    if (at == null) {
      index.set(key, out.length);
      out.push({ ...r });
      continue;
    }
    out[at] = { ...out[at], qty: out[at].qty + r.qty };
  }
  return out;
}
