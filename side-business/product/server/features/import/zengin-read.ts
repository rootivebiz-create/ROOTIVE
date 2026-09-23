/**
 * 全銀の総合振込ファイル（120 バイトの固定長・Shift_JIS）を読む（純関数。DB に触らない）。
 * 先月の振込ファイルから、ドライバーの口座（銀行・支店・種目・口座番号・名義カナ）を取り出すために使う。
 * 形：ヘッダー（1）→ データ（2）→ トレーラー（8）→ エンド（9）。改行があってもなくても読む。
 * 作る側は @/lib/payroll/zengin の buildZenginRecords（往復のテストあり）。
 */
import type { AccountType } from "@/lib/payroll/types";

export type ZenginRecord = {
  /** ファイルの中の何件目のレコードか（1 始まり） */
  recordNo: number;
  bankCode: string;
  bankNameKana: string;
  branchCode: string;
  branchNameKana: string;
  /** 1＝普通・2＝当座。それ以外（4＝貯蓄 など）は null */
  accountType: AccountType | null;
  accountTypeCode: string;
  accountNumber: string;
  holderKana: string;
  amount: number;
  customerCode: string;
};

export type ZenginFile = {
  /** 種別コード（21＝総合振込・11＝給与・12＝賞与） */
  typeCode: string;
  kindLabel: string;
  requesterName: string;
  /** 振込指定日（MMDD） */
  transferDate: string;
  records: ZenginRecord[];
  trailer: { count: number; total: number } | null;
  /** 読めたけれど気になること（件数・合計が合わない など） */
  problems: string[];
};

const RECORD = 120;
const KIND: Record<string, string> = { "21": "総合振込", "11": "給与振込", "12": "賞与振込" };

/** 全銀の振込ファイルらしいか（1 行目がヘッダー（1＋種別コード）で、長さが 120 バイトの区切り） */
export function looksLikeZengin(bytes: Uint8Array): boolean {
  if (bytes.length < RECORD * 2) return false;
  if (bytes[0] !== 0x31 || !isDigit(bytes[1]) || !isDigit(bytes[2])) return false;
  const nl = bytes.indexOf(0x0a);
  const cr = bytes.indexOf(0x0d);
  const firstEnd = [nl, cr].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (firstEnd === undefined) return trimEof(bytes).length % RECORD === 0;
  return firstEnd === RECORD;
}

function isDigit(b: number | undefined): boolean {
  return b !== undefined && b >= 0x30 && b <= 0x39;
}

/** 末尾の EOF（0x1A）を落とす */
function trimEof(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x1a || bytes[end - 1] === 0x00)) end--;
  return bytes.subarray(0, end);
}

/** 120 バイトずつのレコードに分ける（改行があれば改行で、無ければ 120 バイトごと） */
export function splitRecords(bytes: Uint8Array): { records: Uint8Array[]; problems: string[] } {
  const data = trimEof(bytes);
  const problems: string[] = [];
  const out: Uint8Array[] = [];
  const hasNewline = data.includes(0x0a) || data.includes(0x0d);
  if (hasNewline) {
    let start = 0;
    for (let i = 0; i <= data.length; i++) {
      if (i === data.length || data[i] === 0x0a || data[i] === 0x0d) {
        if (i > start) out.push(data.subarray(start, i));
        start = i + 1;
      }
    }
  } else {
    if (data.length % RECORD !== 0) problems.push(`ファイルの長さ（${data.length} バイト）が 120 バイトの倍数ではありません。途中で切れていないか確かめてください`);
    for (let i = 0; i + RECORD <= data.length; i += RECORD) out.push(data.subarray(i, i + RECORD));
  }
  return { records: out, problems };
}

const decoder = new TextDecoder("shift_jis");

function field(rec: Uint8Array, start: number, length: number): string {
  return decoder.decode(rec.subarray(start, start + length));
}

function digits(rec: Uint8Array, start: number, length: number): string {
  return field(rec, start, length).trim();
}

/** 全銀の振込ファイルを読む。読めない形なら problems に理由を入れ、records は読めた分だけ */
export function parseZengin(bytes: Uint8Array): ZenginFile {
  const { records, problems } = splitRecords(bytes);
  const out: ZenginFile = { typeCode: "", kindLabel: "", requesterName: "", transferDate: "", records: [], trailer: null, problems };
  let dataNo = 0;
  records.forEach((rec, i) => {
    const lineNo = i + 1;
    if (rec.length !== RECORD) {
      problems.push(`${lineNo} 行目の長さが ${rec.length} バイトです（120 バイトのはずです）。この行は読みません`);
      return;
    }
    const type = String.fromCharCode(rec[0]);
    if (type === "1") {
      out.typeCode = digits(rec, 1, 2);
      out.kindLabel = KIND[out.typeCode] ?? `種別 ${out.typeCode}`;
      out.requesterName = field(rec, 14, 40).trim();
      out.transferDate = digits(rec, 54, 4);
      return;
    }
    if (type === "2") {
      dataNo++;
      const accountTypeCode = digits(rec, 42, 1);
      const amountText = digits(rec, 80, 10);
      const amount = /^\d+$/.test(amountText) ? Number(amountText) : 0;
      if (!/^\d+$/.test(amountText)) problems.push(`${dataNo} 件目の金額が読めません`);
      out.records.push({
        recordNo: dataNo,
        bankCode: digits(rec, 1, 4),
        bankNameKana: field(rec, 5, 15).trim(),
        branchCode: digits(rec, 20, 3),
        branchNameKana: field(rec, 23, 15).trim(),
        accountType: accountTypeCode === "1" ? "ordinary" : accountTypeCode === "2" ? "checking" : null,
        accountTypeCode,
        accountNumber: digits(rec, 43, 7),
        holderKana: field(rec, 50, 30).trim(),
        amount,
        customerCode: field(rec, 91, 10).trim(),
      });
      return;
    }
    if (type === "8") {
      const count = digits(rec, 1, 6);
      const total = digits(rec, 7, 12);
      out.trailer = { count: /^\d+$/.test(count) ? Number(count) : 0, total: /^\d+$/.test(total) ? Number(total) : 0 };
      return;
    }
    if (type === "9") return;
    problems.push(`${lineNo} 行目の種類（先頭の「${type}」）が分かりません。この行は読みません`);
  });
  if (!out.typeCode) problems.push("ヘッダー（先頭が 1 の行）がありません");
  if (out.trailer) {
    const total = out.records.reduce((a, r) => a + r.amount, 0);
    if (out.trailer.count !== out.records.length) problems.push(`トレーラーの件数（${out.trailer.count}件）と、読んだ件数（${out.records.length}件）が合いません`);
    if (out.trailer.total !== total) problems.push(`トレーラーの合計（${out.trailer.total.toLocaleString("ja-JP")}円）と、読んだ金額の合計（${total.toLocaleString("ja-JP")}円）が合いません`);
  } else if (out.records.length > 0) {
    problems.push("トレーラー（先頭が 8 の行）がありません。途中で切れていないか確かめてください");
  }
  return out;
}
