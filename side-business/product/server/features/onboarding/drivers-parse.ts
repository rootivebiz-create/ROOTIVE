/**
 * ドライバーの名簿を読む（純関数）。Excel から貼り付けた文字（タブ区切り）か、CSV・Excel のファイルの表を受け取り、
 * 見出しから列を当てて、1 行ずつ「登録できる・すでにいる・直すところがある」を返す。DB に触らない。
 *
 * - 見出しが無いときは、案内に書いた順（氏名・フリガナ・番号・登録番号・銀行コード・支店コード・口座番号・口座名義）で読む
 * - 登録番号の形が違う行は登録しない（明細の消費税の書き方が変わるため、直してから）
 * - 口座の形が違う・足りない行は、口座を入れずにドライバーだけ登録する（あとで設定から入れられる）
 * - 同じ名前・同じ番号の人は、すでにいる人も、貼り付けの中の 2 回目も、登録しない（何度貼り付けても増えない）
 */
import { normalizeName } from "~/server/names";
import { dataRows, isBlankRow, isTotalRow, normalizeHeader, parseCsv, parseDateCell } from "~/server/tabular";
import {
  cleanKana,
  cleanName,
  isBlankLike,
  kanaOrNull,
  kanaProblem,
  nfkc,
  normalizeAccountNumber,
  normalizeAccountType,
  normalizeCode,
  normalizeEmail,
  normalizePhone,
  normalizeRegistrationNo,
} from "./normalize";

export type DriverField =
  | "name"
  | "kana"
  | "code"
  | "registrationNo"
  | "bankCode"
  | "bankName"
  | "branchCode"
  | "branchName"
  | "accountType"
  | "accountNumber"
  | "holderKana"
  | "email"
  | "phone"
  | "startedOn";

/** 列の名前と、見出しの言葉（並びは「より細かいものが先」。同じ強さで当たったときに先のものを選ぶ） */
export const DRIVER_FIELDS: { key: DriverField; label: string; words: string[] }[] = [
  { key: "holderKana", label: "口座名義", words: ["口座名義", "口座名義カナ", "名義カナ", "名義", "名義人", "受取人", "受取人名", "口座名"] },
  { key: "bankCode", label: "銀行コード", words: ["銀行コード", "金融機関コード", "銀行番号", "金融機関番号", "銀行cd", "銀行code"] },
  { key: "branchCode", label: "支店コード", words: ["支店コード", "支店番号", "店番", "店番号", "支店cd", "支店code"] },
  { key: "bankName", label: "銀行名", words: ["銀行名", "金融機関名", "銀行", "金融機関"] },
  { key: "branchName", label: "支店名", words: ["支店名", "支店"] },
  { key: "accountType", label: "預金の種類", words: ["預金種目", "預金種別", "口座種別", "口座種目", "口座の種類", "種目", "種別"] },
  { key: "accountNumber", label: "口座番号", words: ["口座番号", "口座no", "口座"] },
  { key: "registrationNo", label: "登録番号", words: ["登録番号", "インボイス番号", "インボイス登録番号", "適格請求書発行事業者登録番号", "事業者登録番号", "t番号", "インボイス"] },
  { key: "kana", label: "フリガナ", words: ["フリガナ", "ふりがな", "氏名カナ", "氏名フリガナ", "カナ", "かな", "よみ", "読み", "よみがな", "kana"] },
  { key: "email", label: "メール", words: ["メールアドレス", "メール", "mail", "email", "e-mail"] },
  { key: "phone", label: "電話", words: ["電話番号", "携帯番号", "電話", "携帯", "tel", "phone"] },
  { key: "startedOn", label: "委託の開始日", words: ["委託開始日", "契約開始日", "取引開始日", "稼働開始日", "開始日"] },
  // 「No.」だけの列は、たいてい上から 1・2・3 と振った行の番号なので、番号（照合に使う）とは見ない
  {
    key: "code",
    label: "番号",
    words: ["ドライバー番号", "ドライバーコード", "ドライバーno", "ドライバーid", "社内番号", "社員番号", "社員no", "管理番号", "管理no", "委託者番号", "委託者no", "番号", "コード", "code", "id"],
  },
  { key: "name", label: "氏名", words: ["氏名", "名前", "お名前", "ドライバー名", "委託者名", "委託先名", "乗務員名", "ドライバー", "乗務員", "name"] },
];

export const FIELD_LABEL: Record<DriverField, string> = Object.fromEntries(DRIVER_FIELDS.map((f) => [f.key, f.label])) as Record<DriverField, string>;

/** 見出しが無いときの列の順（画面の案内と同じ） */
export const TEMPLATE_ORDER: DriverField[] = ["name", "kana", "code", "registrationNo", "bankCode", "branchCode", "accountNumber", "holderKana"];

/** 見出し 1 つが、どの列か（当たらなければ null） */
export function fieldOfHeader(header: string): DriverField | null {
  const h = normalizeHeader(header);
  if (!h) return null;
  let best: { key: DriverField; score: number } | null = null;
  for (const f of DRIVER_FIELDS) {
    for (const w of f.words) {
      const nw = normalizeHeader(w);
      // まったく同じ見出しは強く、含むだけなら言葉の長さで比べる（「口座番号」は「番号」より強い）
      const score = h === nw ? 100 : nw.length >= 2 && h.includes(nw) ? nw.length : 0;
      if (score > 0 && (!best || score > best.score)) best = { key: f.key, score };
    }
  }
  return best?.key ?? null;
}

export type ColumnInfo = { index: number; header: string; field: DriverField | null; label: string | null };

/**
 * 見出し行を探す（上から 10 行のうち、「氏名」「名前」などの列がある行）。無ければ null。
 * 表の上に「ドライバー名簿」のような題の行があると、それも「氏名の列」に見えてしまうので、
 * 氏名のほかにも列の名前が当たる行を先に選ぶ（氏名の 1 列だけの名簿なら、その行を使う）。
 */
export function findDriverHeader(rows: string[][]): { index: number; columns: ColumnInfo[] } | null {
  const limit = Math.min(rows.length, 10);
  let fallback: number | null = null;
  let chosen: number | null = null;
  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (!row || isBlankRow(row)) continue;
    const fields = row.map((c) => fieldOfHeader(c));
    if (!fields.includes("name")) continue;
    if (new Set(fields.filter(Boolean)).size >= 2) {
      chosen = i;
      break;
    }
    fallback ??= i;
  }
  const index = chosen ?? fallback;
  if (index === null) return null;
  const row = rows[index];
  const fields = row.map((c) => fieldOfHeader(c));
  // 同じ列が 2 つ当たったら、左のものを使う
  const used = new Set<DriverField>();
  const columns = row.map((header, i) => {
    const f = fields[i];
    if (!f || used.has(f)) return { index: i, header, field: null, label: null };
    used.add(f);
    return { index: i, header, field: f, label: FIELD_LABEL[f] };
  });
  return { index, columns };
}

// ---------------------------------------------------------------- 1 行の中身

export type BankDraft = {
  bankCode: string;
  bankNameKana: string | null;
  branchCode: string;
  branchNameKana: string | null;
  accountType: "ordinary" | "checking";
  accountNumber: string;
  holderKana: string;
};

/** 登録する中身（サーバーでもう一度確かめる） */
export type DriverDraft = {
  name: string;
  kana: string | null;
  code: string | null;
  registrationNo: string | null;
  invoiceRegistered: boolean;
  bank: BankDraft | null;
  email: string | null;
  phone: string | null;
  startedOn: string | null;
};

export type RowStatus = "new" | "duplicate" | "error";

export type DriverPreviewRow = {
  /** 元の表の行番号（1 始まり） */
  rowNo: number;
  status: RowStatus;
  name: string;
  draft: DriverDraft | null;
  /** 登録できない理由 */
  errors: string[];
  /** 登録はするが、知っておいてほしいこと（口座を入れなかった など） */
  warnings: string[];
  /** すでにいる人（重なったとき） */
  duplicateOf: string | null;
};

export type DriverPreview = {
  /** 見出しの行（1 始まり）。見出しが無く案内の順で読んだときは null */
  headerRow: number | null;
  columns: ColumnInfo[];
  rows: DriverPreviewRow[];
  counts: Record<RowStatus, number>;
  /** 氏名の列が見つからない など、表全体の問題 */
  problem: string | null;
};

export type ExistingDriver = { id: string; name: string; code: string | null; aliases?: string[] | null };

type Cells = Partial<Record<DriverField, string>>;

/** 1 行の値を確かめて、登録する中身にする（errors があれば登録しない） */
export function draftFromCells(cells: Cells): { draft: DriverDraft | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = cleanName(cells.name);
  if (!name) errors.push("氏名がありません");
  else if (name.length > 60) errors.push("氏名は 60 文字までにしてください");

  const reg = normalizeRegistrationNo(cells.registrationNo);
  if (reg.error) errors.push(`${reg.error}。直してから、もう一度読み込んでください`);

  const kana = isBlankLike(cells.kana) ? null : cleanKana(cells.kana);
  const code = isBlankLike(cells.code) ? null : nfkc(cells.code).slice(0, 30);

  // 口座：4 つ（銀行コード・支店コード・口座番号・名義）がそろって、形が正しいときだけ入れる
  let bank: BankDraft | null = null;
  const anyBank = [cells.bankCode, cells.branchCode, cells.accountNumber, cells.holderKana].some((v) => !isBlankLike(v));
  if (anyBank) {
    const problems: string[] = [];
    const notes: string[] = [];
    const bankCode = normalizeCode(cells.bankCode, 4, "銀行コード");
    const branchCode = normalizeCode(cells.branchCode, 3, "支店コード");
    const account = normalizeAccountNumber(cells.accountNumber);
    const type = normalizeAccountType(cells.accountType);
    const holderRaw = nfkc(cells.holderKana);
    for (const r of [bankCode, branchCode, account]) if (r.error) problems.push(r.error);
    if (type.error) problems.push(type.error);
    const missing = [
      !bankCode.value && !bankCode.error && "銀行コード",
      !branchCode.value && !branchCode.error && "支店コード",
      !account.value && !account.error && "口座番号",
      !holderRaw && "口座名義",
    ].filter(Boolean);
    if (missing.length) problems.push(`口座の${missing.join("・")}がありません`);
    if (holderRaw) {
      const p = kanaProblem(holderRaw, "口座名義");
      if (p) problems.push(p);
    }
    if (bankCode.padded || branchCode.padded) notes.push("銀行・支店のコードの先頭の 0 を補いました（Excel が 0 を落とすことがあるため）");
    if (problems.length) {
      warnings.push(`口座は入れません（${problems.join("。")}）。あとで設定のドライバーから入れられます`);
    } else {
      const bankNameKana = kanaOrNull(cells.bankName);
      const branchNameKana = kanaOrNull(cells.branchName);
      if ((!isBlankLike(cells.bankName) && !bankNameKana) || (!isBlankLike(cells.branchName) && !branchNameKana)) {
        notes.push("銀行名・支店名がカナではないため入れていません（振込は銀行コード・支店コードで届きます）");
      }
      bank = {
        bankCode: bankCode.value!,
        bankNameKana,
        branchCode: branchCode.value!,
        branchNameKana,
        accountType: type.value,
        accountNumber: account.value!,
        holderKana: holderRaw,
      };
      warnings.push(...notes);
    }
  }

  const email = normalizeEmail(cells.email);
  if (email.error) warnings.push(`${email.error}（入れません）`);
  const phone = normalizePhone(cells.phone);
  if (phone.error) warnings.push(`${phone.error}（入れません）`);
  let startedOn: string | null = null;
  if (!isBlankLike(cells.startedOn)) {
    startedOn = parseDateCell(nfkc(cells.startedOn));
    if (!startedOn) warnings.push(`委託の開始日「${nfkc(cells.startedOn)}」が日付として読めません（入れません）`);
  }

  if (errors.length) return { draft: null, errors, warnings };
  return {
    draft: {
      name,
      kana,
      code,
      registrationNo: reg.value,
      invoiceRegistered: reg.value !== null,
      bank,
      email: email.value,
      phone: phone.value,
      startedOn,
    },
    errors,
    warnings,
  };
}

/** 同じ人か（名前は表記ゆれを吸収、番号は全角半角と大文字小文字を無視） */
function nameKey(name: string): string {
  return normalizeName(name);
}
function codeKey(code: string | null | undefined): string | null {
  const v = nfkc(code).toLowerCase();
  return v ? v : null;
}

export function findDuplicate(draft: { name: string; code: string | null }, existing: ExistingDriver[]): ExistingDriver | null {
  const nk = nameKey(draft.name);
  const ck = codeKey(draft.code);
  for (const e of existing) {
    if (nk && [e.name, ...(e.aliases ?? [])].some((n) => nameKey(n) === nk)) return e;
    if (ck && codeKey(e.code) === ck) return e;
  }
  return null;
}

// ---------------------------------------------------------------- 表全体

/** 貼り付けた文字を表にする（タブがあればタブ区切り、無ければカンマ区切り） */
export function rowsFromPaste(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, "");
  const delimiter = t.includes("\t") ? "\t" : ",";
  return parseCsv(t, delimiter);
}

export function parseDriverRows(rows: string[][], existing: ExistingDriver[]): DriverPreview {
  const header = findDriverHeader(rows);
  let columns: ColumnInfo[];
  let body: { rowNo: number; cells: string[] }[];
  let headerRow: number | null;
  if (header) {
    columns = header.columns;
    headerRow = header.index + 1;
    body = dataRows(rows, header.index);
  } else {
    // 見出しらしい行（列の名前が 2 つ以上）なのに氏名が無いときは、決まった順で読まずに知らせる
    const first = rows.find((r) => !isBlankRow(r));
    if (first && first.filter((c) => fieldOfHeader(c)).length >= 2) {
      return {
        headerRow: rows.indexOf(first) + 1,
        columns: [],
        rows: [],
        counts: { new: 0, duplicate: 0, error: 0 },
        problem: "氏名の列が見つかりません。見出しに「氏名」か「名前」の列を足してから、もう一度読み込んでください",
      };
    }
    const width = Math.max(0, ...rows.map((r) => r.length));
    columns = Array.from({ length: width }, (_, index) => {
      const field = TEMPLATE_ORDER[index] ?? null;
      return { index, header: "", field, label: field ? FIELD_LABEL[field] : null };
    });
    headerRow = null;
    body = rows.map((cells, i) => ({ rowNo: i + 1, cells })).filter((r) => !isBlankRow(r.cells) && !isTotalRow(r.cells));
  }
  const empty: DriverPreview = { headerRow, columns, rows: [], counts: { new: 0, duplicate: 0, error: 0 }, problem: null };
  if (!columns.some((c) => c.field === "name")) {
    return { ...empty, problem: "氏名の列が見つかりません。1 行目に「氏名」「フリガナ」などの見出しを入れてから、もう一度読み込んでください" };
  }
  if (body.length === 0) return { ...empty, problem: "読み込める行がありません。見出しの下に 1 人 1 行で入れてください" };

  const known: ExistingDriver[] = [...existing];
  const out: DriverPreviewRow[] = [];
  for (const r of body) {
    const cells: Cells = {};
    for (const c of columns) if (c.field) cells[c.field] = r.cells[c.index] ?? "";
    const { draft, errors, warnings } = draftFromCells(cells);
    const name = cleanName(cells.name);
    if (!draft) {
      out.push({ rowNo: r.rowNo, status: "error", name, draft: null, errors, warnings, duplicateOf: null });
      continue;
    }
    const dup = findDuplicate(draft, known);
    if (dup) {
      const inPaste = !existing.includes(dup);
      out.push({
        rowNo: r.rowNo,
        status: "duplicate",
        name,
        draft,
        errors: [],
        warnings: [inPaste ? `この表の中に、同じ人（${dup.name}）がもう 1 行あります` : `すでに登録されています（${dup.name}${dup.code ? `・${dup.code}` : ""}）`],
        duplicateOf: dup.name,
      });
      continue;
    }
    // 貼り付けの中で 2 回目に出た人も重なりとして数える
    known.push({ id: `row:${r.rowNo}`, name: draft.name, code: draft.code });
    out.push({ rowNo: r.rowNo, status: "new", name, draft, errors: [], warnings, duplicateOf: null });
  }
  const counts = { new: 0, duplicate: 0, error: 0 };
  for (const r of out) counts[r.status]++;
  return { headerRow, columns, rows: out, counts, problem: null };
}
