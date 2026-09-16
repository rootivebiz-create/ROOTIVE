import type { Database, Tables, Views, Enums } from "./database.types";

export type { Database, Tables, Views, Enums };

export type Role = Enums<"user_role">;
export type RoundingMode = Enums<"rounding_mode">;
export type Unit = Enums<"item_unit">;
export type MonthStatus = Enums<"month_status">;

export type Company = Tables<"companies">;
export type Profile = Tables<"profiles">;
export type Invitation = Tables<"invitations">;
export type Driver = Tables<"drivers">;
export type Project = Tables<"projects">;
export type ProjectItem = Tables<"project_items">;
export type DriverPayOverride = Tables<"driver_pay_overrides">;
export type DriverRecurringAdjustment = Tables<"driver_recurring_adjustments">;
export type WorkEntry = Tables<"work_entries">;
export type DriverMonth = Tables<"driver_months">;
export type Adjustment = Tables<"adjustments">;
export type MonthClosing = Tables<"month_closings">;
export type AuditLog = Tables<"audit_logs">;
export type AiInsight = Tables<"ai_insights">;

export type WorkEntryCalc = Views<"v_work_entry_calc">;
export type DriverMonthSummary = Views<"v_driver_month_summary">;
export type MonthSummary = Views<"v_month_summary">;
export type ProjectSummary = Views<"v_project_summary">;
export type MonthListRow = Views<"v_month_list">;

/** 稼働行のスナップショットと現在のマスタの差分（RPC rate_diffs の 1 行） */
export type RateDiff = Database["public"]["Functions"]["rate_diffs"]["Returns"][number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "オーナー",
  admin: "管理者",
  viewer: "閲覧者",
  driver: "ドライバー",
};

/** 案件 ＋ 内容（マスタ読み込み用） */
export type ProjectWithItems = Project & { items: ProjectItem[] };

/** 稼働入力ダイアログなどで使うマスタ一式 */
export interface Masters {
  company: Company;
  drivers: Driver[];
  projects: ProjectWithItems[];
  overrides: DriverPayOverride[];
}
