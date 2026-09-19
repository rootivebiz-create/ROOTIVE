/**
 * 月次パック ZIP の組み立て（純関数。サーバー・クライアント共用）
 *
 * 「その月の一式」を 1 つの ZIP にまとめるときの、
 *   - どの出力を含めるか（parts）
 *   - ZIP の中のフォルダ構成とファイル名
 *   - 同名ファイルの重複回避・ファイル名に使えない文字の除去
 *   - README.txt の本文
 * だけをここで決める。実際のファイル生成（PDF・CSV）は Route Handler が行う。
 *
 * 金額や集計はここでは一切扱わない。
 */
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";

// ---------------------------------------------------------------------------
// 含める出力（parts）
// ---------------------------------------------------------------------------

/** 月次パックに含められる出力の種類 */
export const MONTH_PACK_PARTS = ["statements", "invoices", "csv", "transfer", "report"] as const;
export type MonthPackPart = (typeof MONTH_PACK_PARTS)[number];
export type MonthPackParts = Record<MonthPackPart, boolean>;

export const MONTH_PACK_PART_LABELS: Record<MonthPackPart, string> = {
  statements: "支払明細 PDF",
  invoices: "請求書 PDF",
  csv: "CSV 一式",
  transfer: "振込データ",
  report: "経営レポート PDF",
};

/** 画面に添える 1 行の説明 */
export const MONTH_PACK_PART_DESCRIPTIONS: Record<MonthPackPart, string> = {
  statements: "ドライバーごとの支払明細。本人にそのまま渡せます。",
  invoices: "その月の請求書。取引先へ送る控えになります。",
  csv: "稼働・支払・経費・請求・案件別採算の CSV。Excel でそのまま開けます。",
  transfer: "銀行にそのまま取り込める全銀フォーマットのデータ。口座情報を含むので取り扱いに注意してください。",
  report: "その月の損益・経営指標・推移をまとめた PDF。",
};

/**
 * 既定で含める出力。振込データは口座情報を含むため、明示して選んだときだけ入れる。
 */
export const DEFAULT_MONTH_PACK_PARTS: MonthPackParts = {
  statements: true,
  invoices: true,
  csv: true,
  transfer: false,
  report: true,
};

function isMonthPackPart(v: string): v is MonthPackPart {
  return (MONTH_PACK_PARTS as readonly string[]).includes(v);
}

/**
 * ?parts=statements,csv → { statements: true, csv: true, ほかは false }
 * 空・未指定・知らない名前だけのときは既定（振込データ以外すべて）。
 */
export function parseMonthPackParts(raw: string | null | undefined): MonthPackParts {
  const names = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (names.length === 0) return { ...DEFAULT_MONTH_PACK_PARTS };
  if (names.includes("all")) return { statements: true, invoices: true, csv: true, transfer: true, report: true };
  const picked = names.filter(isMonthPackPart);
  if (picked.length === 0) return { ...DEFAULT_MONTH_PACK_PARTS };
  const out: MonthPackParts = { statements: false, invoices: false, csv: false, transfer: false, report: false };
  for (const p of picked) out[p] = true;
  return out;
}

/** parts → "statements,csv"（URL のクエリ用。並びは MONTH_PACK_PARTS の順） */
export function monthPackPartsParam(parts: MonthPackParts): string {
  return MONTH_PACK_PARTS.filter((p) => parts[p]).join(",");
}

/** 1 つも選ばれていないか（README だけの ZIP になるのを防ぐ） */
export function isEmptyParts(parts: MonthPackParts): boolean {
  return MONTH_PACK_PARTS.every((p) => !parts[p]);
}

// ---------------------------------------------------------------------------
// ファイル名
// ---------------------------------------------------------------------------

/** ZIP のファイル名・フォルダ名に使えない文字（OS 予約文字と制御文字） */
const UNSAFE_NAME_RE = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * ファイル名に使えない文字を取り除く。
 * 前後の空白・ドットも落とす（Windows で開けない名前になるため）。空になったら "無題"。
 */
export function safePackName(s: string): string {
  const cleaned = (s ?? "").replace(UNSAFE_NAME_RE, "").replace(/\s+/g, " ").trim().replace(/^\.+|\.+$/g, "").trim();
  return cleaned || "無題";
}

/** ZIP 本体のファイル名：月次パック_2026-12.zip */
export function monthPackFilename(month: string): string {
  return `月次パック_${safePackName(month)}.zip`;
}

/** 同名になったときに "名前 (2).拡張子" を返す（大文字・小文字は区別しない） */
export function uniquePackName(name: string, used: Set<string>): string {
  const slash = name.lastIndexOf("/");
  const dir = slash >= 0 ? name.slice(0, slash + 1) : "";
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${dir}${stem} (${n})${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

// ---------------------------------------------------------------------------
// ZIP に入れるファイルの一覧
// ---------------------------------------------------------------------------

/** ZIP に入れるファイルの種類 */
export type MonthPackKind = "statement" | "invoice" | "csv" | "transfer" | "report" | "readme";

/** 種類ごとのフォルダ（"" は月フォルダ直下） */
export const MONTH_PACK_FOLDERS: Record<MonthPackKind, string> = {
  statement: "明細",
  invoice: "請求書",
  csv: "CSV",
  transfer: "振込",
  report: "",
  readme: "",
};

/** 種類ごとの見出し（README で使う） */
export const MONTH_PACK_KIND_LABELS: Record<MonthPackKind, string> = {
  statement: "支払明細 PDF",
  invoice: "請求書 PDF",
  csv: "CSV",
  transfer: "振込データ",
  report: "経営レポート",
  readme: "この説明",
};

/** 種類ごとの 1 行の説明（README で使う） */
export const MONTH_PACK_KIND_NOTES: Record<MonthPackKind, string> = {
  statement: "ドライバーごとの支払明細です。本人にそのまま渡せます（金額は税込のお支払額）。",
  invoice: "取引先ごとの請求書です。発行済みのものはそのまま送れます。",
  csv: "Excel でそのまま開ける CSV（UTF-8・BOM 付き）です。金額は税抜です。",
  transfer: "銀行に取り込む全銀フォーマット（Shift_JIS・120 バイト固定長）です。口座情報を含むので取り扱いに注意してください。",
  report: "その月の損益・経営指標・推移をまとめたレポートです。",
  readme: "この ZIP の中身の説明です。",
};

/** ZIP に入れる CSV（既定の 5 種類。名前は拡張子なし） */
export const MONTH_PACK_CSV_NAMES = ["稼働明細", "支払一覧", "経費", "請求書一覧", "案件別採算"] as const;

/** 振込データのファイル名 */
export const MONTH_PACK_TRANSFER_NAME = "振込データ.txt";

/** 経営レポートのファイル名（拡張子なし） */
export const MONTH_PACK_REPORT_NAME = "経営レポート";

/** README のファイル名 */
export const MONTH_PACK_README_NAME = "README.txt";

export interface MonthPackEntry {
  kind: MonthPackKind;
  /** ZIP 内のフルパス（例："2026-12/明細/相曽慧_2026-12.pdf"） */
  name: string;
  /** 元になった名前（ドライバー名・請求書番号など。README と生成処理で使う） */
  label: string;
  /** 元データの ID（ドライバー ID・請求書 ID など。生成処理が使う） */
  id?: string;
}

export interface MonthPackInput {
  /** 稼動月 "YYYY-MM" */
  month: string;
  /** 含める出力 */
  parts: MonthPackParts;
  /** 明細 PDF を作るドライバー（並び順は呼び出し側の順のまま） */
  drivers?: { id?: string; name: string }[];
  /** 請求書 PDF を作る請求書（番号が空なら取引先名を使う） */
  invoices?: { id?: string; invoiceNo?: string | null; clientName?: string | null }[];
  /** CSV の名前（拡張子なし）。省略時は MONTH_PACK_CSV_NAMES */
  csvNames?: readonly string[];
}

/** 月フォルダ配下のパスを組み立てる */
function packPath(month: string, kind: MonthPackKind, filename: string): string {
  const folder = MONTH_PACK_FOLDERS[kind];
  const root = safePackName(month);
  return folder ? `${root}/${folder}/${safePackName(filename)}` : `${root}/${safePackName(filename)}`;
}

/**
 * ZIP に入れるファイルの一覧を決める（純関数）。
 * 選ばれていない出力は返さない。README.txt は必ず最後に 1 件入る。
 * 同名になったものは "名前 (2)" のように番号を付ける。
 */
export function monthPackEntries(input: MonthPackInput): MonthPackEntry[] {
  const month = safePackName(input.month);
  const used = new Set<string>();
  const out: MonthPackEntry[] = [];
  const push = (kind: MonthPackKind, filename: string, label: string, id?: string) => {
    out.push({ kind, name: uniquePackName(packPath(month, kind, filename), used), label, id });
  };

  if (input.parts.statements) {
    for (const d of input.drivers ?? []) {
      const name = safePackName(d.name);
      push("statement", `${name}_${month}.pdf`, d.name, d.id);
    }
  }
  if (input.parts.invoices) {
    for (const inv of input.invoices ?? []) {
      const label = (inv.invoiceNo ?? "").trim() || (inv.clientName ?? "").trim() || "請求書";
      push("invoice", `${safePackName(label)}.pdf`, label, inv.id);
    }
  }
  if (input.parts.csv) {
    for (const name of input.csvNames ?? MONTH_PACK_CSV_NAMES) push("csv", `${safePackName(name)}.csv`, name);
  }
  if (input.parts.transfer) push("transfer", MONTH_PACK_TRANSFER_NAME, "振込データ");
  if (input.parts.report) push("report", `${MONTH_PACK_REPORT_NAME}_${month}.pdf`, "経営レポート");

  push("readme", MONTH_PACK_README_NAME, "README");
  return out;
}

// ---------------------------------------------------------------------------
// README.txt
// ---------------------------------------------------------------------------

/** 作成できなかったファイル（README に理由を残して処理は続ける） */
export interface MonthPackError {
  /** ZIP 内のパス、または対象の名前 */
  name: string;
  message: string;
}

export interface MonthPackReadmeInput {
  companyName: string;
  month: string;
  /** 締め済みか（未締めなら速報値） */
  closed: boolean;
  /** 実際に ZIP へ入れたファイル（README を含む） */
  entries: MonthPackEntry[];
  /** 作成できなかったファイル */
  errors?: MonthPackError[];
  /** 作成日時 */
  generatedAt: Date;
}

/** README に載せる種類の順番 */
const README_ORDER: MonthPackKind[] = ["report", "statement", "invoice", "csv", "transfer"];

/**
 * README.txt の本文（改行は CRLF。Windows のメモ帳でそのまま読める）。
 * 中身の説明・作成日時・締め状態・件数を載せる。
 */
export function monthPackReadme(input: MonthPackReadmeInput): string {
  const lines: string[] = [];
  const total = input.entries.filter((e) => e.kind !== "readme").length;
  lines.push("ROOTIVE 月次パック");
  lines.push("==================");
  lines.push("");
  lines.push(`会社：${input.companyName || "—"}`);
  lines.push(`対象月：${formatMonthJa(input.month)}（${input.month}）`);
  lines.push(`状態：${input.closed ? "締め済み（確定値）" : "未締め（速報値）"}`);
  lines.push(`作成日時：${formatDateTimeJa(input.generatedAt.toISOString())}`);
  lines.push(`ファイル数：${total} 件（この説明を除く）`);
  lines.push("");

  if (!input.closed) {
    lines.push("※ この月はまだ締めていません。締めるまでは数字が変わることがあります。");
    lines.push("");
  }

  lines.push("【中身】");
  for (const kind of README_ORDER) {
    const rows = input.entries.filter((e) => e.kind === kind);
    if (rows.length === 0) continue;
    lines.push("");
    lines.push(`■ ${MONTH_PACK_KIND_LABELS[kind]}（${rows.length} 件）`);
    lines.push(`   ${MONTH_PACK_KIND_NOTES[kind]}`);
    for (const r of rows) lines.push(`   - ${r.name}`);
  }
  lines.push("");

  const errors = input.errors ?? [];
  if (errors.length > 0) {
    lines.push(`【作成できなかったファイル】（${errors.length} 件）`);
    for (const e of errors) lines.push(`   - ${e.name}：${e.message}`);
    lines.push("");
  }

  lines.push("【金額について】");
  lines.push("   - 金額は税抜です。ドライバーへのお支払額（明細の「お支払額」）だけ税込です。");
  lines.push("   - 会社利益・営業利益は税抜で計算しています。");
  lines.push("");
  lines.push("このファイルは ROOTIVE 利益管理システムが自動で作成しました。");

  return lines.join("\r\n") + "\r\n";
}
