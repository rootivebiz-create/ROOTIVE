/**
 * 取り込み（稼働の Excel・CSV）で使う型と、画面にも出す言葉。
 * DB にも server-only にも触らない（画面の部品からも読める）。
 */

/**
 * 列の役目
 * - value：数（見出しが案件名か日付。行がドライバー）
 * - driverValue：数（見出しがドライバーの名前。行が日付か案件＝人が横に並ぶ表）
 */
export type ColumnRole = "driver" | "driverCode" | "project" | "qty" | "date" | "note" | "value" | "driverValue" | "ignore";

export const COLUMN_ROLES: ColumnRole[] = ["driver", "driverCode", "project", "qty", "date", "note", "value", "driverValue", "ignore"];

export const ROLE_LABEL: Record<ColumnRole, string> = {
  driver: "ドライバーの名前",
  driverCode: "ドライバーの番号",
  project: "案件（コース・品目）",
  qty: "数量",
  date: "日付",
  note: "備考",
  value: "数（見出しが案件名か日付）",
  driverValue: "数（見出しがドライバーの名前）",
  ignore: "使わない",
};

/** 1 つの列にしか付けられない役目 */
export const SINGLE_ROLES: ColumnRole[] = ["driver", "driverCode", "project", "qty", "date", "note"];

/**
 * 表の形
 * - long（縦持ち）：1 行が 1 件。ドライバー・案件・数量の列がある
 * - wide（横持ち）：行がドライバー、列が案件（または日付）で、中に数
 * - byDriver（人が横に並ぶ）：行が日付（または案件）、列がドライバーで、中に数
 */
export type Layout = "long" | "wide" | "byDriver";

/**
 * 金額の列を、その月の調整（人ごとの足し引き）として入れる設定。
 * 燃料・高速代・立替・事故の負担など、人ごと・月ごとに額が変わるもの（決まった式にならないもの）に使う。
 * 覚えた読み方にも残す（2 か月目からは、置いて反映するだけ）
 */
export type AdjustColumn = {
  /** 列の番号 */
  col: number;
  /** 明細に出す名前 */
  label: string;
  /** plus：支払を増やす（立替の精算 など）・minus：支払を減らす（差し引き）・asIs：Excel の符号のまま（＋も−もある列） */
  sign: "plus" | "minus" | "asIs";
  taxable: boolean;
  agreedInWriting: boolean;
  basis: string | null;
};

/** 調整の向きの言葉（画面に出す） */
export const ADJUST_SIGN_LABEL: Record<AdjustColumn["sign"], string> = {
  plus: "支払を増やす（＋ 立替の精算・手当 など）",
  minus: "支払を減らす（− 差し引き）",
  asIs: "Excel の符号のまま（＋は増やす・−は減らす）",
};

/** 「○」「出」「休」のような印を、いくつと数えるか（印 → 数量） */
export type MarkMap = Record<string, number>;

/** 印の既定の数え方（○・出 は 1、休・× は 0） */
export const DEFAULT_MARKS: MarkMap = {
  "○": 1,
  "◯": 1,
  "〇": 1,
  "●": 1,
  "◎": 1,
  出: 1,
  休: 0,
  欠: 0,
  "×": 0,
  "✕": 0,
  "✖": 0,
  "-": 0,
  "―": 0,
  "ー": 0,
};

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
  /**
   * 「この表はすべて同じ人」のときのドライバー（1 人 1 枚の表）。
   * 覚えた読み方には残さない（同じ形の別の人の表に、前の人を当ててしまわないように。毎回シートの名前・表題から当て直す）
   */
  fixedDriverId?: string | null;
  /** シートごとに別の人の表（シートの名前・表題が人の名前）。同じ形のシートをすべて読む */
  sheetDrivers?: boolean;
  /** 印（○・出・休 など）の数え方。無ければ数だけを読む */
  marks?: MarkMap | null;
  /** その月の調整として入れる金額の列 */
  adjust?: AdjustColumn[];
};

export function layoutOf(roles: ColumnRole[]): Layout {
  if (roles.includes("driverValue")) return "byDriver";
  return roles.includes("value") ? "wide" : "long";
}

/** 読み取った 1 件（名前はまだファイルの書き方のまま） */
export type RawRecord = {
  /** ファイルの行番号（1 始まり） */
  rowNo: number;
  /** シートごとに別の人の表を読んだとき：シートの番号（1 枚だけなら無し） */
  sheet?: number;
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

/** 入れ替えで消した調整（取り消しで戻すために持っておく） */
export type RestoreAdjustment = {
  driverId: string;
  label: string;
  amount: number;
  taxable: boolean;
  agreedInWriting: boolean;
  basis: string | null;
  /** 作った取り込み */
  importBatchId: string;
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

/** truncated：読み取りの上限（2 万行）に届いたシート。途中から先を読めていないおそれがある */
export type StoredSheet = { name: string; rows: string[][] | null; dataRows: number; truncated?: boolean };

/** 読み取りの上限の行数（server/tabular.ts と同じ）。ここまで行があるシートは、先を読めていないおそれがある */
export const MAX_SHEET_ROWS = 20000;

/** import_batches.summary の中身 */
export type DraftSummary = {
  v: 1;
  file: { name: string; size: number; hash: string; encoding: string; uploadedAt: string; sample?: boolean };
  sheets: StoredSheet[];
  sheetIndex: number;
  /** Excel に残っていた控除らしい数式（シートの名前 → 番地 → 数式。例：{"10月": {"G5": "=E5*0.1"}}）。控除の提案の手がかり */
  formulas?: Record<string, Record<string, string>>;
  /** ファイルの形の目印（同じ形なら同じ値。日付の列の数の違いは無視） */
  signature: string;
  mapping: WorkMapping;
  mappingFrom: "profile" | "guess" | "user";
  profileId: string | null;
  /** 反映したとき、この読み方を覚えるか（既定は覚える） */
  remember?: boolean;
  monthFrom: "dates" | "title" | "sheet" | "file" | "page" | "user";
  /** シートの選び方（month：開いていた月のシート／rows：データの行がいちばん多いシート／user：選び直した） */
  sheetFrom?: "month" | "rows" | "user";
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
    /** 「取り消して入れ直す」で入れ替えた、同じファイルの前の取り込み */
    reappliedFrom?: string[];
    /** ファイルの振込額の列（今の Excel の振込額）を、並行運用の比べ合わせに入れた結果 */
    payouts?: PayoutSaved;
    /** ファイルにあった振込手数料の列の見出し（控除のルールにはしない。見張り番が読めるように残す） */
    feeColumns?: string[];
    /** 金額の列から入れた、その月の調整（取り消しで消す）と、入れ替えで消した前の取り込みの調整（取り消しで戻す） */
    adjustments?: { ids: string[]; count: number; total: number; removed: RestoreAdjustment[] };
  };
  discarded?: { at: string; by: string | null; reason: "undo" | "replaced" | "cancel"; replacedBy?: string };
};

/** 振込額の列を並行運用に入れた記録（saved：入れた人数・kept：メモがあるので上書きしなかった人） */
export type PayoutSaved = { header: string; saved: number; kept: string[]; at: string; error?: string };

/**
 * 1 回に取り込めるファイルの大きさ。画面からの送信（Server Action）は、置き場所（Vercel）で 1 回 約 4.5MB までなので、
 * 余白を見て 4MB にする（それより大きいと、理由の出ないエラーになる）
 */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
/** 画面に出す上限の書き方 */
export const MAX_FILE_LABEL = "4MB";
/** デモ（来た人ごとの架空の会社）で置けるファイルの大きさ */
export const DEMO_MAX_FILE_BYTES = 1024 * 1024;
export const DEMO_MAX_FILE_LABEL = "1MB";

/** 先月と比べて目立たせる変化の幅（±50%） */
export const CHANGE_THRESHOLD = 0.5;

/** 「見本で試す」のファイル（public/samples） */
export const SAMPLE_FILES = {
  long: "稼働_縦持ち_2026年10月.xlsx",
  wide: "稼働_横持ち_2026年10月.xlsx",
} as const;
export type SampleKey = keyof typeof SAMPLE_FILES;
