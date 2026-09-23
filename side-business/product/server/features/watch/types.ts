/**
 * 見張り番のルールが読む材料（純粋なデータ）。DB から集めるのは context.ts、判定は rules.ts。
 * ルールはこの形だけを見るので、DB なしで単体テストができる。
 */
import type { TenantSettings } from "~/db/schema";
import type { StatementDraft } from "~/server/calc/statement";
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
  };
  /** この月の明細（締めた月は保存した写し、開いている月は今の稼働から作った見込み） */
  drafts: StatementDraft[];
  /** 前の月の明細（比べるため。同じ読み方） */
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
};

/** ルールが返す指摘（確認済みかどうかは runWatch が足す） */
export type IssueDraft = Omit<WatchIssue, "acked" | "ackNote" | "blocksClose">;

export type { WatchIssue, WatchSeverity };
