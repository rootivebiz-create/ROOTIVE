import type { Role } from "@/lib/db/types";

/**
 * ロールに応じた画面の出し分け（純関数）。
 *
 * ナビ（`components/layout/nav.tsx`）・コマンドパレット（`app/(app)/layout.tsx`）・
 * 設定の一覧（`app/(app)/settings/page.tsx`）で同じ判定を使う。
 * これは「見せない」だけの判定なので、実際の拒否は各画面の `requirePageRole()` と
 * Server Action・RLS でも必ず行うこと（CLAUDE.md §2 の二重の確認）。
 */

/** 出し分けの指定（複数付いているときは ownerOnly → managerOnly → adminOnly の順に強い） */
export interface RoleVisibility {
  /** 代表（owner）だけに出す */
  ownerOnly?: boolean;
  /** 経営の設定ができるロール（owner・admin）だけに出す（外部連携・監査ログなど） */
  managerOnly?: boolean;
  /** 登録・編集ができるロール（owner・admin・事務員）だけに出す */
  adminOnly?: boolean;
  /** 経営の数字を出す画面なので事務員には出さない（ホーム・資金繰り・財務・レポートなど） */
  noClerk?: boolean;
}

/**
 * 登録・編集ができるロール。`lib/auth/session.ts` の `ADMIN_ROLES` と同じ内容。
 * あちらは `server-only` のためクライアント（ナビ）から読めないので、ここに持つ。
 * （以前は `role !== "viewer"` で判定していて driver も通っていた）
 */
export const NAV_ADMIN_ROLES: Role[] = ["owner", "admin", "clerk"];
/** 経営の設定ができるロール（`MANAGER_ROLES` と同じ） */
export const NAV_MANAGER_ROLES: Role[] = ["owner", "admin"];

/** この項目をこのロールに出すか。role を省略したときは今までどおり全部出す */
export function isVisibleForRole(item: RoleVisibility, role?: Role): boolean {
  if (!role) return true;
  if (item.noClerk && role === "clerk") return false;
  if (item.ownerOnly) return role === "owner";
  if (item.managerOnly) return NAV_MANAGER_ROLES.includes(role);
  if (item.adminOnly) return NAV_ADMIN_ROLES.includes(role);
  return true;
}

/** ロールに出す項目だけを元の順のまま返す（元の配列は壊さない） */
export function visibleForRole<T extends RoleVisibility>(items: readonly T[], role?: Role): T[] {
  return items.filter((item) => isVisibleForRole(item, role));
}
