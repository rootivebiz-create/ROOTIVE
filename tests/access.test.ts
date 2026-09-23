import { describe, expect, it } from "vitest";
import {
  ACCESS_KEYS,
  buildAccessOverrides,
  canCustomizeAccess,
  effectiveAccess,
  isAccessMoot,
  overrideCount,
  roleAccess,
  seesManagement,
  staffHome,
  toAccessOverrides,
} from "@/lib/auth/access";
import { DEFAULT_CONFIDENTIAL_SCOPE, type ConfidentialScope } from "@/lib/db/types";

/**
 * ユーザーごとの見せる範囲（0029）。DB の can_see_management / can_see_confidential / can_export と同じ判定をアプリ側で持つ。
 * RLS そのものは SQL のテスト（§35）で確かめる。
 */
describe("ロールの既定（上書きなし）", () => {
  it("経営の数字は owner・admin・viewer。事務員とドライバーは見ない", () => {
    expect(roleAccess("owner").management).toBe(true);
    expect(roleAccess("admin").management).toBe(true);
    expect(roleAccess("viewer").management).toBe(true);
    expect(roleAccess("clerk").management).toBe(false);
    expect(roleAccess("driver").management).toBe(false);
  });

  it("機密は会社の見せ方どおり（既定は管理者まで）", () => {
    expect(roleAccess("admin")).toMatchObject({ loans: true, cash: true, bank_account: true });
    expect(roleAccess("clerk")).toMatchObject({ loans: false, cash: false, bank_account: false });
    expect(roleAccess("viewer")).toMatchObject({ loans: false, cash: false, bank_account: false });
    const scope: ConfidentialScope = { ...DEFAULT_CONFIDENTIAL_SCOPE, bank_account: "clerk", cash: "owner" };
    expect(roleAccess("clerk", scope).bank_account).toBe(true);
    expect(roleAccess("admin", scope).cash).toBe(false);
    expect(roleAccess("owner", scope).cash).toBe(true);
  });

  it("出力はスタッフ全員。ドライバーは会社の出力をしない", () => {
    for (const r of ["owner", "admin", "clerk", "viewer"] as const) expect(roleAccess(r).export).toBe(true);
    expect(roleAccess("driver").export).toBe(false);
  });
});

describe("人ごとの上書き", () => {
  it("読み取りは知らないキー・値を捨てる", () => {
    expect(toAccessOverrides({ management: "deny", cash: "allow", payroll: "allow", loans: "yes" })).toEqual({ management: "deny", cash: "allow" });
    expect(toAccessOverrides(null)).toEqual({});
    expect(toAccessOverrides("deny")).toEqual({});
    expect(toAccessOverrides(["management"])).toEqual({});
  });

  it("管理者・事務員・閲覧者には効く", () => {
    expect(canCustomizeAccess("admin") && canCustomizeAccess("clerk") && canCustomizeAccess("viewer")).toBe(true);
    // 閲覧者から経営の数字と出力を外す
    expect(effectiveAccess("viewer", { management: "deny", export: "deny" })).toMatchObject({ management: false, export: false });
    // 事務員に経営の数字と振込口座を見せる
    expect(effectiveAccess("clerk", { management: "allow", bank_account: "allow" })).toMatchObject({ management: true, bank_account: true, loans: false });
    // 管理者から借入だけ外す
    expect(effectiveAccess("admin", { loans: "deny" })).toEqual({ management: true, loans: false, cash: true, bank_account: true, export: true });
  });

  it("代表とドライバーには効かない（代表は常にすべて・ドライバーは会社の数字を見ない）", () => {
    expect(canCustomizeAccess("owner") || canCustomizeAccess("driver")).toBe(false);
    const allDeny = Object.fromEntries(ACCESS_KEYS.map((k) => [k, "deny"]));
    const allAllow = Object.fromEntries(ACCESS_KEYS.map((k) => [k, "allow"]));
    expect(Object.values(effectiveAccess("owner", allDeny)).every(Boolean)).toBe(true);
    expect(Object.values(effectiveAccess("driver", allAllow)).some(Boolean)).toBe(false);
    expect(overrideCount("owner", allDeny)).toBe(0);
  });

  it("保存する上書きは、ロールの既定と違う選択だけ", () => {
    // 閲覧者：経営の数字は既定で見える → 「見せる」は保存しない。「見せない」は保存する
    expect(buildAccessOverrides("viewer", { management: "allow" })).toEqual({});
    expect(buildAccessOverrides("viewer", { management: "deny", loans: "allow", cash: "role" })).toEqual({ management: "deny", loans: "allow" });
    // 事務員：振込口座は既定で見えない → 「見せない」は保存しない
    expect(buildAccessOverrides("clerk", { bank_account: "deny", management: "allow" })).toEqual({ management: "allow" });
    // 会社の見せ方が「事務員まで」なら、事務員の振込口座は既定で見える
    const scope: ConfidentialScope = { ...DEFAULT_CONFIDENTIAL_SCOPE, bank_account: "clerk" };
    expect(buildAccessOverrides("clerk", { bank_account: "allow" }, scope)).toEqual({});
    expect(buildAccessOverrides("clerk", { bank_account: "deny" }, scope)).toEqual({ bank_account: "deny" });
    // 代表・ドライバーには何も保存しない
    expect(buildAccessOverrides("owner", { management: "deny" })).toEqual({});
    expect(buildAccessOverrides("driver", { management: "allow" })).toEqual({});
  });

  it("一覧の「個別の設定 N」", () => {
    expect(overrideCount("viewer", { management: "deny", export: "deny" })).toBe(2);
    expect(overrideCount("admin", {})).toBe(0);
  });

  it("借入・現金は、経営の数字が見えないと見る場所が無い", () => {
    const a = effectiveAccess("viewer", { management: "deny", loans: "allow" });
    expect(isAccessMoot("loans", a)).toBe(true);
    expect(isAccessMoot("bank_account", a)).toBe(false);
    expect(isAccessMoot("loans", effectiveAccess("admin", {}))).toBe(false);
  });

  it("サービスロールで宛先を選ぶときも同じ判定", () => {
    expect(seesManagement({ role: "clerk" })).toBe(false);
    expect(seesManagement({ role: "clerk", access_overrides: { management: "allow" } })).toBe(true);
    expect(seesManagement({ role: "viewer", access_overrides: { management: "deny" } })).toBe(false);
    expect(seesManagement({ role: "owner", access_overrides: { management: "deny" } })).toBe(true);
  });
});

describe("最初に行く画面", () => {
  it("ドライバーはポータル、事務員はいつも事務", () => {
    expect(staffHome("driver", { management: false })).toBe("/driver");
    expect(staffHome("clerk", { management: false })).toBe("/office");
    expect(staffHome("clerk", { management: true }, "dashboard")).toBe("/office");
  });

  it("経営の数字を見る人は最初に開く画面のとおり（事務は編集できる人だけ）", () => {
    expect(staffHome("admin", { management: true })).toBe("/dashboard");
    expect(staffHome("admin", { management: true }, "office")).toBe("/office");
    expect(staffHome("owner", { management: true }, "office")).toBe("/office");
    expect(staffHome("viewer", { management: true }, "office")).toBe("/dashboard");
  });

  it("経営の数字を見せない設定の人はホームへ行かない", () => {
    expect(staffHome("admin", { management: false }, "dashboard")).toBe("/office");
    expect(staffHome("viewer", { management: false })).toBe("/entries");
  });
});
