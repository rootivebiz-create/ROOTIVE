/**
 * 全銀協の固定長 120 桁の総合振込データ（種別コード 21）を作る。
 * すべて半角（英数字・半角カナ）なので、Shift_JIS の 1 バイト文字だけで表せる。
 * 銀行ごとの細かい違い（最終行の改行の有無・EOF など）は導入時に合わせる前提。
 */
import type { AccountType } from "./types";

const FULL_KATA = "ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ";

const HALF: Record<string, string> = (() => {
  const base: [string, string][] = [
    ["ア", "ｱ"], ["イ", "ｲ"], ["ウ", "ｳ"], ["エ", "ｴ"], ["オ", "ｵ"],
    ["カ", "ｶ"], ["キ", "ｷ"], ["ク", "ｸ"], ["ケ", "ｹ"], ["コ", "ｺ"],
    ["サ", "ｻ"], ["シ", "ｼ"], ["ス", "ｽ"], ["セ", "ｾ"], ["ソ", "ｿ"],
    ["タ", "ﾀ"], ["チ", "ﾁ"], ["ツ", "ﾂ"], ["テ", "ﾃ"], ["ト", "ﾄ"],
    ["ナ", "ﾅ"], ["ニ", "ﾆ"], ["ヌ", "ﾇ"], ["ネ", "ﾈ"], ["ノ", "ﾉ"],
    ["ハ", "ﾊ"], ["ヒ", "ﾋ"], ["フ", "ﾌ"], ["ヘ", "ﾍ"], ["ホ", "ﾎ"],
    ["マ", "ﾏ"], ["ミ", "ﾐ"], ["ム", "ﾑ"], ["メ", "ﾒ"], ["モ", "ﾓ"],
    ["ヤ", "ﾔ"], ["ユ", "ﾕ"], ["ヨ", "ﾖ"],
    ["ラ", "ﾗ"], ["リ", "ﾘ"], ["ル", "ﾙ"], ["レ", "ﾚ"], ["ロ", "ﾛ"],
    ["ワ", "ﾜ"], ["ヲ", "ｦ"], ["ン", "ﾝ"],
    // 振込データでは小さい文字を使えないので大きい文字にする
    ["ァ", "ｱ"], ["ィ", "ｲ"], ["ゥ", "ｳ"], ["ェ", "ｴ"], ["ォ", "ｵ"],
    ["ッ", "ﾂ"], ["ャ", "ﾔ"], ["ュ", "ﾕ"], ["ョ", "ﾖ"], ["ヮ", "ﾜ"], ["ヵ", "ｶ"], ["ヶ", "ｹ"],
    ["ヰ", "ｲ"], ["ヱ", "ｴ"],
  ];
  const m: Record<string, string> = Object.fromEntries(base);
  const dakuten = "ガギグゲゴザジズゼゾダヂヅデドバビブベボ";
  const plain = "カキクケコサシスセソタチツテトハヒフヘホ";
  [...dakuten].forEach((c, i) => (m[c] = m[plain[i]] + "ﾞ"));
  const handakuten = "パピプペポ";
  [..."ハヒフヘホ"].forEach((c, i) => (m[handakuten[i]] = m[c] + "ﾟ"));
  m["ヴ"] = "ｳﾞ";
  return m;
})();

/** 半角カナの小さい文字 → 大きい文字 */
const SMALL_HALF: Record<string, string> = { ｧ: "ｱ", ｨ: "ｲ", ｩ: "ｳ", ｪ: "ｴ", ｫ: "ｵ", ｯ: "ﾂ", ｬ: "ﾔ", ｭ: "ﾕ", ｮ: "ﾖ" };

/** 振込データに使える文字（英大文字・数字・半角カナ・濁点・半濁点・スペース・一部の記号） */
const ALLOWED = /^[0-9A-Zｦ-ﾝﾞﾟ ().,\-/\\｢｣]$/;

/**
 * 口座名義などを振込データ用の半角に直す。ひらがな → カタカナ → 半角、英小文字 → 大文字、
 * 長音「ー」→「-」、小さい文字 → 大きい文字、全角スペース → 半角。使えない文字は invalid に入れて返す。
 */
export function toZenginKana(input: string): { value: string; invalid: string[] } {
  let out = "";
  const invalid: string[] = [];
  for (const raw of input.normalize("NFKC").normalize("NFC")) {
    let ch = raw;
    const code = ch.charCodeAt(0);
    if (code >= 0x3041 && code <= 0x3096) ch = String.fromCharCode(code + 0x60);
    if (FULL_KATA.includes(ch) && HALF[ch]) {
      out += HALF[ch];
      continue;
    }
    if (ch === "ー" || ch === "‐" || ch === "−" || ch === "―" || ch === "ｰ") ch = "-";
    if (ch === "　") ch = " ";
    if (ch === "・") ch = ".";
    if (/[a-z]/.test(ch)) ch = ch.toUpperCase();
    if (SMALL_HALF[ch]) ch = SMALL_HALF[ch];
    if (ALLOWED.test(ch)) out += ch;
    else invalid.push(raw);
  }
  return { value: out.replace(/ {2,}/g, " ").trim(), invalid };
}

function kanaField(text: string, length: number): string {
  const { value } = toZenginKana(text);
  return value.slice(0, length).padEnd(length, " ");
}

function numField(value: string | number, length: number): string {
  const s = String(value).replace(/\D/g, "");
  if (s.length > length) throw new Error(`桁数が多すぎます（${length} 桁まで）: ${value}`);
  return s.padStart(length, "0");
}

const accountTypeCode = (t: AccountType) => (t === "checking" ? "2" : "1");

export type Requester = {
  /** 振込依頼人コード（銀行から通知される 10 桁） */
  code: string;
  nameKana: string;
  bankCode: string;
  bankNameKana: string;
  branchCode: string;
  branchNameKana: string;
  accountType: AccountType;
  accountNumber: string;
};

export type Transfer = {
  bankCode: string;
  bankNameKana: string;
  branchCode: string;
  branchNameKana: string;
  accountType: AccountType;
  accountNumber: string;
  holderKana: string;
  amount: number;
  /** 顧客コード（任意。ドライバーの番号など） */
  customerCode?: string;
};

export type ZenginIssue = { index: number; message: string };

/** 振込先の入力を確かめる（index は transfers の位置。依頼人は -1） */
export function validateTransfers(requester: Requester, transfers: Transfer[]): ZenginIssue[] {
  const issues: ZenginIssue[] = [];
  const check = (index: number, a: { bankCode: string; branchCode: string; accountNumber: string }) => {
    if (!/^\d{4}$/.test(a.bankCode)) issues.push({ index, message: "金融機関コードは 4 桁の数字です" });
    if (!/^\d{3}$/.test(a.branchCode)) issues.push({ index, message: "支店コードは 3 桁の数字です" });
    if (!/^\d{1,7}$/.test(a.accountNumber)) issues.push({ index, message: "口座番号は 7 桁までの数字です" });
  };
  if (!/^\d{10}$/.test(requester.code)) issues.push({ index: -1, message: "振込依頼人コードは 10 桁の数字です" });
  check(-1, requester);
  transfers.forEach((t, i) => {
    check(i, t);
    if (!Number.isInteger(t.amount) || t.amount <= 0) issues.push({ index: i, message: "振込金額は 1 円以上の整数です" });
    if (t.amount > 9_999_999_999) issues.push({ index: i, message: "振込金額が大きすぎます" });
    const holder = toZenginKana(t.holderKana);
    if (!holder.value) issues.push({ index: i, message: "口座名義（カナ）がありません" });
    if (holder.invalid.length) issues.push({ index: i, message: `口座名義に使えない文字があります：${holder.invalid.join("")}` });
  });
  return issues;
}

/** 120 桁のレコードを並べた行の配列を返す。transferDate は MMDD */
export function buildZenginRecords(requester: Requester, transferDate: string, transfers: Transfer[]): string[] {
  const issues = validateTransfers(requester, transfers);
  if (issues.length) throw new Error(issues.map((i) => i.message).join(" / "));
  if (!/^\d{4}$/.test(transferDate)) throw new Error("振込日は MMDD の 4 桁です");

  const header =
    "1" + "21" + "0" +
    numField(requester.code, 10) +
    kanaField(requester.nameKana, 40) +
    transferDate +
    numField(requester.bankCode, 4) +
    kanaField(requester.bankNameKana, 15) +
    numField(requester.branchCode, 3) +
    kanaField(requester.branchNameKana, 15) +
    accountTypeCode(requester.accountType) +
    numField(requester.accountNumber, 7) +
    " ".repeat(17);

  const data = transfers.map(
    (t) =>
      "2" +
      numField(t.bankCode, 4) +
      kanaField(t.bankNameKana, 15) +
      numField(t.branchCode, 3) +
      kanaField(t.branchNameKana, 15) +
      " ".repeat(4) +
      accountTypeCode(t.accountType) +
      numField(t.accountNumber, 7) +
      kanaField(t.holderKana, 30) +
      numField(t.amount, 10) +
      "0" +
      kanaField(t.customerCode ?? "", 10) +
      " ".repeat(10) +
      " " +
      " " +
      " ".repeat(7),
  );

  const total = transfers.reduce((a, t) => a + t.amount, 0);
  const trailer = "8" + numField(transfers.length, 6) + numField(total, 12) + " ".repeat(101);
  const end = "9" + " ".repeat(119);
  return [header, ...data, trailer, end];
}

/** 半角文字だけの文字列を Shift_JIS のバイト列にする（半角カナ U+FF61–FF9F → 0xA1–0xDF） */
export function toShiftJisBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7e) out[i] = c === 0x5c ? 0x5c : c;
    else if (c >= 0xff61 && c <= 0xff9f) out[i] = c - 0xff61 + 0xa1;
    else if (c === 0x0d || c === 0x0a) out[i] = c;
    else throw new Error(`Shift_JIS の 1 バイトで表せない文字があります: ${text[i]}`);
  }
  return out;
}

/** レコードを CRLF でつないだバイト列（最後の行にも改行を付ける） */
export function zenginBytes(records: string[]): Uint8Array {
  return toShiftJisBytes(records.map((r) => r + "\r\n").join(""));
}
