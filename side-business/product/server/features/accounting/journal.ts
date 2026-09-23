/**
 * 会計ソフト向けの仕訳（純関数。DB に触らない）。
 * 明細の形（StatementDraft）から、ドライバーごとに 1 枚の伝票（複数行の仕訳）を作り、各ソフトの取り込みの形に並べる。
 *
 * 伝票の中身（1 行ずつ、借方と貸方が同じ額になるように組む）：
 *   委託料       借方 外注費         ／ 貸方 未払金
 *   控除         借方 未払金         ／ 貸方 売上高（消費税のかかるもの）・立替金など（かからないもの）
 *   調整（＋）   借方 立替金など     ／ 貸方 未払金
 *   調整（−）   借方 未払金         ／ 貸方 雑収入など
 *   源泉徴収     借方 未払金         ／ 貸方 預り金
 * 未払金の残り（貸方 − 借方）は、必ず明細の振込額と同じになる。合わなければ作らない（例外を投げる）。
 *
 * 消費税の書き方：
 *   inclusive（弥生会計・マネーフォワード）… 金額は税込、そのうちの消費税の額を「税金額」「税額」の列に入れる
 *   separate（汎用 CSV）… 金額は税抜、消費税は「仮払消費税等」「仮受消費税等」の別の行にする
 * 勘定科目と税区分は会社ごとに変えられる（既定の値は「要確認」として見せる）。
 */
import type { StatementDraft } from "~/server/calc/statement";
import { jpMonth } from "@/lib/format";

// ---------------------------------------------------------------- ソフト

export type SoftwareKey = "yayoi" | "freee" | "mf" | "generic";
export type FormatKey = "yayoi" | "mf" | "generic";
export type ExportKind = SoftwareKey | "payments";

export const SOFTWARE_KEYS: SoftwareKey[] = ["yayoi", "freee", "mf", "generic"];
export const EXPORT_KINDS: ExportKind[] = [...SOFTWARE_KEYS, "payments"];

export type SoftwareInfo = {
  key: SoftwareKey;
  label: string;
  short: string;
  format: FormatKey;
  taxMode: "inclusive" | "separate";
  encoding: "sjis" | "utf8bom";
  /** 画面に出す説明（ファイルの形と、取り込み方） */
  about: string[];
};

export const SOFTWARE: Record<SoftwareKey, SoftwareInfo> = {
  yayoi: {
    key: "yayoi",
    label: "弥生会計（インポート形式）",
    short: "弥生会計",
    format: "yayoi",
    taxMode: "inclusive",
    encoding: "sjis",
    about: [
      "弥生会計の「仕訳データのインポート」で読み込む形（見出しの行なし・1 行 25 項目・Shift_JIS）です。",
      "ドライバー 1 人を 1 枚の伝票（複数行の仕訳）にしています。",
      "金額は税込で、そのうちの消費税の額を「税金額」の列に入れています。",
    ],
  },
  freee: {
    key: "freee",
    label: "freee（仕訳）",
    short: "freee",
    format: "yayoi",
    taxMode: "inclusive",
    encoding: "sjis",
    about: [
      "freee には、弥生会計の形式の仕訳を取り込む機能があります。そのため freee を選んだときも、弥生会計のインポート形式と同じファイルを出します（freee 専用の形ではありません）。",
      "取り込むときは、freee の画面で「弥生会計」の形式を選んでください。税区分の名前は、弥生会計の名前で書いています。",
    ],
  },
  mf: {
    key: "mf",
    label: "マネーフォワード（仕訳帳）",
    short: "マネーフォワード",
    format: "mf",
    taxMode: "inclusive",
    encoding: "utf8bom",
    about: [
      "マネーフォワード クラウド会計の「仕訳帳」の列の並び（見出しの行あり・UTF-8）で出します。",
      "同じ「取引No」の行が 1 つの仕訳です。金額は税込で、そのうちの消費税の額を「税額」の列に入れています。",
      "マネーフォワードでも、弥生会計の形式の仕訳を取り込めます。こちらの形で読めないときは「弥生会計」を選んで出したファイルもお試しください。",
    ],
  },
  generic: {
    key: "generic",
    label: "汎用 CSV",
    short: "汎用 CSV",
    format: "generic",
    taxMode: "separate",
    encoding: "utf8bom",
    about: [
      "ほかの会計ソフトや、税理士さんに渡すための CSV（見出しの行あり・UTF-8）です。",
      "金額は税抜で、消費税は「仮払消費税等」「仮受消費税等」の別の行にしています。",
    ],
  },
};

export function parseSoftware(value: string | string[] | undefined | null): SoftwareKey | null {
  const v = Array.isArray(value) ? value[0] : value;
  return SOFTWARE_KEYS.includes(v as SoftwareKey) ? (v as SoftwareKey) : null;
}

export function parseExportKind(value: string | undefined | null): ExportKind | null {
  return EXPORT_KINDS.includes(value as ExportKind) ? (value as ExportKind) : null;
}

// ---------------------------------------------------------------- 勘定科目

export type AccountKey =
  | "outsourcing"
  | "payable"
  | "inputTax"
  | "outputTax"
  | "deductionTaxable"
  | "deductionOther"
  | "adjustmentPlus"
  | "adjustmentMinus"
  | "adjustmentPlusTaxable"
  | "adjustmentMinusTaxable"
  | "withholding";

export type AccountField = {
  key: AccountKey;
  label: string;
  help: string;
  default: string;
  /** この形のときだけ使う（無ければどの形でも使う） */
  formats?: FormatKey[];
  /** あまり使わない（画面では「そのほか」にまとめる） */
  rare?: boolean;
};

export const ACCOUNT_FIELDS: AccountField[] = [
  { key: "outsourcing", label: "委託料（ドライバーへの支払）", help: "借方。明細の委託料です。", default: "外注費" },
  { key: "payable", label: "振込までの支払の残り", help: "貸方。ここに残る額が、明細の振込額と同じになります。", default: "未払金" },
  { key: "inputTax", label: "委託料の消費税", help: "借方。汎用 CSV だけ、消費税を別の行にします。", default: "仮払消費税等", formats: ["generic"] },
  { key: "outputTax", label: "控除の消費税", help: "貸方。汎用 CSV だけ、消費税を別の行にします。", default: "仮受消費税等", formats: ["generic"] },
  { key: "deductionTaxable", label: "控除のうち消費税のかかるもの", help: "貸方。ロイヤリティ・管理費・リースなど、会社の売上になるもの。", default: "売上高" },
  { key: "deductionOther", label: "控除のうち消費税のかからないもの", help: "貸方。立替の精算など。", default: "立替金" },
  { key: "adjustmentPlus", label: "調整で支払を増やすもの", help: "借方。駐車場代などの立替の精算。", default: "立替金" },
  { key: "adjustmentMinus", label: "調整で支払を減らすもの", help: "貸方。修理代のドライバーの負担分など。", default: "雑収入" },
  { key: "withholding", label: "源泉徴収した所得税", help: "貸方。源泉徴収の対象の方だけ。", default: "預り金" },
  { key: "adjustmentPlusTaxable", label: "消費税のかかる調整（増やすもの）", help: "借方。消費税の対象にした調整の合計。", default: "外注費", rare: true },
  { key: "adjustmentMinusTaxable", label: "消費税のかかる調整（減らすもの）", help: "貸方。消費税の対象にした調整の合計。", default: "雑収入", rare: true },
];

export const ACCOUNT_KEYS = ACCOUNT_FIELDS.map((f) => f.key);

/** 未払金の補助科目にドライバーの名前を入れるか（accounts の中に "driver" として覚える） */
export const PAYABLE_SUB_KEY = "payableSub";

export function accountFieldsFor(format: FormatKey): AccountField[] {
  return ACCOUNT_FIELDS.filter((f) => !f.formats || f.formats.includes(format));
}

// ---------------------------------------------------------------- 税区分

export type TaxField = { key: string; label: string; help: string; default: string };

/** 控除できる割合（0.7）→ 70 */
export function ratePercent(deductibleRate: number): number {
  return Math.round(deductibleRate * 100);
}

function defaultTaxLabel(format: FormatKey, key: string): string {
  const exempt = /^exempt(\d+)$/.exec(key);
  const invoiceExempt = /^invoiceExempt(\d+)$/.exec(key);
  if (format === "yayoi") {
    if (key === "purchase") return "課対仕入込10%";
    if (key === "sales") return "課税売上込10%";
    if (key === "none") return "対象外";
    if (exempt) return Number(exempt[1]) === 0 ? "対象外" : `課対仕入込10%区分${exempt[1]}%`;
  }
  if (format === "mf") {
    if (key === "purchase") return "課税仕入 10%";
    if (key === "sales") return "課税売上 10%";
    if (key === "none") return "対象外";
    if (exempt) return Number(exempt[1]) === 0 ? "対象外" : "課税仕入 10%";
    if (key === "invoice") return "適格";
    if (invoiceExempt) return Number(invoiceExempt[1]) === 0 ? "" : `${invoiceExempt[1]}%控除`;
  }
  if (format === "generic") {
    if (key === "purchase") return "課税仕入10%";
    if (key === "sales") return "課税売上10%";
    if (key === "none") return "対象外";
    if (exempt) return Number(exempt[1]) === 0 ? "対象外" : `課税仕入10%（経過措置${exempt[1]}%）`;
  }
  return "";
}

/** その形・その月の割合で使う税区分の欄（画面の入力欄の並び） */
export function taxFieldsFor(format: FormatKey, deductibleRate: number): TaxField[] {
  const r = ratePercent(deductibleRate);
  const fields: TaxField[] = [
    { key: "purchase", label: "登録のある方への委託料", help: "インボイスの登録番号がある方への支払（仕入明細書）。", default: "" },
  ];
  if (r < 100) {
    fields.push({
      key: `exempt${r}`,
      label: `登録の無い方への委託料（経過措置 ${r}%）`,
      help: `この月は、仕入税額相当額の ${r}% を控除できる期間です。期間が変わると、ここが新しい欄になります。`,
      default: "",
    });
  }
  fields.push(
    { key: "sales", label: "消費税のかかる控除（会社の売上）", help: "ロイヤリティ・管理費・リースなど。", default: "" },
    { key: "none", label: "消費税の対象外", help: "未払金・預り金・立替金など。", default: "" },
  );
  if (format === "mf") {
    fields.push({ key: "invoice", label: "「インボイス」の欄（登録のある方）", help: "マネーフォワードの仕訳帳の「インボイス」の列に入れる文字。", default: "" });
    if (r < 100) {
      fields.push({
        key: `invoiceExempt${r}`,
        label: `「インボイス」の欄（登録の無い方・経過措置 ${r}%）`,
        help: "空にすると、この列は空けて出します。",
        default: "",
      });
    }
  }
  return fields.map((f) => ({ ...f, default: defaultTaxLabel(format, f.key) }));
}

// ---------------------------------------------------------------- 会社の設定（tenants.settings.accounting）

export type RawAccounting = {
  software?: SoftwareKey;
  accounts?: Record<string, string>;
  taxLabels?: Record<string, string>;
};

export type Mapping = {
  format: FormatKey;
  accounts: Record<AccountKey, string>;
  /** 税区分（無い鍵は既定の値） */
  tax: (key: string) => string;
  payableSubByDriver: boolean;
};

/** 保存した税区分の鍵（形ごとに分けて覚える） */
export function taxStoreKey(format: FormatKey, key: string): string {
  return `${format}.${key}`;
}

export function resolveMapping(raw: RawAccounting | undefined | null, format: FormatKey): Mapping {
  const saved = raw?.accounts ?? {};
  const accounts = Object.fromEntries(ACCOUNT_FIELDS.map((f) => [f.key, saved[f.key]?.trim() || f.default])) as Record<AccountKey, string>;
  const labels = raw?.taxLabels ?? {};
  return {
    format,
    accounts,
    tax: (key) => {
      const v = labels[taxStoreKey(format, key)];
      return v !== undefined ? v.trim() : defaultTaxLabel(format, key);
    },
    payableSubByDriver: saved[PAYABLE_SUB_KEY] === "driver",
  };
}

/** 入力の文字を確かめる（会計ソフトの科目名として使える長さ・文字か）。問題があれば日本語の理由を返す */
export function labelProblem(value: string): string | null {
  if (value.length > 40) return "40 文字までにしてください";
  if (/[\u0000-\u001f\u007f]/.test(value)) return "改行やタブは入れられません";
  return null;
}

// ---------------------------------------------------------------- 仕訳

export type Side = {
  role: AccountKey;
  account: string;
  sub: string;
  taxLabel: string;
  /** マネーフォワードの「インボイス」の列 */
  invoice: string;
  /** 税額（null は空欄） */
  tax: number | null;
};

export type JournalRow = { debit: Side; credit: Side; amount: number; memo: string };

export type Slip = {
  no: number;
  /** 取引日（その月の末日。YYYY-MM-DD） */
  date: string;
  driverId: string;
  driverName: string;
  rows: JournalRow[];
  debitTotal: number;
  creditTotal: number;
  /** 未払金の残り（貸方 − 借方） */
  payableNet: number;
  /** 明細の振込額 */
  statementTotal: number;
};

/** 仕訳が明細と合わないとき（作らずに止める） */
export class JournalMismatchError extends Error {}

type SideSpec = { role: AccountKey; taxKey: string; tax?: number | null; invoiceKey?: string };

function makeSide(spec: SideSpec, m: Mapping, driverName: string): Side {
  return {
    role: spec.role,
    account: m.accounts[spec.role],
    sub: spec.role === "payable" && m.payableSubByDriver ? driverName : "",
    taxLabel: m.tax(spec.taxKey),
    invoice: spec.invoiceKey && m.format === "mf" ? m.tax(spec.invoiceKey) : "",
    tax: spec.tax ?? null,
  };
}

function flip(v: number | null): number | null {
  return v === null ? null : -v;
}

/** 1 行（借方と貸方が同じ額）。0 円なら作らない。マイナスなら借方と貸方を入れ替える */
function pairRow(debit: SideSpec, credit: SideSpec, amount: number, memo: string, m: Mapping, name: string): JournalRow | null {
  if (amount === 0) return null;
  const d = makeSide(debit, m, name);
  const c = makeSide(credit, m, name);
  if (amount > 0) return { debit: d, credit: c, amount, memo };
  return { debit: { ...c, tax: flip(c.tax) }, credit: { ...d, tax: flip(d.tax) }, amount: -amount, memo };
}

const names = (list: { name?: string; label?: string }[]) => list.map((x) => x.name ?? x.label ?? "").filter(Boolean).join("・");

/** 1 人ぶんの伝票の行（明細の数字だけを使う。計算し直さない） */
export function slipRows(d: StatementDraft, m: Mapping, taxMode: SoftwareInfo["taxMode"]): JournalRow[] {
  const name = d.driver.name;
  const prefix = `${name} ${jpMonth(d.month)}分`;
  const r = ratePercent(d.deductibleRate);
  const registered = d.driver.invoiceRegistered || r >= 100;
  const purchaseKey = registered ? "purchase" : `exempt${r}`;
  const invoiceKey = registered ? "invoice" : `invoiceExempt${r}`;
  const taxWord = d.taxLabel ?? "消費税";
  const payable: SideSpec = { role: "payable", taxKey: "none" };
  const rows: (JournalRow | null)[] = [];
  const push = (debit: SideSpec, credit: SideSpec, amount: number, memo: string) => rows.push(pairRow(debit, credit, amount, memo, m, name));

  // 1. 委託料（消費税を払わない設定の免税の方は、税額を空けてソフトに任せる）
  if (taxMode === "inclusive") {
    push({ role: "outsourcing", taxKey: purchaseKey, tax: d.tax > 0 ? d.tax : null, invoiceKey }, payable, d.subtotal + d.tax, `${prefix} 委託料`);
  } else {
    push({ role: "outsourcing", taxKey: purchaseKey }, payable, d.subtotal, `${prefix} 委託料`);
    push({ role: "inputTax", taxKey: "none" }, payable, d.tax, `${prefix} 委託料の${taxWord}`);
  }

  // 2. 控除（会社の売上）。消費税のかかるものとかからないものに分ける
  const taxable = d.deductions.filter((x) => x.taxable);
  const other = d.deductions.filter((x) => !x.taxable);
  const taxableSum = taxable.reduce((a, x) => a + x.amount, 0);
  const otherSum = other.reduce((a, x) => a + x.amount, 0);
  if (taxMode === "inclusive") {
    push(payable, { role: "deductionTaxable", taxKey: "sales", tax: d.deductionTax }, taxableSum + d.deductionTax, `${prefix} 控除（${names(taxable)}）`);
  } else {
    push(payable, { role: "deductionTaxable", taxKey: "sales" }, taxableSum, `${prefix} 控除（${names(taxable)}）`);
    push(payable, { role: "outputTax", taxKey: "none" }, d.deductionTax, `${prefix} 控除の消費税`);
  }
  push(payable, { role: "deductionOther", taxKey: "none" }, otherSum, `${prefix} 控除（${names(other)}）`);

  // 3. 調整。消費税の対象外は 1 件ずつ、対象のものは消費税と一緒に合計で
  for (const a of d.adjustments.filter((x) => !x.taxable)) {
    if (a.amount > 0) push({ role: "adjustmentPlus", taxKey: "none" }, payable, a.amount, `${prefix} ${a.label}`);
    else push(payable, { role: "adjustmentMinus", taxKey: "none" }, -a.amount, `${prefix} ${a.label}`);
  }
  const taxedAdj = d.adjustments.filter((x) => x.taxable);
  if (taxedAdj.length > 0) {
    const net = taxedAdj.reduce((a, x) => a + x.amount, 0);
    const memo = `${prefix} ${names(taxedAdj)}`;
    if (taxMode === "inclusive") {
      const gross = net + d.adjustmentTax;
      if (gross >= 0) push({ role: "adjustmentPlusTaxable", taxKey: purchaseKey, tax: d.adjustmentTax, invoiceKey }, payable, gross, memo);
      else push(payable, { role: "adjustmentMinusTaxable", taxKey: "sales", tax: -d.adjustmentTax }, -gross, memo);
    } else {
      if (net >= 0) push({ role: "adjustmentPlusTaxable", taxKey: purchaseKey }, payable, net, memo);
      else push(payable, { role: "adjustmentMinusTaxable", taxKey: "sales" }, -net, memo);
      if (d.adjustmentTax >= 0) push({ role: "inputTax", taxKey: "none" }, payable, d.adjustmentTax, `${memo}の消費税`);
      else push(payable, { role: "outputTax", taxKey: "none" }, -d.adjustmentTax, `${memo}の消費税`);
    }
  }

  // 4. 源泉徴収
  push(payable, { role: "withholding", taxKey: "none" }, d.withholding?.amount ?? 0, `${prefix} 源泉所得税`);

  return rows.filter((x): x is JournalRow => x !== null);
}

/** ドライバーの番号の順（番号が無い人は後ろで名前の順）。伝票No と支払一覧の並び */
export function sortByDriverCode<T extends { driver: { code: string | null; name: string } }>(drafts: T[]): T[] {
  return [...drafts].sort((a, b) => {
    const ca = a.driver.code ?? "";
    const cb = b.driver.code ?? "";
    if (ca && cb && ca !== cb) return ca.localeCompare(cb, "ja", { numeric: true });
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;
    return a.driver.name.localeCompare(b.driver.name, "ja");
  });
}

/** 未払金の残り（貸方 − 借方） */
export function payableNetOf(rows: JournalRow[]): number {
  let net = 0;
  for (const r of rows) {
    if (r.credit.role === "payable") net += r.amount;
    if (r.debit.role === "payable") net -= r.amount;
  }
  return net;
}

/** 全員ぶんの伝票。1 枚ずつ、借方と貸方の合計・未払金の残りと明細の振込額を確かめる */
export function buildSlips(drafts: StatementDraft[], m: Mapping, taxMode: SoftwareInfo["taxMode"]): Slip[] {
  const slips: Slip[] = [];
  for (const d of sortByDriverCode(drafts)) {
    const rows = slipRows(d, m, taxMode);
    if (rows.length === 0) continue;
    const debitTotal = rows.reduce((a, r) => a + r.amount, 0);
    const creditTotal = rows.reduce((a, r) => a + r.amount, 0);
    const payableNet = payableNetOf(rows);
    if (debitTotal !== creditTotal) throw new JournalMismatchError(`${d.driver.name}さんの伝票の借方と貸方の合計が合いません`);
    if (payableNet !== d.total) {
      throw new JournalMismatchError(`${d.driver.name}さんの仕訳の未払金の残り（${payableNet}円）が、明細の振込額（${d.total}円）と合いません`);
    }
    slips.push({ no: slips.length + 1, date: d.period.to, driverId: d.driverId, driverName: d.driver.name, rows, debitTotal, creditTotal, payableNet, statementTotal: d.total });
  }
  return slips;
}

/** 科目ごとの合計（画面の確かめ用） */
export function accountTotals(slips: Slip[]): { account: string; debit: number; credit: number }[] {
  const map = new Map<string, { account: string; debit: number; credit: number }>();
  const add = (account: string, side: "debit" | "credit", amount: number) => {
    const t = map.get(account) ?? { account, debit: 0, credit: 0 };
    t[side] += amount;
    map.set(account, t);
  };
  for (const s of slips)
    for (const r of s.rows) {
      add(r.debit.account, "debit", r.amount);
      add(r.credit.account, "credit", r.amount);
    }
  return [...map.values()];
}

// ---------------------------------------------------------------- ファイルの形

const slash = (date: string) => date.replace(/-/g, "/");
const taxCell = (v: number | null) => (v === null ? "" : String(v));

/** 弥生会計の識別フラグ：1 行の伝票は 2000、複数行は 2110（最初）・2100（途中）・2101（最後） */
export function yayoiFlag(index: number, count: number): string {
  if (count <= 1) return "2000";
  if (index === 0) return "2110";
  if (index === count - 1) return "2101";
  return "2100";
}

/** 弥生会計のインポート形式（見出しなし・25 項目） */
export function yayoiRecords(slips: Slip[]): string[][] {
  const out: string[][] = [];
  for (const s of slips) {
    s.rows.forEach((r, i) => {
      out.push([
        yayoiFlag(i, s.rows.length), // 1 識別フラグ
        String(s.no), // 2 伝票No
        "", // 3 決算
        slash(s.date), // 4 取引日付
        r.debit.account, // 5 借方勘定科目
        r.debit.sub, // 6 借方補助科目
        "", // 7 借方部門
        r.debit.taxLabel, // 8 借方税区分
        String(r.amount), // 9 借方金額
        taxCell(r.debit.tax), // 10 借方税金額
        r.credit.account, // 11 貸方勘定科目
        r.credit.sub, // 12 貸方補助科目
        "", // 13 貸方部門
        r.credit.taxLabel, // 14 貸方税区分
        String(r.amount), // 15 貸方金額
        taxCell(r.credit.tax), // 16 貸方税金額
        r.memo, // 17 摘要
        "", // 18 番号
        "", // 19 期日
        "0", // 20 タイプ
        "", // 21 生成元
        "", // 22 仕訳メモ
        "0", // 23 付箋1
        "0", // 24 付箋2
        "no", // 25 調整
      ]);
    });
  }
  return out;
}

export const MF_HEADER = [
  "取引No",
  "取引日",
  "借方勘定科目",
  "借方補助科目",
  "借方部門",
  "借方取引先",
  "借方税区分",
  "借方インボイス",
  "借方金額(円)",
  "借方税額",
  "貸方勘定科目",
  "貸方補助科目",
  "貸方部門",
  "貸方取引先",
  "貸方税区分",
  "貸方インボイス",
  "貸方金額(円)",
  "貸方税額",
  "摘要",
  "仕訳メモ",
  "タグ",
  "MF仕訳タイプ",
  "決算整理仕訳",
];

/** マネーフォワード クラウド会計の仕訳帳の列（見出しあり） */
export function mfRecords(slips: Slip[]): string[][] {
  const out: string[][] = [MF_HEADER];
  for (const s of slips) {
    for (const r of s.rows) {
      out.push([
        String(s.no),
        slash(s.date),
        r.debit.account,
        r.debit.sub,
        "",
        s.driverName,
        r.debit.taxLabel,
        r.debit.invoice,
        String(r.amount),
        taxCell(r.debit.tax),
        r.credit.account,
        r.credit.sub,
        "",
        s.driverName,
        r.credit.taxLabel,
        r.credit.invoice,
        String(r.amount),
        taxCell(r.credit.tax),
        r.memo,
        "",
        "",
        "",
        "",
      ]);
    }
  }
  return out;
}

export const GENERIC_HEADER = ["伝票番号", "日付", "借方科目", "借方補助", "借方税区分", "借方金額", "貸方科目", "貸方補助", "貸方税区分", "貸方金額", "摘要", "取引先"];

/** 汎用 CSV（見出しあり。金額は税抜、消費税は別の行） */
export function genericRecords(slips: Slip[]): string[][] {
  const out: string[][] = [GENERIC_HEADER];
  for (const s of slips) {
    for (const r of s.rows) {
      out.push([
        String(s.no),
        slash(s.date),
        r.debit.account,
        r.debit.sub,
        r.debit.taxLabel,
        String(r.amount),
        r.credit.account,
        r.credit.sub,
        r.credit.taxLabel,
        String(r.amount),
        r.memo,
        s.driverName,
      ]);
    }
  }
  return out;
}

export function journalRecords(slips: Slip[], software: SoftwareKey): string[][] {
  const format = SOFTWARE[software].format;
  if (format === "yayoi") return yayoiRecords(slips);
  if (format === "mf") return mfRecords(slips);
  return genericRecords(slips);
}

// ---------------------------------------------------------------- 支払一覧

export const PAYMENT_HEADER = [
  "ドライバー番号",
  "ドライバー",
  "インボイスの登録",
  "委託料（税抜）",
  "消費税",
  "控除（消費税を含む・差し引く額）",
  "調整（消費税を含む・＋は加算／−は差引）",
  "源泉徴収",
  "振込額",
  "振込予定日",
];

/** 支払一覧（明細の数字をそのまま 1 人 1 行に。どんな用途にも使える形） */
export function paymentRecords(drafts: StatementDraft[]): string[][] {
  const out: string[][] = [PAYMENT_HEADER];
  for (const d of sortByDriverCode(drafts)) {
    out.push([
      d.driver.code ?? "",
      d.driver.name,
      d.driver.invoiceRegistered ? "あり" : "なし",
      String(d.subtotal),
      String(d.tax),
      String(d.deductionTotal + d.deductionTax),
      String(d.adjustmentTotal + d.adjustmentTax),
      String(d.withholding?.amount ?? 0),
      String(d.total),
      slash(d.payDate),
    ]);
  }
  return out;
}

// ---------------------------------------------------------------- ファイル名

export function exportFileName(kind: ExportKind, month: string): string {
  const m = jpMonth(month);
  switch (kind) {
    case "yayoi":
      return `仕訳_弥生会計_${m}.csv`;
    case "freee":
      return `仕訳_弥生会計の形式_freee用_${m}.csv`;
    case "mf":
      return `仕訳帳_マネーフォワード_${m}.csv`;
    case "generic":
      return `仕訳_汎用_${m}.csv`;
    case "payments":
      return `支払一覧_${m}.csv`;
  }
}
