/**
 * 全銀フォーマット（全国銀行協会 標準通信フォーマット）「総合振込」データの組み立て（純関数のみ・サーバー依存なし）
 *
 * - 1 レコード 120 バイト固定長、改行は CRLF、文字は半角（Shift_JIS / JIS X 0201）のみ
 * - レコードは ヘッダ（1）→ データ（2）×n → トレーラ（8）→ エンド（9） の順
 * - 使える文字：半角カナ・英大文字・数字・空白・`. , ( ) - /`・`¥`（それ以外は空白に落とす）
 * - 金額はすべて税込の振込金額（v_driver_month_summary.payout_incl）を渡す
 */
import { BANK_ACCOUNT_TYPE_CODES, type BankAccountType } from "@/lib/db/types";

/** 1 レコードのバイト数（固定長） */
export const ZENGIN_RECORD_BYTES = 120;
/** 改行（全銀は CRLF） */
export const ZENGIN_EOL = "\r\n";
/** 種別コード（21 ＝ 総合振込） */
export const ZENGIN_KIND_CODE = "21";
/** 振込指定区分（7 ＝ テレ振込） */
export const ZENGIN_TRANSFER_KIND = "7";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** 口座（振込元・振込先で共通） */
export interface ZenginAccount {
  /** 銀行番号（4 桁） */
  bankCode: string;
  /** 銀行名（半角カナ 15 桁） */
  bankName: string;
  /** 支店番号（3 桁） */
  branchCode: string;
  /** 支店名（半角カナ 15 桁） */
  branchName: string;
  /** 預金種目（普通 1・当座 2・貯蓄 4。未設定は普通として出力する） */
  accountType: BankAccountType | null;
  /** 口座番号（1〜7 桁） */
  accountNumber: string;
}

/** データレコード 1 件（＝ドライバー 1 名分の振込） */
export interface ZenginRow extends ZenginAccount {
  /** 受取人名（半角カナ 30 桁） */
  holderKana: string;
  /** 振込金額（円・税込・整数） */
  amount: number;
  /** 顧客コード 1（10 桁。未指定は空白） */
  customerCode?: string;
  /** 警告メッセージに出す名前（ドライバー名）。データには出さない */
  label?: string;
}

export interface ZenginInput {
  /** 委託者コード（銀行から通知される 10 桁） */
  consignorCode: string;
  /** 委託者名（半角カナ 40 桁） */
  consignorKana: string;
  /** 振込元口座（仕向） */
  bank: ZenginAccount;
  /** 取組日（YYYY-MM-DD。レコードには MMDD で入る） */
  transferDate: string;
  rows: ZenginRow[];
}

// ---------------------------------------------------------------------------
// Shift_JIS（JIS X 0201）エンコード
// ---------------------------------------------------------------------------

/**
 * 自前の Shift_JIS エンコーダ。
 * 全銀で使う文字は ASCII（0x20–0x7E）と半角カナ（0xA1–0xDF）だけなので変換表は要らない。
 * `¥`(U+00A5 / U+FFE5) は Shift_JIS の 0x5C に割り当てる。
 * 範囲外の文字は `?` に落とさず、日本語の例外を投げる。
 */
export function encodeShiftJis(s: string): Uint8Array {
  const bytes: number[] = [];
  const bad: string[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x0a || cp === 0x0d) {
      bytes.push(cp); // 改行（CRLF）
    } else if (cp >= 0x20 && cp <= 0x7e) {
      bytes.push(cp); // ASCII
    } else if (cp === 0x00a5 || cp === 0xffe5) {
      bytes.push(0x5c); // ¥
    } else if (cp >= 0xff61 && cp <= 0xff9f) {
      bytes.push(cp - 0xfec0); // 半角カナ（0xA1–0xDF）
    } else if (!bad.includes(ch)) {
      bad.push(ch);
    }
  }
  if (bad.length > 0) {
    throw new Error(`全銀フォーマット（Shift_JIS 半角）に使えない文字が含まれています：${bad.join(" ")}`);
  }
  return Uint8Array.from(bytes);
}

/** Shift_JIS に変換したときのバイト数（レコード長の確認用） */
export function zenginByteLength(s: string): number {
  return encodeShiftJis(s).length;
}

// ---------------------------------------------------------------------------
// 半角カナ変換
// ---------------------------------------------------------------------------

/** 法人格の略号（全銀の慣行。先頭・末尾どちらでも同じ略号に置き換える） */
const COMPANY_SUFFIXES: [RegExp, string][] = [
  [/株式会社|㈱|（株）|\(株\)/g, "ｶ)"],
  [/有限会社|㈲|（有）|\(有\)/g, "ﾕ)"],
  [/合同会社|（合）|\(合\)/g, "ﾄﾞ)"],
];

function zipMap(from: string, to: string[]): Map<string, string> {
  const m = new Map<string, string>();
  [...from].forEach((ch, i) => m.set(ch, to[i]));
  return m;
}

const VOICED = zipMap(
  "ガギグゲゴザジズゼゾダヂヅデドバビブベボヴ",
  [..."ｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾊﾋﾌﾍﾎｳ"].map((c) => `${c}ﾞ`),
);
const HANDAKU = zipMap("パピプペポ", [..."ﾊﾋﾌﾍﾎ"].map((c) => `${c}ﾟ`));
const PLAIN = zipMap(
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン",
  [..."ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ"],
);
/** 小書き文字：全銀は大文字で書くのが原則（ｼｬ → ｼﾔ） */
const SMALL_TO_LARGE = zipMap("ァィゥェォッャュョヮヵヶ", [..."ｱｲｳｴｵﾂﾔﾕﾖﾜｶｹ"]);
/** 小書き文字を残す場合（keepSmallKana） */
const SMALL_KEEP = zipMap("ァィゥェォッャュョヮヵヶ", [..."ｧｨｩｪｫｯｬｭｮﾜｶｹ"]);
/** 半角の小書き文字（ｧ–ｯ）を大文字へ */
const HALF_SMALL_TO_LARGE = zipMap("ｧｨｩｪｫｬｭｮｯ", [..."ｱｲｳｴｵﾔﾕﾖﾂ"]);
/** 記号の置き換え（中黒はピリオド、読点はカンマ） */
const SYMBOLS = new Map<string, string>([
  ["ー", "ｰ"],
  ["・", "."],
  ["･", "."],
  ["。", "."],
  ["｡", "."],
  ["、", ","],
  ["､", ","],
  ["゛", "ﾞ"],
  ["゜", "ﾟ"],
  ["　", " "],
  ["￥", "¥"],
]);

/** 全銀で使える文字（変換後の最終チェック） */
const ALLOWED = /[A-Z0-9 .,()\-/¥ｦ-ﾟ]/;

function convertChar(ch: string, keepSmallKana: boolean): string {
  const cp = ch.codePointAt(0) ?? 0;
  // ひらがな → カタカナ（同じ並びで 0x60 ずれている）
  const kana = cp >= 0x3041 && cp <= 0x3096 ? String.fromCodePoint(cp + 0x60) : ch;
  const small = keepSmallKana ? SMALL_KEEP.get(kana) : SMALL_TO_LARGE.get(kana);
  const converted =
    VOICED.get(kana) ??
    HANDAKU.get(kana) ??
    PLAIN.get(kana) ??
    small ??
    SYMBOLS.get(kana) ??
    (keepSmallKana ? undefined : HALF_SMALL_TO_LARGE.get(kana));
  if (converted != null) return converted;
  // 全角英数記号 → 半角
  const cp2 = kana.codePointAt(0) ?? 0;
  if (cp2 >= 0xff01 && cp2 <= 0xff5e) return String.fromCodePoint(cp2 - 0xfee0);
  return kana;
}

/**
 * 全角カナ・ひらがな・全角英数記号を全銀で使える半角文字へ変換する。
 * - 濁点・半濁点は 2 文字に分解（ガ → ｶﾞ、パ → ﾊﾟ）、長音 ー → ｰ
 * - 株式会社 → `ｶ)`、有限会社 → `ﾕ)`、合同会社 → `ﾄﾞ)`（先頭・末尾どちらでも）
 * - 小書き文字は大文字へ（ｼｬ → ｼﾔ。`keepSmallKana` で残せる）、英小文字は大文字へ
 * - 使えない文字（漢字など）は空白に落とす
 */
export function toHalfWidthKana(s: string, opts: { keepSmallKana?: boolean } = {}): string {
  let src = (s ?? "").normalize("NFC");
  for (const [re, rep] of COMPANY_SUFFIXES) src = src.replace(re, rep);
  let out = "";
  for (const ch of src) out += convertChar(ch, opts.keepSmallKana === true);
  return [...out.toUpperCase()].map((c) => (ALLOWED.test(c) ? c : " ")).join("");
}

// ---------------------------------------------------------------------------
// 桁合わせ
// ---------------------------------------------------------------------------

/** 左詰め・空白埋め（超過分は切り詰め）。すべて 1 バイト文字なので文字数 ＝ バイト数 */
export function padText(s: string, len: number): string {
  return (s ?? "").slice(0, len).padEnd(len, " ");
}

/** 半角カナへ変換してから左詰め・空白埋め（前後の空白と連続空白は詰める） */
export function padKana(s: string, len: number): string {
  return padText(toHalfWidthKana(s ?? "").replace(/ {2,}/g, " ").trim(), len);
}

/** 右詰め・0 埋め（数字以外は落とす）。桁あふれは日本語の例外 */
export function padNum(value: number | string, len: number): string {
  let digits: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("全銀フォーマットに入れられない数値です。");
    if (value < 0) throw new Error(`全銀フォーマットにマイナスの数値は入れられません（${value}）。`);
    digits = String(Math.round(value));
  } else {
    digits = (value ?? "").replace(/[^0-9]/g, "");
  }
  if (digits === "") digits = "0";
  if (digits.length > len) throw new Error(`${len} 桁に収まらない数値です（${digits}）。`);
  return digits.padStart(len, "0");
}

// ---------------------------------------------------------------------------
// レコードの組み立て
// ---------------------------------------------------------------------------

/** 預金種目コード（未設定は普通 1） */
export function accountTypeCode(t: BankAccountType | null | undefined): string {
  return t ? BANK_ACCOUNT_TYPE_CODES[t] : BANK_ACCOUNT_TYPE_CODES.ordinary;
}

/** YYYY-MM-DD → MMDD（取組日） */
export function transferDateMMDD(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "");
  if (!m) throw new Error(`取組日は YYYY-MM-DD の形式で指定してください（${date ?? ""}）。`);
  return `${m[2]}${m[3]}`;
}

/** 120 バイトちょうどかを確かめる（ずれていたら日本語の例外） */
function assertRecordLength(record: string, kind: string): string {
  const bytes = zenginByteLength(record);
  if (bytes !== ZENGIN_RECORD_BYTES) {
    throw new Error(`${kind}の長さが ${ZENGIN_RECORD_BYTES} バイトではありません（${bytes} バイト）。`);
  }
  return record;
}

/** ヘッダレコード（データ区分 1） */
export function buildHeaderRecord(input: ZenginInput): string {
  const record = [
    "1", // データ区分
    ZENGIN_KIND_CODE, // 種別コード（21 ＝ 総合振込）
    "0", // コード区分（0 ＝ JIS）
    padNum(input.consignorCode, 10), // 委託者コード
    padKana(input.consignorKana, 40), // 委託者名
    transferDateMMDD(input.transferDate), // 取組日（MMDD）
    padNum(input.bank.bankCode, 4), // 仕向銀行番号
    padKana(input.bank.bankName, 15), // 仕向銀行名
    padNum(input.bank.branchCode, 3), // 仕向支店番号
    padKana(input.bank.branchName, 15), // 仕向支店名
    accountTypeCode(input.bank.accountType), // 預金種目
    padNum(input.bank.accountNumber, 7), // 口座番号
    padText("", 17), // ダミー
  ].join("");
  return assertRecordLength(record, "ヘッダレコード");
}

/** データレコード（データ区分 2） */
export function buildDataRecord(row: ZenginRow): string {
  const record = [
    "2", // データ区分
    padNum(row.bankCode, 4), // 被仕向銀行番号
    padKana(row.bankName, 15), // 被仕向銀行名
    padNum(row.branchCode, 3), // 被仕向支店番号
    padKana(row.branchName, 15), // 被仕向支店名
    padText("", 4), // 手形交換所番号（空白）
    accountTypeCode(row.accountType), // 預金種目
    padNum(row.accountNumber, 7), // 口座番号
    padKana(row.holderKana, 30), // 受取人名
    padNum(row.amount, 10), // 振込金額
    "0", // 新規コード（0 ＝ その他）
    padText(toHalfWidthKana(row.customerCode ?? ""), 10), // 顧客コード 1
    padText("", 10), // 顧客コード 2
    ZENGIN_TRANSFER_KIND, // 振込指定区分（7 ＝ テレ振込）
    padText("", 1), // 識別表示（空白）
    padText("", 7), // ダミー
  ].join("");
  return assertRecordLength(record, "データレコード");
}

/** 合計件数・合計金額 */
export function zenginTotals(rows: ZenginRow[]): { count: number; amount: number } {
  return {
    count: rows.length,
    amount: rows.reduce((a, r) => a + Math.round(Number(r.amount) || 0), 0),
  };
}

/** トレーラレコード（データ区分 8） */
export function buildTrailerRecord(rows: ZenginRow[]): string {
  const { count, amount } = zenginTotals(rows);
  const record = ["8", padNum(count, 6), padNum(amount, 12), padText("", 101)].join("");
  return assertRecordLength(record, "トレーラレコード");
}

/** エンドレコード（データ区分 9） */
export function buildEndRecord(): string {
  return assertRecordLength(`9${padText("", 119)}`, "エンドレコード");
}

/** 全レコード（ヘッダ → データ → トレーラ → エンド） */
export function buildZenginRecords(input: ZenginInput): string[] {
  return [buildHeaderRecord(input), ...input.rows.map(buildDataRecord), buildTrailerRecord(input.rows), buildEndRecord()];
}

/** 全レコードを CRLF で連結（最終レコードの後にも CRLF を付ける） */
export function buildZenginText(input: ZenginInput): string {
  return buildZenginRecords(input).map((r) => r + ZENGIN_EOL).join("");
}

/** 全銀データの Shift_JIS バイト列 */
export function buildZenginBytes(input: ZenginInput): Uint8Array {
  return encodeShiftJis(buildZenginText(input));
}

// ---------------------------------------------------------------------------
// 検証（日本語の警告）
// ---------------------------------------------------------------------------

const DIGITS_4 = /^\d{4}$/;
const DIGITS_3 = /^\d{3}$/;
const ACCOUNT_NO = /^\d{1,7}$/;

function rowLabel(row: ZenginRow): string {
  return (row.label ?? "").trim() || (row.holderKana ?? "").trim() || "（名称不明）";
}

/** 出力前の確認。振込に失敗しそうな点を日本語の警告で返す（空配列なら問題なし） */
export function validateZengin(input: ZenginInput): string[] {
  const w: string[] = [];
  const code = (input.consignorCode ?? "").trim();
  if (!code) w.push("委託者コードが未設定です。銀行から通知された 10 桁のコードを会社設定に登録してください。");
  else if (!/^\d{1,10}$/.test(code)) w.push(`委託者コードは数字 10 桁で登録してください（現在：${code}）。`);
  if (!toHalfWidthKana(input.consignorKana ?? "").trim()) w.push("委託者名（半角カナ）が未設定です。会社設定に登録してください。");

  const b = input.bank;
  if (!DIGITS_4.test((b?.bankCode ?? "").trim())) w.push("振込元の銀行コードは 4 桁の数字で登録してください。");
  if (!toHalfWidthKana(b?.bankName ?? "").trim()) w.push("振込元の銀行名（カナ）が未設定です。");
  if (!DIGITS_3.test((b?.branchCode ?? "").trim())) w.push("振込元の支店コードは 3 桁の数字で登録してください。");
  if (!toHalfWidthKana(b?.branchName ?? "").trim()) w.push("振込元の支店名（カナ）が未設定です。");
  if (!b?.accountType) w.push("振込元の預金種目が未設定です（普通として出力します）。");
  if (!ACCOUNT_NO.test((b?.accountNumber ?? "").trim())) w.push("振込元の口座番号は 7 桁以内の数字で登録してください。");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.transferDate ?? "")) w.push("取組日は YYYY-MM-DD の形式で指定してください。");

  if (input.rows.length === 0) w.push("振込対象がありません。");

  const seen = new Map<string, string>();
  for (const row of input.rows) {
    const name = rowLabel(row);
    if (!DIGITS_4.test((row.bankCode ?? "").trim())) w.push(`${name}：銀行コードは 4 桁の数字で登録してください。`);
    if (!toHalfWidthKana(row.bankName ?? "").trim()) w.push(`${name}：銀行名（カナ）が未登録です。`);
    if (!DIGITS_3.test((row.branchCode ?? "").trim())) w.push(`${name}：支店コードは 3 桁の数字で登録してください。`);
    if (!toHalfWidthKana(row.branchName ?? "").trim()) w.push(`${name}：支店名（カナ）が未登録です。`);
    if (!row.accountType) w.push(`${name}：預金種目が未登録です（普通として出力します）。`);
    if (!ACCOUNT_NO.test((row.accountNumber ?? "").trim())) w.push(`${name}：口座番号は 7 桁以内の数字で登録してください。`);
    const holder = toHalfWidthKana(row.holderKana ?? "").trim();
    if (!holder) w.push(`${name}：口座名義（半角カナ）が未登録です。`);
    else if (holder.length > 30) w.push(`${name}：口座名義が 30 桁を超えるため切り詰めて出力します。`);
    const amount = Number(row.amount) || 0;
    if (amount <= 0) w.push(`${name}：振込金額が 0 円です。`);
    else if (!Number.isInteger(amount)) w.push(`${name}：振込金額に 1 円未満の端数があります（四捨五入して出力します）。`);
    else if (String(amount).length > 10) w.push(`${name}：振込金額が 10 桁を超えています。`);
    const key = `${(row.bankCode ?? "").trim()}-${(row.branchCode ?? "").trim()}-${(row.accountNumber ?? "").trim()}`;
    const dup = seen.get(key);
    if (dup && ACCOUNT_NO.test((row.accountNumber ?? "").trim())) w.push(`${name}：${dup} と同じ口座です。二重振込にならないか確認してください。`);
    else seen.set(key, name);
  }

  const totals = zenginTotals(input.rows);
  if (String(totals.count).length > 6) w.push("振込件数が 6 桁を超えています。");
  if (String(totals.amount).length > 12) w.push("合計金額が 12 桁を超えています。");
  return w;
}

// ---------------------------------------------------------------------------
// 画面・出力で共用する組み立て（純関数）
// ---------------------------------------------------------------------------

/** ドライバーの口座情報（drivers テーブルの列と同じ形） */
export interface TransferDriverSource {
  driverId: string;
  driverName: string;
  bankCode: string | null;
  bankName: string | null;
  branchCode: string | null;
  branchName: string | null;
  accountType: BankAccountType | null;
  accountNumber: string | null;
  holderKana: string | null;
}

/** 1 名分の振込対象（画面の一覧・CSV・全銀データで共用） */
export interface TransferTarget {
  driverId: string;
  driverName: string;
  /** 税込の振込金額 */
  amount: number;
  /** 振込予定日（YYYY-MM-DD） */
  payoutDate: string;
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: BankAccountType | null;
  accountNumber: string;
  holderKana: string;
  /** 足りない項目（日本語）。空なら全銀データに載せられる */
  missing: string[];
  /** 全銀データに載せられる */
  ready: boolean;
}

/** 口座情報のうち足りない項目（日本語）を返す */
export function missingBankFields(d: Pick<TransferDriverSource, "bankCode" | "bankName" | "branchCode" | "branchName" | "accountType" | "accountNumber" | "holderKana">): string[] {
  const missing: string[] = [];
  if (!DIGITS_4.test((d.bankCode ?? "").trim())) missing.push("銀行コード（4 桁）");
  if (!toHalfWidthKana(d.bankName ?? "").trim()) missing.push("銀行名");
  if (!DIGITS_3.test((d.branchCode ?? "").trim())) missing.push("支店コード（3 桁）");
  if (!toHalfWidthKana(d.branchName ?? "").trim()) missing.push("支店名");
  if (!d.accountType) missing.push("預金種目");
  if (!ACCOUNT_NO.test((d.accountNumber ?? "").trim())) missing.push("口座番号（7 桁以内）");
  if (!toHalfWidthKana(d.holderKana ?? "").trim()) missing.push("口座名義（カナ）");
  return missing;
}

/** ドライバー ＋ 金額 ＋ 振込予定日 → 振込対象 */
export function toTransferTarget(driver: TransferDriverSource, amount: number, payoutDate: string): TransferTarget {
  const missing = missingBankFields(driver);
  return {
    driverId: driver.driverId,
    driverName: driver.driverName,
    amount: Math.round(Number(amount) || 0),
    payoutDate,
    bankCode: (driver.bankCode ?? "").trim(),
    bankName: (driver.bankName ?? "").trim(),
    branchCode: (driver.branchCode ?? "").trim(),
    branchName: (driver.branchName ?? "").trim(),
    accountType: driver.accountType ?? null,
    accountNumber: (driver.accountNumber ?? "").trim(),
    holderKana: (driver.holderKana ?? "").trim(),
    missing,
    ready: missing.length === 0,
  };
}

/** 全銀データに載せる行（口座情報がそろっていて金額が 1 円以上のもの） */
export function transferRows(targets: TransferTarget[]): ZenginRow[] {
  return targets
    .filter((t) => t.ready && t.amount > 0)
    .map((t) => ({
      bankCode: t.bankCode,
      bankName: t.bankName,
      branchCode: t.branchCode,
      branchName: t.branchName,
      accountType: t.accountType,
      accountNumber: t.accountNumber,
      holderKana: t.holderKana,
      amount: t.amount,
      label: t.driverName,
    }));
}

/** 振込予定日の候補（重複を除いて日付順） */
export function transferDateOptions(targets: Pick<TransferTarget, "payoutDate">[]): string[] {
  return [...new Set(targets.map((t) => t.payoutDate).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
}

/** 取組日：?d= の指定があればそれ、無ければ一番多い振込予定日（同数なら早い日） */
export function pickTransferDate(targets: Pick<TransferTarget, "payoutDate">[], requested?: string | null): string {
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) return requested;
  const count = new Map<string, number>();
  for (const d of transferDateOptions(targets)) count.set(d, 0);
  for (const t of targets) if (count.has(t.payoutDate)) count.set(t.payoutDate, (count.get(t.payoutDate) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [date, n] of count) {
    if (n > bestCount) {
      best = date;
      bestCount = n;
    }
  }
  return best;
}

/** 振込データのファイル名 */
export function transferFileName(month: string, ext: "txt" | "csv"): string {
  return ext === "txt" ? `振込データ_${month}.txt` : `振込一覧_${month}.csv`;
}
