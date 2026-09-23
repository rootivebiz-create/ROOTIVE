/**
 * 口座の取り込み：口座一覧の Excel・CSV、または全銀の振込ファイルを読み、台帳のドライバーに当てて、
 * 「新しく入る・変わる・同じ・当たらない」を出す（純関数。DB に触らない）。
 * 当て方：番号 → 名前 → カナ（口座名義・フリガナ）。カナは全銀の書き方（半角・小さい字は大きく）にそろえてから比べる。
 */
import { toZenginKana } from "@/lib/payroll/zengin";
import type { AccountType } from "@/lib/payroll/types";
import { matchName, normalizeName } from "~/server/names";
import { isBlankRow, isTotalRow, normalizeHeader } from "~/server/tabular";
import type { ZenginFile } from "./zengin-read";

export type BankFields = {
  bankCode: string;
  bankNameKana: string;
  branchCode: string;
  branchNameKana: string;
  accountType: AccountType;
  accountNumber: string;
  holderKana: string;
};

export type BankField = keyof BankFields;

export const BANK_FIELD_LABEL: Record<BankField, string> = {
  bankCode: "銀行コード",
  bankNameKana: "銀行名",
  branchCode: "支店コード",
  branchNameKana: "支店名",
  accountType: "種目",
  accountNumber: "口座番号",
  holderKana: "口座名義",
};

/** ファイルから読んだ 1 人分の口座 */
export type BankInputRow = {
  /** 画面に出す場所（「5 行目」「3 件目」） */
  where: string;
  name: string | null;
  code: string | null;
  kana: string | null;
  bankCode: string;
  bankNameKana: string;
  branchCode: string;
  branchNameKana: string;
  accountType: AccountType | null;
  accountNumber: string;
  holderKana: string;
  /** このままでは入れられない理由 */
  problems: string[];
  /** 入れられるが、知っておいてほしいこと */
  notes: string[];
};

export type BankSource = { kind: "table"; sheetName: string; headerRow: number } | { kind: "zengin"; typeLabel: string; transferDate: string; count: number; total: number };

// ---------------------------------------------------------------- 口座一覧の表

type Col = "name" | "code" | "kana" | "bankCode" | "bankName" | "branchCode" | "branchName" | "accountType" | "accountNumber" | "holder";

const COL_WORDS: [Col, RegExp][] = [
  ["bankCode", /(銀行|金融機関)(コード|番号|cd|no)|^銀行cd$/],
  ["branchCode", /(支店|店舗?)(コード|番号|cd|no)|^店番$/],
  ["accountNumber", /口座番号|口座no|^口座$/],
  ["accountType", /種目|種別|預金種類|口座種類|^種類$/],
  ["holder", /名義|受取人/],
  ["bankName", /銀行名|金融機関名|^銀行$|^金融機関$/],
  ["branchName", /支店名|^支店$/],
  ["kana", /フリガナ|ふりがな|カナ|かな|よみ|読み/],
  ["code", /社員番号|従業員番号|ドライバー番号|ドライバーコード|委託者番号|^コード$|^番号$|^id$/],
  ["name", /氏名|名前|ドライバー|委託者|委託先|乗務員|スタッフ|^名$/],
];

function colOf(header: string): Col | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  for (const [c, re] of COL_WORDS) if (re.test(h)) return c;
  return null;
}

/** 見出しの行：上から 15 行のうち、口座番号と、ほかに 2 つ以上の見出しがある最初の行 */
export function findBankHeader(rows: string[][]): { row: number; cols: Partial<Record<Col, number>> } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols: Partial<Record<Col, number>> = {};
    rows[i].forEach((cell, c) => {
      const k = colOf(cell);
      if (k && cols[k] === undefined) cols[k] = c;
    });
    if (cols.accountNumber !== undefined && Object.keys(cols).length >= 3) return { row: i, cols };
  }
  return null;
}

const digitsOnly = (v: string) => v.normalize("NFKC").replace(/[\s-－ー‐]/g, "");

function accountTypeOf(raw: string): AccountType | null | "blank" {
  const v = raw.normalize("NFKC").trim();
  if (!v) return "blank";
  if (/当座|^当$|^2$/.test(v)) return "checking";
  if (/普通|^普$|総合|^1$/.test(v)) return "ordinary";
  return null;
}

/** 口座一覧の表を読む（見出しが見つからなければ problem） */
export function readBankTable(rows: string[][]): { rows: BankInputRow[]; headerRow: number; problem: string | null } {
  const head = findBankHeader(rows);
  if (!head) {
    return {
      rows: [],
      headerRow: -1,
      problem: "口座一覧の見出し（氏名・銀行コード・支店コード・種目・口座番号・名義カナ）が見つかりませんでした。見出しの行があるか確かめてください",
    };
  }
  const c = head.cols;
  if (c.name === undefined && c.holder === undefined && c.kana === undefined && c.code === undefined) {
    return { rows: [], headerRow: head.row, problem: "誰の口座かが分かる列（氏名・名義カナ・番号）が見つかりませんでした" };
  }
  const cell = (r: string[], k: Col) => (c[k] === undefined ? "" : (r[c[k]!] ?? "").trim());
  const out: BankInputRow[] = [];
  for (let i = head.row + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || isBlankRow(r) || isTotalRow(r)) continue;
    const problems: string[] = [];
    const notes: string[] = [];
    const bankRaw = digitsOnly(cell(r, "bankCode"));
    const branchRaw = digitsOnly(cell(r, "branchCode"));
    const numberRaw = digitsOnly(cell(r, "accountNumber"));
    const holderRaw = cell(r, "holder") || cell(r, "kana");
    const name = cell(r, "name") || null;
    if (!bankRaw && !branchRaw && !numberRaw && !holderRaw && !name) continue;
    // Excel が先頭の 0 を落とした番号（1 → 0001）は、桁をそろえる
    if (!/^\d{1,4}$/.test(bankRaw)) problems.push(bankRaw ? `銀行コード「${cell(r, "bankCode")}」は 4 桁の数字ではありません` : "銀行コードが空です");
    if (!/^\d{1,3}$/.test(branchRaw)) problems.push(branchRaw ? `支店コード「${cell(r, "branchCode")}」は 3 桁の数字ではありません` : "支店コードが空です");
    if (!/^\d{1,7}$/.test(numberRaw)) problems.push(numberRaw ? `口座番号「${cell(r, "accountNumber")}」は 7 桁までの数字ではありません` : "口座番号が空です");
    const type = accountTypeOf(cell(r, "accountType"));
    if (type === null) problems.push(`種目「${cell(r, "accountType")}」は、普通・当座のどちらかにしてください（貯蓄などは振込データで扱えません）`);
    if (type === "blank") notes.push("種目が空なので「普通」にします");
    const holder = holderRaw ? toZenginKana(holderRaw) : null;
    if (!holderRaw) problems.push("口座名義（カナ）が空です");
    else if (holder && holder.invalid.length) problems.push(`口座名義に使えない文字があります（${[...new Set(holder.invalid)].join("")}）。カナで入れてください`);
    out.push({
      where: `${i + 1} 行目`,
      name,
      code: cell(r, "code") || null,
      kana: cell(r, "kana") || null,
      bankCode: /^\d{1,4}$/.test(bankRaw) ? bankRaw.padStart(4, "0") : bankRaw,
      bankNameKana: cell(r, "bankName"),
      branchCode: /^\d{1,3}$/.test(branchRaw) ? branchRaw.padStart(3, "0") : branchRaw,
      branchNameKana: cell(r, "branchName"),
      accountType: type === "blank" ? "ordinary" : type,
      accountNumber: /^\d{1,7}$/.test(numberRaw) ? numberRaw.padStart(7, "0") : numberRaw,
      holderKana: holderRaw,
      problems,
      notes,
    });
  }
  return { rows: out, headerRow: head.row, problem: out.length === 0 ? "口座の行がありませんでした" : null };
}

/** 全銀の振込ファイルの 1 件ずつを、口座の行にする */
export function rowsFromZengin(file: ZenginFile): BankInputRow[] {
  return file.records.map((r) => {
    const problems: string[] = [];
    if (!/^\d{4}$/.test(r.bankCode)) problems.push(`銀行コード「${r.bankCode}」が 4 桁の数字ではありません`);
    if (!/^\d{3}$/.test(r.branchCode)) problems.push(`支店コード「${r.branchCode}」が 3 桁の数字ではありません`);
    if (!/^\d{1,7}$/.test(r.accountNumber)) problems.push(`口座番号「${r.accountNumber}」が 7 桁の数字ではありません`);
    if (!r.accountType) problems.push(`種目のコード「${r.accountTypeCode}」は、普通（1）・当座（2）ではないので入れられません`);
    if (!r.holderKana) problems.push("口座名義が空です");
    return {
      where: `${r.recordNo} 件目`,
      name: null,
      code: null,
      kana: null,
      bankCode: r.bankCode,
      bankNameKana: r.bankNameKana,
      branchCode: r.branchCode,
      branchNameKana: r.branchNameKana,
      accountType: r.accountType,
      accountNumber: r.accountNumber,
      holderKana: r.holderKana,
      problems,
      notes: [],
    };
  });
}

// ---------------------------------------------------------------- 台帳に当てる

/** カナを比べる形：全銀の半角（小さい字は大きく・長音は -）→ 全角に戻して空白・記号を消す。法人の略号（ｶ) など）も外す */
export function kanaKey(value: string | null | undefined): string {
  if (!value) return "";
  const z = toZenginKana(value);
  // 漢字などが混じった名前は、読みが分からないのでカナでは比べない
  if (z.invalid.length > 0) return "";
  return normalizeName(z.value.replace(/^(ｶ|ﾕ|ｺﾞ|ｼﾔ|ｻﾞｲ|ｲ|ﾄﾞ)\)\s*/, "").replace(/\s*\((ｶ|ﾕ|ｺﾞ)\)?$/, ""));
}

export type LedgerDriver = {
  id: string;
  name: string;
  code: string | null;
  kana: string | null;
  aliases: string[];
  active: boolean;
  bankCode: string | null;
  bankNameKana: string | null;
  branchCode: string | null;
  branchNameKana: string | null;
  accountType: string;
  accountNumber: string | null;
  holderKana: string | null;
};

export function bankOfDriver(d: LedgerDriver): BankFields {
  return {
    bankCode: (d.bankCode ?? "").trim(),
    bankNameKana: (d.bankNameKana ?? "").trim(),
    branchCode: (d.branchCode ?? "").trim(),
    branchNameKana: (d.branchNameKana ?? "").trim(),
    accountType: d.accountType === "checking" ? "checking" : "ordinary",
    accountNumber: (d.accountNumber ?? "").trim(),
    holderKana: (d.holderKana ?? "").trim(),
  };
}

/** 口座番号は下 3 桁だけ見せる（記録にも画面にも） */
export function maskAccount(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  if (!s) return "";
  return `****${s.slice(-3)}`;
}

const TYPE_JA: Record<AccountType, string> = { ordinary: "普通", checking: "当座" };

/** 画面・記録に出す値（口座番号は下 3 桁だけ） */
export function shownValue(field: BankField, v: string): string {
  if (field === "accountNumber") return maskAccount(v);
  if (field === "accountType") return TYPE_JA[v as AccountType] ?? v;
  return v;
}

export type BankStatus = "new" | "changed" | "same" | "unmatched" | "problem" | "duplicate";

export type BankPreviewRow = {
  index: number;
  input: BankInputRow;
  driver: { id: string; name: string; code: string | null; active: boolean } | null;
  how: "chosen" | "code" | "name" | "kana" | null;
  /** カナが同じ人が 2 人以上いて、決められない */
  candidates: { id: string; name: string }[];
  status: BankStatus;
  /** 変わる項目（口座番号は下 3 桁だけ） */
  changes: { field: BankField; label: string; before: string; after: string }[];
  /** 台帳に書く値（status が new・changed のとき） */
  next: BankFields | null;
  /** 見たときの台帳の口座の目印（反映の前に、変わっていないかを確かめる） */
  seen: string;
};

function padNumber(v: string): string {
  return /^\d{1,7}$/.test(v) ? v.padStart(7, "0") : v;
}

/** 台帳に書く値：コード・種目・番号はファイルのまま。名前（カナ）は、読みが同じなら台帳の書き方を残す */
function nextFields(input: BankInputRow, before: BankFields): BankFields {
  const usable = (v: string) => !!v && toZenginKana(v).invalid.length === 0;
  const sameBank = before.bankCode === input.bankCode;
  const sameBranch = sameBank && before.branchCode === input.branchCode;
  return {
    bankCode: input.bankCode,
    bankNameKana: usable(input.bankNameKana) ? input.bankNameKana.trim() : sameBank ? before.bankNameKana : "",
    branchCode: input.branchCode,
    branchNameKana: usable(input.branchNameKana) ? input.branchNameKana.trim() : sameBranch ? before.branchNameKana : "",
    accountType: input.accountType ?? "ordinary",
    accountNumber: padNumber(input.accountNumber),
    holderKana: kanaKey(input.holderKana) === kanaKey(before.holderKana) && before.holderKana ? before.holderKana : input.holderKana.trim(),
  };
}

function diff(before: BankFields, next: BankFields): BankPreviewRow["changes"] {
  const out: BankPreviewRow["changes"] = [];
  const add = (field: BankField, a: string, b: string) => out.push({ field, label: BANK_FIELD_LABEL[field], before: shownValue(field, a), after: shownValue(field, b) });
  if (before.bankCode !== next.bankCode) add("bankCode", before.bankCode, next.bankCode);
  if (normalizeName(before.bankNameKana) !== normalizeName(next.bankNameKana)) add("bankNameKana", before.bankNameKana, next.bankNameKana);
  if (before.branchCode !== next.branchCode) add("branchCode", before.branchCode, next.branchCode);
  if (normalizeName(before.branchNameKana) !== normalizeName(next.branchNameKana)) add("branchNameKana", before.branchNameKana, next.branchNameKana);
  if (before.accountType !== next.accountType) add("accountType", before.accountType, next.accountType);
  if (padNumber(before.accountNumber) !== padNumber(next.accountNumber)) add("accountNumber", before.accountNumber, next.accountNumber);
  if (kanaKey(before.holderKana) !== kanaKey(next.holderKana)) add("holderKana", before.holderKana, next.holderKana);
  return out;
}

/** 見たときの台帳の口座の目印（中身そのものは持たない） */
export function bankSeenKey(b: BankFields): string {
  return [b.bankCode, b.bankNameKana, b.branchCode, b.branchNameKana, b.accountType, padNumber(b.accountNumber), b.holderKana].join("|");
}

/**
 * 読んだ口座を台帳のドライバーに当て、変わるところを出す。
 * assign：画面で「この人の口座」と選んだもの（行の番号 → ドライバー）
 * seenOf：台帳の口座の目印を作る関数（DB 側で会社ごとのハッシュにする）
 */
export function previewBankRows(
  inputs: BankInputRow[],
  drivers: LedgerDriver[],
  assign: Record<string, string>,
  seenOf: (b: BankFields) => string,
): BankPreviewRow[] {
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const codes = new Map<string, LedgerDriver[]>();
  for (const d of drivers) {
    if (!d.code) continue;
    const k = d.code.normalize("NFKC").toLowerCase().replace(/\s/g, "");
    codes.set(k, [...(codes.get(k) ?? []), d]);
  }
  const kanaIndex = new Map<string, Set<string>>();
  const addKana = (k: string, id: string) => {
    if (!k) return;
    kanaIndex.set(k, (kanaIndex.get(k) ?? new Set()).add(id));
  };
  for (const d of drivers) {
    for (const v of [d.holderKana, d.kana, d.name, ...d.aliases]) addKana(kanaKey(v), d.id);
  }
  const candidates = drivers.map((d) => ({ id: d.id, name: d.name, code: d.code, kana: d.kana, aliases: d.aliases }));

  const rows: BankPreviewRow[] = inputs.map((input, index) => {
    let driver: LedgerDriver | null = null;
    let how: BankPreviewRow["how"] = null;
    let ambiguous: { id: string; name: string }[] = [];
    const chosen = assign[String(index)];
    if (chosen && byId.has(chosen)) {
      driver = byId.get(chosen)!;
      how = "chosen";
    }
    if (!driver && input.code) {
      const hit = codes.get(input.code.normalize("NFKC").toLowerCase().replace(/\s/g, ""));
      if (hit?.length === 1) {
        driver = hit[0];
        how = "code";
      }
    }
    if (!driver && input.name) {
      const m = matchName(input.name, candidates);
      if (m && m.how !== "partial") {
        driver = byId.get(m.id) ?? null;
        how = driver ? "name" : null;
      }
    }
    if (!driver) {
      const ids = new Set<string>();
      for (const v of [input.holderKana, input.kana]) for (const id of kanaIndex.get(kanaKey(v)) ?? []) ids.add(id);
      if (ids.size === 1) {
        driver = byId.get([...ids][0]) ?? null;
        how = driver ? "kana" : null;
      } else if (ids.size > 1) {
        ambiguous = [...ids].map((id) => ({ id, name: byId.get(id)?.name ?? "" }));
      }
    }
    const before = driver ? bankOfDriver(driver) : null;
    const base = {
      index,
      input,
      driver: driver ? { id: driver.id, name: driver.name, code: driver.code, active: driver.active } : null,
      how,
      candidates: ambiguous,
      seen: before ? seenOf(before) : "",
    };
    if (input.problems.length) return { ...base, status: "problem" as const, changes: [], next: null };
    if (!driver || !before) return { ...base, status: "unmatched" as const, changes: [], next: null };
    const next = nextFields(input, before);
    const empty = !before.bankCode && !before.branchCode && !before.accountNumber;
    const changes = diff(before, next);
    return { ...base, status: empty ? ("new" as const) : changes.length ? ("changed" as const) : ("same" as const), changes, next };
  });

  // 同じ人に 2 つの口座があれば、2 つめからは入れない（どちらか決めてもらう）
  const firstFor = new Map<string, number>();
  for (const r of rows) {
    if (!r.driver || r.status === "problem" || r.status === "unmatched") continue;
    const first = firstFor.get(r.driver.id);
    if (first === undefined) firstFor.set(r.driver.id, r.index);
    else if (!(r.next && rows[first].next && bankSeenKey(r.next) === bankSeenKey(rows[first].next!))) {
      rows[r.index] = { ...r, status: "duplicate", next: null };
    } else rows[r.index] = { ...r, status: "same", next: null, changes: [] };
  }
  return rows;
}
