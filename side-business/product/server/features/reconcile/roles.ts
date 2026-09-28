/**
 * お支払通知の列の役割（品目・数量・単価・金額・ドライバー・日付）。
 * 画面の部品（client）からも読むので、ほかのモジュール（Excel の読み取りなど）を読み込まない。
 */
export type ColumnRole = "item" | "qty" | "unitPrice" | "amount" | "driver" | "date";

export const COLUMN_ROLES: ColumnRole[] = ["item", "qty", "unitPrice", "amount", "driver", "date"];

export const ROLE_LABEL: Record<ColumnRole, string> = {
  item: "品目（案件・内容）",
  qty: "数量",
  unitPrice: "単価",
  amount: "金額",
  driver: "ドライバー",
  date: "日付",
};

/** 列の番号（0 始まり）。無い列は null */
export type ColumnMap = Record<ColumnRole, number | null>;

export const EMPTY_COLUMNS: ColumnMap = { item: null, qty: null, unitPrice: null, amount: null, driver: null, date: null };
