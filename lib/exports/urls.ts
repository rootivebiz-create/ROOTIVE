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
  /** 全ドライバーの PDF 支払明細をまとめた ZIP（スタッフのみ） */
  statementsZip: (month: string) => `/api/export/statements.zip?m=${encodeURIComponent(month)}`,
  /** 弥生会計 仕訳インポート CSV（Shift_JIS） */
  yayoiCsv: (month: string) => `/api/export/yayoi.csv?m=${encodeURIComponent(month)}`,
  /** 単価表 CSV（稼働中のドライバー × 案件内容の実効単価と出所） */
  ratesCsv: () => "/api/export/rates.csv",
  /** 経費 CSV（その月の経費明細） */
  expensesCsv: (month: string) => `/api/export/expenses.csv?m=${encodeURIComponent(month)}`,
  /** 案件別採算 CSV。month は "YYYY-MM" または "all" */
  projectsCsv: (month: string) => `/api/export/projects.csv?m=${encodeURIComponent(month)}`,
  /** 資金繰り CSV（期間内の入金・支払の明細と残高） */
  cashflowCsv: (from: string, to: string) => `/api/export/cashflow.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  /** 請求書 PDF（A4 縦） */
  invoicePdf: (invoiceId: string) => `/api/export/invoice.pdf?id=${encodeURIComponent(invoiceId)}`,
  /** 請求書の印刷用ページ */
  invoicePrint: (invoiceId: string) => `/invoices/${encodeURIComponent(invoiceId)}/print`,
  /** 請求書一覧 CSV。month は "YYYY-MM" または "all" */
  invoicesCsv: (month: string) => `/api/export/invoices.csv?m=${encodeURIComponent(month)}`,
  /** 年次レポート CSV（月次推移）。year は西暦 4 桁 */
  reportCsv: (year: number) => `/api/export/report.csv?y=${encodeURIComponent(String(year))}`,
  /** ドライバー別の採算 CSV（その月。inactive で停止中も含める） */
  driversPlCsv: (month: string, includeInactive = false) => `/api/export/drivers-pl.csv?m=${encodeURIComponent(month)}${includeInactive ? "&inactive=1" : ""}`,
  /** バックアップ JSON（全テーブル） */
  backupJson: () => `/api/export/backup.json`,
  /** 締め時バックアップのダウンロード（Storage の署名付き URL へリダイレクト） */
  monthBackup: (month: string) => `/api/export/month-backup?m=${encodeURIComponent(month)}`,
};
