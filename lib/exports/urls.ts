/** 出力系エンドポイントの URL（画面から参照する。実装は app/api/export/*） */
export const exportUrls = {
  /** 稼働明細 CSV。month は "YYYY-MM" または "all" */
  entriesCsv: (month: string) => `/api/export/entries.csv?m=${encodeURIComponent(month)}`,
  /** 支払一覧 CSV。month は "YYYY-MM" または "all" */
  payoutsCsv: (month: string) => `/api/export/payouts.csv?m=${encodeURIComponent(month)}`,
  /** 個人明細 CSV */
  statementCsv: (month: string, driverId: string) => `/api/export/statement.csv?m=${encodeURIComponent(month)}&driver=${encodeURIComponent(driverId)}`,
  /** PDF 支払明細（A4 縦）。driver ロールは自分の締め済み月のみ */
  statementPdf: (month: string, driverId: string) => `/api/export/statement.pdf?m=${encodeURIComponent(month)}&driver=${encodeURIComponent(driverId)}`,
  /** 印刷用ページ（ブラウザ印刷） */
  statementPrint: (month: string, driverId: string) => `/payouts/${encodeURIComponent(driverId)}/print?m=${encodeURIComponent(month)}`,
  /** 弥生会計 仕訳インポート CSV（Shift_JIS） */
  yayoiCsv: (month: string) => `/api/export/yayoi.csv?m=${encodeURIComponent(month)}`,
  /** バックアップ JSON（全テーブル） */
  backupJson: () => `/api/export/backup.json`,
  /** 締め時バックアップのダウンロード（Storage の署名付き URL へリダイレクト） */
  monthBackup: (month: string) => `/api/export/month-backup?m=${encodeURIComponent(month)}`,
};
