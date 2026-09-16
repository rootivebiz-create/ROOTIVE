/**
 * 弥生会計 仕訳インポート用の勘定科目マッピング（companies.yayoi_accounts に保存。会社設定画面で変更可）
 * §8.2：売上＝借方 売掛金／貸方 売上高、外注費＝借方 外注費／貸方 未払金、
 *       ロイヤリティ・管理費・調整（利益計上）＝借方 未払金／貸方 雑収入（補助科目で区別）、利益計上なしの調整＝立替金
 */
export interface YayoiAccounts {
  /** 売上：借方 */
  sales_debit: string;
  /** 売上：貸方 */
  sales_credit: string;
  /** 外注費：借方 */
  outsourcing_debit: string;
  /** 外注費：貸方（未払金） */
  outsourcing_credit: string;
  /** ロイヤリティ：貸方 */
  royalty_credit: string;
  royalty_sub: string;
  /** 管理費：貸方 */
  mgmt_credit: string;
  mgmt_sub: string;
  /** 利益計上の調整：貸方 */
  adj_profit_credit: string;
  adj_profit_sub: string;
  /** 利益計上なしの調整（立替精算など）の相手科目 */
  adj_nonprofit_account: string;
  /** 税区分 */
  tax_class_sales: string;
  tax_class_purchase: string;
  tax_class_none: string;
  /** 摘要にドライバー名を入れ、ドライバーごとに仕訳を分ける（false なら月合計 1 行） */
  split_by_driver: boolean;
  /** 伝票日付：稼動月の末日（"month_end"）か振込予定日（"payout_date"） */
  date_basis: "month_end" | "payout_date";
}

export const DEFAULT_YAYOI_ACCOUNTS: YayoiAccounts = {
  sales_debit: "売掛金",
  sales_credit: "売上高",
  outsourcing_debit: "外注費",
  outsourcing_credit: "未払金",
  royalty_credit: "雑収入",
  royalty_sub: "ロイヤリティ",
  mgmt_credit: "雑収入",
  mgmt_sub: "管理費",
  adj_profit_credit: "雑収入",
  adj_profit_sub: "調整",
  adj_nonprofit_account: "立替金",
  tax_class_sales: "課税売上込10%",
  tax_class_purchase: "課対仕入込10%",
  tax_class_none: "対象外",
  split_by_driver: true,
  date_basis: "month_end",
};

export const YAYOI_ACCOUNT_LABELS: Record<keyof YayoiAccounts, string> = {
  sales_debit: "売上：借方科目",
  sales_credit: "売上：貸方科目",
  outsourcing_debit: "外注費：借方科目",
  outsourcing_credit: "外注費：貸方科目（未払金）",
  royalty_credit: "ロイヤリティ：貸方科目",
  royalty_sub: "ロイヤリティ：補助科目",
  mgmt_credit: "管理費：貸方科目",
  mgmt_sub: "管理費：補助科目",
  adj_profit_credit: "調整（利益計上）：貸方科目",
  adj_profit_sub: "調整（利益計上）：補助科目",
  adj_nonprofit_account: "調整（利益計上なし）：相手科目",
  tax_class_sales: "税区分（売上）",
  tax_class_purchase: "税区分（仕入）",
  tax_class_none: "税区分（対象外）",
  split_by_driver: "ドライバーごとに仕訳を分ける",
  date_basis: "伝票日付の基準",
};

/** companies.yayoi_accounts（jsonb）から設定を取り出す（欠けたキーは既定値） */
export function resolveYayoiAccounts(json: unknown): YayoiAccounts {
  const src = (json && typeof json === "object" ? json : {}) as Partial<YayoiAccounts>;
  const out: YayoiAccounts = { ...DEFAULT_YAYOI_ACCOUNTS };
  for (const key of Object.keys(DEFAULT_YAYOI_ACCOUNTS) as (keyof YayoiAccounts)[]) {
    const v = src[key];
    if (v == null) continue;
    if (key === "split_by_driver") {
      if (typeof v === "boolean") out.split_by_driver = v;
    } else if (key === "date_basis") {
      if (v === "month_end" || v === "payout_date") out.date_basis = v;
    } else if (typeof v === "string" && v.trim() !== "") {
      (out as unknown as Record<string, string>)[key] = v.trim();
    }
  }
  return out;
}
