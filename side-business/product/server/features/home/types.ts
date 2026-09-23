/**
 * ホーム（今月の締め）の中身の形。DB から集めるのは server/features/home.ts、
 * 「次にやること」と各段の文は steps.ts（純関数）。
 */
import type { OnboardingProgress } from "~/server/features/onboarding/steps";

export type HomeStatus = {
  /** YYYY-MM-01 */
  month: string;
  closed: boolean;
  closedAt: Date | null;
  closedByName: string | null;
  /** ドライバーへの支払日（会社の設定から。明細に書く日） */
  payDate: string;
  /** ① 取り込み */
  work: {
    entries: number;
    drivers: number;
    adjustments: number;
    /** この月の最後の取り込み（反映したもの。無ければ確認中のもの） */
    latestBatch: { id: string; fileName: string; createdAt: Date; status: string; rowCount: number } | null;
    /** 確認中（まだ反映していない）の取り込み */
    openDrafts: { id: string; fileName: string }[];
  };
  /** ② 見張り番（確認済みにしたものは数えない） */
  watch: {
    red: number;
    redAcked: number;
    yellow: number;
    error: string | null;
    topRed: { title: string; subjectLabel: string; href: string | null }[];
  };
  /** ③ 支払明細（締めた月は、作り直しの判定をしない） */
  statements: {
    expected: number;
    saved: number;
    missing: number;
    stale: number;
    orphan: number;
    upToDate: boolean;
    /** まだ送っていない人・送ったあとで中身が変わった人 */
    unsent: number;
    needsResend: number;
    sent: number;
    viewed: number;
    confirmed: number;
    deemed: number;
    /** 前の版を確認したが、そのあと変わった人 */
    changed: number;
    openQuestions: number;
  };
  /** ④ 振込 */
  transfer: {
    batches: number;
    people: number;
    total: number;
    executed: number;
    /** 作ったあとに明細が変わった振込データ */
    changed: number;
    latestTransferDate: string | null;
  };
  /** 振込額の合計（開いている月は今の見込み、締めた月は保存した明細） */
  totals: { drivers: number; total: number; source: "calc" | "saved" };
  /** 今月の会社の利益 */
  profit: { sales: number; subtotal: number; profit: number; source: "calc" | "snapshot" };
  /** 元請との突合（まだ解決していない差） */
  reconcile: { notices: number; items: number; openItems: number; openDiff: number; short: number; over: number };
  /** ドライバーからの、まだ解決していない質問 */
  questions: { count: number; items: { statementId: string; driverName: string; body: string; createdAt: Date }[] };
  onboarding: OnboardingProgress;
};
