/** 業務委託ドライバーの月次精算（デモ）で使う型。金額はすべて円、単価と管理費は税抜。 */

export type Rounding = "floor" | "round" | "ceil";

export type AccountType = "ordinary" | "checking";

export type BankAccount = {
  /** 金融機関コード（4 桁） */
  bankCode: string;
  /** 金融機関名（半角カナ） */
  bankNameKana: string;
  /** 支店コード（3 桁） */
  branchCode: string;
  /** 支店名（半角カナ） */
  branchNameKana: string;
  accountType: AccountType;
  /** 口座番号（7 桁まで） */
  accountNumber: string;
  /** 口座名義（カナ。全角で入れても半角に直す） */
  holderKana: string;
};

export type Driver = {
  id: string;
  name: string;
  /** 適格請求書発行事業者（インボイス登録済み）か */
  invoiceRegistered: boolean;
  /** 登録番号（T＋13 桁）。登録済みのときだけ */
  registrationNo?: string;
  /** 管理費（月額・税抜）。その月に稼働があるときだけ差し引く */
  monthlyFee: number;
  /** ロイヤリティ率（0.1 = 10%）。委託料（税抜）に掛ける */
  royaltyRate: number;
  bank?: BankAccount;
};

export type Project = {
  id: string;
  name: string;
  /** 元請（荷主） */
  client: string;
  /** 数量の単位（日・個・時間・件など） */
  unit: string;
  /** 受注単価（税抜） */
  billRate: number;
  /** 支払単価（税抜） */
  payRate: number;
};

export type WorkRow = { driverId: string; projectId: string; qty: number };

/** 立替金の精算・事故の負担など、消費税の対象外として足し引きするもの（＋は支払を増やす） */
export type Adjustment = { driverId: string; label: string; amount: number };

export type CompanySettings = {
  companyName: string;
  /** 会社の登録番号（T＋13 桁） */
  companyRegistrationNo?: string;
  /** 消費税率（0.1 = 10%） */
  taxRate: number;
  /** 消費税の端数処理（既定：切り捨て） */
  taxRounding: Rounding;
  /** 金額（単価×数量・ロイヤリティ）の端数処理 */
  amountRounding: Rounding;
  /** 免税の方にも消費税相当額を払うか（既定：払う） */
  payTaxToExempt: boolean;
  /** 会社の消費税の計算方法。原則課税のときだけ、免税の方への支払で控除できない分が出る */
  taxMethod: "general" | "simplified";
  /** 支払明細の対象月（YYYY-MM） */
  month: string;
  /** 振込日（YYYY-MM-DD） */
  payDate: string;
};

export type MonthData = {
  settings: CompanySettings;
  drivers: Driver[];
  projects: Project[];
  work: WorkRow[];
  adjustments: Adjustment[];
};
