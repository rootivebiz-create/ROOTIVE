/**
 * 車両・書類・安全管理のダイアログで使う選択肢（ドライバー・車両）。
 * 選択肢の絞り込み（稼働中のみ＋選択中は残す）は経費ダイアログと同じ純関数を使う。
 */
import { optionsWithSelected, type ChoiceOption } from "@/components/expenses/helpers";

export { optionsWithSelected };
export type { ChoiceOption };

export interface FleetChoices {
  /** ドライバー（停止中も含む。選択肢は optionsWithSelected で絞る） */
  drivers: ChoiceOption[];
  /** 車両（name は車両番号） */
  vehicles: ChoiceOption[];
}

export const inactiveSuffix = (active: boolean) => (active ? "" : "（停止中）");

/** ID から表示名を引く（見つからなければ ""） */
export function nameOf(options: ChoiceOption[], id: string): string {
  if (!id) return "";
  return options.find((o) => o.id === id)?.name ?? "";
}
