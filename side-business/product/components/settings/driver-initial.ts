import type { DriverRow } from "~/server/features/settings/drivers";

/** ドライバーの入力欄の最初の値（画面の部品へ渡す形。すべて文字か真偽） */
export type DriverInitial = {
  id?: string;
  code: string;
  name: string;
  kana: string;
  aliases: string;
  email: string;
  phone: string;
  invoiceRegistered: boolean;
  registrationNo: string;
  registrationCheckedOn: string;
  isCorporation: boolean;
  withholdingCategory: string;
  bankCode: string;
  bankNameKana: string;
  branchCode: string;
  branchNameKana: string;
  accountType: "ordinary" | "checking";
  accountNumber: string;
  holderKana: string;
  termsIssuedOn: string;
  startedOn: string;
  endOn: string;
  endNoticedOn: string;
  active: boolean;
  notes: string;
};

export const EMPTY_DRIVER: DriverInitial = {
  code: "",
  name: "",
  kana: "",
  aliases: "",
  email: "",
  phone: "",
  invoiceRegistered: false,
  registrationNo: "",
  registrationCheckedOn: "",
  isCorporation: false,
  withholdingCategory: "none",
  bankCode: "",
  bankNameKana: "",
  branchCode: "",
  branchNameKana: "",
  accountType: "ordinary",
  accountNumber: "",
  holderKana: "",
  termsIssuedOn: "",
  startedOn: "",
  endOn: "",
  endNoticedOn: "",
  active: true,
  notes: "",
};

/** 台帳の行 → 入力欄の最初の値 */
export function toDriverInitial(d: DriverRow): DriverInitial {
  return {
    id: d.id,
    code: d.code ?? "",
    name: d.name,
    kana: d.kana ?? "",
    aliases: d.aliases.join("、"),
    email: d.email ?? "",
    phone: d.phone ?? "",
    invoiceRegistered: d.invoiceRegistered,
    registrationNo: d.registrationNo ?? "",
    registrationCheckedOn: d.registrationCheckedOn ?? "",
    isCorporation: d.isCorporation,
    withholdingCategory: d.withholdingCategory,
    bankCode: d.bankCode ?? "",
    bankNameKana: d.bankNameKana ?? "",
    branchCode: d.branchCode ?? "",
    branchNameKana: d.branchNameKana ?? "",
    accountType: d.accountType === "checking" ? "checking" : "ordinary",
    accountNumber: d.accountNumber ?? "",
    holderKana: d.holderKana ?? "",
    termsIssuedOn: d.termsIssuedOn ?? "",
    startedOn: d.startedOn ?? "",
    endOn: d.endOn ?? "",
    endNoticedOn: d.endNoticedOn ?? "",
    active: d.active,
    notes: d.notes ?? "",
  };
}
