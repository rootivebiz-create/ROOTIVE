import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  MANAGEMENT_VIEW_ROLES,
  MANAGER_ROLES,
  STAFF_ROLES,
  canEdit,
  canManage,
  canSeeManagement,
  homeFor,
} from "@/lib/auth/session";
import { MANAGEMENT_ALERT_CODES, ALERT_CODES, isManagementAlert } from "@/lib/alerts/helpers";
import { ROLE_LABELS } from "@/lib/db/types";

/**
 * 事務員（clerk・0027）のロールの線引き。DB の is_admin / is_manager / can_see_management と同じ線をアプリ側でも引く。
 * RLS そのものは SQL のテスト（§34）で確かめる。
 */
describe("ロールの線引き", () => {
  it("事務員は登録・編集ができる（ADMIN_ROLES）が、経営の設定（MANAGER_ROLES）と経営の数字（MANAGEMENT_VIEW_ROLES）には入らない", () => {
    expect(ADMIN_ROLES).toEqual(["owner", "admin", "clerk"]);
    expect(MANAGER_ROLES).toEqual(["owner", "admin"]);
    expect(MANAGEMENT_VIEW_ROLES).toEqual(["owner", "admin", "viewer"]);
    expect(STAFF_ROLES).toContain("clerk");
    expect(STAFF_ROLES).not.toContain("driver");
  });

  it("canEdit / canManage / canSeeManagement", () => {
    expect([canEdit("clerk"), canManage("clerk"), canSeeManagement("clerk")]).toEqual([true, false, false]);
    expect([canEdit("admin"), canManage("admin"), canSeeManagement("admin")]).toEqual([true, true, true]);
    expect([canEdit("owner"), canManage("owner"), canSeeManagement("owner")]).toEqual([true, true, true]);
    // 閲覧者は経営の数字を見られるが、編集はできない
    expect([canEdit("viewer"), canManage("viewer"), canSeeManagement("viewer")]).toEqual([false, false, true]);
    expect([canEdit("driver"), canManage("driver"), canSeeManagement("driver")]).toEqual([false, false, false]);
  });

  it("入れない画面から戻す先：事務員は事務、ドライバーはポータル、ほかはホーム", () => {
    expect(homeFor("clerk")).toBe("/office");
    expect(homeFor("driver")).toBe("/driver");
    expect(homeFor("viewer")).toBe("/dashboard");
    expect(homeFor("owner")).toBe("/dashboard");
  });

  it("表示名は日本語", () => {
    expect(ROLE_LABELS.clerk).toBe("事務員");
  });
});

describe("経営のアラート（事務員に見せない）", () => {
  it("一覧はすべて実在する code で、DB の is_management_alert と同じ 8 種類", () => {
    expect(MANAGEMENT_ALERT_CODES).toHaveLength(8);
    for (const code of MANAGEMENT_ALERT_CODES) expect(ALERT_CODES).toContain(code);
  });

  it("事務の仕事に関わるアラートは経営のアラートではない", () => {
    expect(isManagementAlert("margin_drop")).toBe(true);
    expect(isManagementAlert("cash_short")).toBe(true);
    expect(isManagementAlert("qty_zero")).toBe(false);
    expect(isManagementAlert("document_expired")).toBe(false);
    expect(isManagementAlert("bank_account_missing")).toBe(false);
    expect(isManagementAlert(null)).toBe(false);
  });
});
