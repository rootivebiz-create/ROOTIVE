/**
 * 取り込み（稼働の Excel・CSV）で使う型と、画面にも出す言葉。
 * DB にも server-only にも触らない（画面の部品からも読める）。
 */

/** 列の役目 */
export type ColumnRole = "driver" | "driverCode" | "project" | "qty" | "date" | "note" | "value" | "ignore";

export const COLUMN_ROLES: ColumnRole[] = ["driver", "driverCode", "project", "qty", "date", "note", "value", "ignore"];

export const ROLE_LABEL: Record<ColumnRole, string> = {
  driver: "ドライバーの名前",
  driverCode: "ドライバーの番号",
  project: "案件（コース・品目）",
  qty: "数量",
  date: "日付",
  note: "備考",
  value: "数（見出しが案件名か日付）",
  ignore: "使わない",
};

/** 1 つの列にしか付けられない役目 */
export const SINGLE_ROLES: ColumnRole[] = ["driver", "driverCode", "project", "qty", "date", "note"];

/**
 * 表の形
 * - long（縦持ち）：1 行が 1 件。ドライバー・案件・数量の列がある
 * - wide（横持ち）：行がドライバー、列が案件（または日付）で、中に数
 */
export type Layout = "long" | "wide";

export type WorkMapping = {
  /** 見出しの行（0 始まり） */
  headerRow: number;
  /** 見出しが 2 段（上に月、下に日付 など）なら 2 */
  headerDepth: 1 | 2;
  /** 列ごとの役目（列の番号＝配列の位置） */
  roles: ColumnRole[];
  /** 「この表はすべて同じ案件」のときの案件 */
  fixedProjectId: string | null;
  /** 日付を行ごとに残すか（false なら月を決めるのにだけ使う） */
  useDates: boolean;
};

export function layoutOf(roles: ColumnRole[]): Layout {
  return roles.includes("value") ? "wide" : "long";
}

/** 読み取った 1 件（名前はまだファイルの書き方のまま） */
export type RawRecord = {
  /** ファイルの行番号（1 始まり） */
  rowNo: number;
  /** 数が入っていたセルの番地（例：E5） */
  cell: string;
  driver: string;
  code: string;
  /** 案件の名前（列の見出し・案件の列）。「すべて同じ案件」のときは空 */
  project: string;
  qty: number;
  date: string | null;
  note: string | null;
};

export type SkippedRow = { rowNo: number; cell?: string; reason: string };

/** ファイル自身の合計との照合 */
export type TotalCheck = { label: string; expected: number; actual: number; ok: boolean; note?: string };

export type ParseResult = {
  records: RawRecord[];
  skipped: SkippedRow[];
  /** 横持ちで空・0 だったセルの数（取り込まない。ふつうのこと） */
  emptyCells: number;
  checks: TotalCheck[];
  warnings: string[];
  /** 日付の列から数えた「年月 → 行数」 */
  dateMonths: Record<string, number>;
  /** 読み方が決まっていないときの説明（このままでは取り込めない） */
  problem: string | null;
};

/** 取り込まないと決めた名前（名前の正規化した値） */
export type SkipLists = { drivers: string[]; projects: string[] };

/** 名前を覚えた・登録した記録（画面に「覚えました」と出す） */
export type Learned = { kind: "driver" | "project"; raw: string; id: string; name: string; how: "alias" | "new" };

export type ApplyMode = "replace" | "replaceAll" | "add";

export const APPLY_MODE_LABEL: Record<ApplyMode, string> = {
  replace: "前に取り込んだ同じ形のファイルと入れ替える",
  replaceAll: "この月の稼働をすべて入れ替える（手入力の分も）",
  add: "今ある稼働に足す",
};

/** 消した稼働（取り消しで戻すために持っておく） */
export type RestoreEntry = {
  driverId: string;
  projectId: string;
  qty: number;
  workDate: string | null;
  note: string | null;
  importBatchId: string | null;
};

export type BatchStats = {
  records: number;
  totalQty: number;
  drivers: number;
  projects: number;
  skippedRows: number;
  unresolved: number;
  byProject: { name: string; unit: string; qty: number }[];
};

export type StoredSheet = { name: string; rows: string[][] | null; dataRows: number };

/** import_batches.summary の中身 */
export type DraftSummary = {
  v: 1;
  file: { name: string; size: number; hash: string; encoding: string; uploadedAt: string; sample?: boolean };
  sheets: StoredSheet[];
  sheetIndex: number;
  /** ファイルの形の目印（同じ形なら同じ値。日付の列の数の違いは無視） */
  signature: string;
  mapping: WorkMapping;
  mappingFrom: "profile" | "guess" | "user";
  profileId: string | null;
  /** 反映したとき、この読み方を覚えるか（既定は覚える） */
  remember?: boolean;
  monthFrom: "dates" | "title" | "file" | "page" | "user";
  skip: SkipLists;
  learned: Learned[];
  stats?: BatchStats;
  applied?: {
    at: string;
    by: string | null;
    mode: ApplyMode;
    entries: number;
    replacedBatchIds: string[];
    removed: RestoreEntry[];
  };
  discarded?: { at: string; by: string | null; reason: "undo" | "replaced" | "cancel"; replacedBy?: string };
};

/** 1 回に取り込めるファイルの大きさ */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** 先月と比べて目立たせる変化の幅（±50%） */
export const CHANGE_THRESHOLD = 0.5;

/** 「見本で試す」のファイル（public/samples） */
export const SAMPLE_FILES = {
  long: "稼働_縦持ち_2026年10月.xlsx",
  wide: "稼働_横持ち_2026年10月.xlsx",
} as const;
export type SampleKey = keyof typeof SAMPLE_FILES;
