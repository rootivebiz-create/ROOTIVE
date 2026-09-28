/**
 * 見張り番の指摘の形（締め・ホーム・明細の画面が共通で読む）。
 * 見張り番は「記録から分かること」と「確認をおすすめ」までを出す。適法・違反の判定はしない。
 */
export type WatchSeverity = "red" | "yellow" | "info";

export type WatchIssue = {
  /** 指摘の種類（例：terms_missing・fee_deducted）。確認済みの記録（watch_acks）のキーにもなる */
  code: string;
  severity: WatchSeverity;
  /** 短い見出し（例：「取引条件を明示した記録がありません」） */
  title: string;
  /** 記録から見えること（数字・日付つき） */
  detail: string;
  /** 誰・何についてか（driverId・ruleId・projectId・"tenant"） */
  subjectId: string;
  subjectLabel: string;
  /** 根拠（例：「フリーランス法 第3条」）と出典 */
  basis?: string;
  sourceUrl?: string;
  /** 直す画面へのリンク（?m= 付き） */
  fixHref?: string;
  /** 確認済み（watch_acks にある）か */
  acked: boolean;
  ackNote?: string | null;
  /** 締めを止めるか（red で、まだ確認済みにしていないもの） */
  blocksClose: boolean;
  /** 影響額（円。出せないものは null とその理由）。指摘どうしで重なることがあるので足し合わせない */
  impact?: { yen: number | null; label: string };
  /** ルールの前提にした情報の時点（例：「2026年9月」） */
  asOf?: string;
};
