/**
 * 見張り番のルールが読む材料（純粋なデータ）。DB から集めるのは context.ts、判定は rules.ts。
 * ルールはこの形だけを見るので、DB なしで単体テストができる。
 */
import type { TenantSettings } from "~/db/schema";
import type { Rounding } from "@/lib/payroll/types";
import type { StatementDraft } from "~/server/calc/statement";
import type { TermsChange, TermsContent } from "~/server/features/terms-content";
import type { WatchIssue, WatchSeverity } from "~/server/features/watch-types";

export type WatchDriver = {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
  invoiceRegistered: boolean;
  registrationNo: string | null;
  registrationCheckedOn: string | null;
  /** 取引条件を最初に明示した日（取引条件の記録の最初の版。無ければ drivers.terms_issued_on） */
  termsFirstIssuedOn: string | null;
  /** 取引条件を最後に明示した日（最新の版・drivers.terms_issued_on の遅い方） */
  termsLatestIssuedOn: string | null;
  startedOn: string | null;
  endOn: string | null;
  endNoticedOn: string | null;
  bank: {
    bankCode: string;
    bankNameKana: string;
    branchCode: string;
    branchNameKana: string;
    accountType: "ordinary" | "checking";
    accountNumber: string;
    holderKana: string;
  };
  /** 最初に稼働した月と、その月のいちばん早い日付（日付の無い行があるか） */
  firstWork: { month: string; minDate: string | null; hasUndated: boolean } | null;
};

export type WatchRule = {
  id: string;
  name: string;
  driverId: string | null;
  kind: string;
  agreedInWriting: boolean;
  agreedOn: string | null;
  basis: string | null;
  active: boolean;
  /** 稼働が無い月も引くか（無ければ「稼働した月だけ」とみなす） */
  onlyWhenWorked?: boolean;
};

export type WatchOverride = {
  id: string;
  driverId: string;
  projectId: string;
  payRate: number;
  agreedOn: string | null;
  /** 単価を最後に変えた日（日本時間の日付） */
  updatedOn: string;
};

export type WatchAdjustment = {
  id: string;
  driverId: string;
  label: string;
  amount: number;
  agreedInWriting: boolean;
  basis: string | null;
};

export type WatchStatement = { id: string; driverId: string; total: number; payDate: string };

export type WatchBatch = { id: string; fileName: string; transferDate: string; executedOn: string | null; statementIds: string[] };

/**
 * この月の、日付のある稼働の行（同じ日・同じ案件の重なりを見るため）。
 * batchId は取り込みの束（手で入れた行は null。分からないときは書かない＝別々の出どころとして扱う）
 */
export type WatchWorkRow = { driverId: string; projectId: string; workDate: string; qty: number; batchId?: string | null };

/** まだ解決にしていない、ドライバーからの明細の質問（1 件ずつ） */
export type WatchQuestion = {
  statementId: string;
  driverId: string;
  /** どの行の話か（全体なら null） */
  lineKey: string | null;
  /** 質問した日（日本時間の YYYY-MM-DD） */
  askedOn: string;
  /** 質問の行の名前と金額（保存した明細の写しから。分からなければ amount は null） */
  line: { label: string; amount: number | null };
};

/** 再委託の 3 項目（取引条件の記録にあるもの） */
export type WatchSubcontract = { isSubcontract?: boolean; originalClient?: string; originalPayDate?: string };

/** その人のいちばん新しい取引条件の記録と、今の台帳から作った中身との違い */
export type WatchTerms = {
  driverId: string;
  version: number;
  issuedOn: string;
  /** 記録した中身（古い形・空で読めないときは null。そのときは比べない） */
  recorded: TermsContent | null;
  /** 今の台帳から作った中身（作れなかったときは null） */
  current: TermsContent | null;
  /** compareTermsContent の結果 */
  changes: TermsChange[];
  subcontract: WatchSubcontract | null;
};

export type WatchContext = {
  /** YYYY-MM-01 */
  month: string;
  /** 今日（日本時間の YYYY-MM-DD） */
  today: string;
  closed: boolean;
  tenant: {
    closingDay: number;
    payMonthOffset: number;
    payDay: number;
    taxMethod: string;
    settings: TenantSettings;
    /** 金額の端数処理（影響額の見込みに使う。無ければ四捨五入） */
    amountRounding?: Rounding;
  };
  /** この月の明細（締めた月は保存した写し、開いている月は今の稼働から作った見込み） */
  drafts: StatementDraft[];
  /** 前の月の明細（比べるため。保存した写しがある人は写し、無い人は今の稼働から作った見込み） */
  prevDrafts: StatementDraft[];
  drivers: WatchDriver[];
  rules: WatchRule[];
  overrides: WatchOverride[];
  /** この月の調整 */
  adjustments: WatchAdjustment[];
  /** この月の保存済みの明細 */
  statements: WatchStatement[];
  /** この月の振込データ */
  batches: WatchBatch[];
  /** 明細が今の稼働と同じか（開いている月だけ。締めた月は null） */
  statementsStatus: { saved: number; missing: number; stale: number; orphan: number; upToDate: boolean } | null;
  /** この月の日付のある稼働の行 */
  workRows?: WatchWorkRow[];
  /** この月の明細への、まだ解決にしていない質問 */
  questions?: WatchQuestion[];
  /** 前の月の保存済みの明細と振込データ（前の月の振込の遅れを見る） */
  prevStatements?: WatchStatement[];
  prevBatches?: WatchBatch[];
  /** この月に明細がある人の、いちばん新しい取引条件の記録 */
  terms?: WatchTerms[];
  /** この月に反映した稼働の Excel にあった、振込手数料の列（控除のルールにはしていない） */
  feeColumns?: { batchId: string; fileName: string; columns: string[] }[];
};

/**
 * 影響額（円）。出せないものは yen を null にする（画面では「—」）。
 * label は「何の額か」（例：「この人の今月の支払額」）。
 */
export type WatchImpact = { yen: number | null; label: string };

/**
 * 見張り番の指摘に、この機能だけが足す項目（共通の WatchIssue の形は変えない。runWatch はこれを付けたまま返す）
 */
export type IssueExtras = {
  impact?: WatchImpact;
  /** ルールのもとにした情報の時点（例：「2026年9月」） */
  asOf?: string;
};

/** ルールが返す指摘（確認済みかどうかは runWatch が足す） */
export type IssueDraft = Omit<WatchIssue, "acked" | "ackNote" | "blocksClose"> & IssueExtras;

/** 画面が読む指摘（影響額と時点つき） */
export type WatchIssueEx = WatchIssue & IssueExtras;

export type { WatchIssue, WatchSeverity };
