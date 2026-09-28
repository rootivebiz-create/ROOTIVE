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
  /** ④ 振込（振込データの画面と同じ読み方：loadTransferPlan） */
  transfer: {
    batches: number;
    people: number;
    total: number;
    executed: number;
    /** 作ったあとに明細が変わり、まだ振り込んでいない振込データ（取り消して作り直す） */
    changed: number;
    /** 振り込んだあとに明細が変わり、振り込んだ額との差にまだ精算の記録が無い人を含む振込データ（振込データの画面で精算の仕方を記録する） */
    changedExecuted: number;
    /** 振込データに入れられる人（口座があり、振込額が 1 円以上） */
    includable: number;
    /** 振込データに入れられるのに、まだどの振込データにも入っていない人と、その合計 */
    notInBatch: number;
    notInBatchTotal: number;
    /** 振込データに入らない人（口座が無い・口座の形が違う・振込額が 0 円以下） */
    excluded: { name: string; reason: "no_bank" | "bank_invalid" | "not_positive" }[];
    latestTransferDate: string | null;
  };
  /** 振込額の合計（開いている月は今の見込み、締めた月は保存した明細） */
  totals: { drivers: number; total: number; source: "calc" | "saved" };
  /** 今月の会社の利益 */
  profit: { sales: number; subtotal: number; profit: number; source: "calc" | "snapshot" };
  /**
   * 元請との突合（突合の画面と同じ読み方：差は今の記録で出し、状態は保存したもの。まだ突き合わせていない通知も数える）。
   * items は差の数（片付いたものも含む）、openItems・short・over は未対応と問い合わせ済みの差。
   * unread は行を読み取れていない（比べられない）支払通知の数。error は突合を読めなかったとき
   */
  reconcile: { notices: number; items: number; openItems: number; openDiff: number; short: number; over: number; unread: number; error: string | null };
  /** ドライバーからの、まだ解決していない質問 */
  questions: { count: number; items: { statementId: string; driverName: string; body: string; createdAt: Date }[] };
  onboarding: OnboardingProgress;
  /**
   * 見つけたお金（この月の元請の支払通知との突合）。確定と見込みは別の数で、足し合わせない（SPEC P1-1.2・親切の約束 社長 2）
   * - confirmed：「解決」にして取り戻せた額を入れた差の合計（確定。reconciliation_items.recovered_amount）
   * - estimated：未対応・問い合わせ済みの差のうち、支払通知が当社の記録より少ない差の額の合計（見込み。まだ決まったお金ではない）
   * 利益の画面・社長の 1 枚と同じ関数（foundFromCells）で数える
   */
  found: { confirmed: number; confirmedCount: number; estimated: number; estimatedCount: number };
  /**
   * 免税の方への支払で、会社がかぶる消費税（インボイスの経過措置）。
   * current は今月の額（明細の invoiceBurden の合計）、next は次の段階からの月の目安（同じ稼働が続いた場合）
   */
  burden: {
    affected: boolean;
    people: number;
    current: number;
    next: { from: string; label: string; monthly: number; diffMonthly: number } | null;
  };
  /** 取引条件の明示：この月に稼働した人のうち、明示した記録（明示書か、明示した日）が見つからない人 */
  terms: { worked: number; missing: { driverId: string; name: string }[] };
  /** 本番に切り替えた月（YYYY-MM-01。まだ Excel と並べているなら null） */
  golive: string | null;
};
