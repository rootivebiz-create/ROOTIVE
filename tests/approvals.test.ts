import { describe, expect, it } from "vitest";
import {
  approvalKindSchema,
  approvalRuleSchema,
  companyProfileSchema,
  confidentialScopeSchema,
  decideApprovalSchema,
  decisionReviewSchema,
  decisionSchema,
  delegationSchema,
  planSchema,
  planYearSchema,
  requestApprovalSchema,
  spreadPlanYearSchema,
  withdrawApprovalSchema,
  APPROVAL_KINDS,
} from "@/lib/schemas/executive";
import { sortApprovals, sortExecutiveTasks } from "@/lib/executive/queries";
import { canSeeConfidential, toConfidentialScope, APPROVAL_KIND_LABELS, EXPORT_KIND_LABELS, type ApprovalRow, type ExecutiveTask } from "@/lib/db/types";

/**
 * 決裁（0019・0020）の純関数のテスト。
 * Server Action と DB の RPC そのものは SQL のテスト（tests/sql）と E2E に任せ、
 * ここでは「アプリ側で書いた判断」＝ zod スキーマと並び替えだけを固める。
 */

const UUID = "11111111-2222-4333-8444-555555555555";
const UUID2 = "66666666-7777-4888-9999-000000000000";

// ---------------------------------------------------------------------------
// 申請
// ---------------------------------------------------------------------------

describe("requestApprovalSchema", () => {
  it("件名だけで成り立ち、省略した欄は空・null になる", () => {
    const v = requestApprovalSchema.parse({ kind: "expense", title: "  事務所の複合機  " });
    expect(v.kind).toBe("expense");
    expect(v.title).toBe("事務所の複合機"); // 前後の空白は落とす
    expect(v.detail).toBe("");
    expect(v.ref_table).toBe("");
    expect(v.ref_id).toBe("");
    expect(v.href).toBe("");
    expect(v.amount).toBeNull();
    expect(v.due_on).toBeNull();
  });

  it("金額は全角・カンマ入りでも数値になり、空欄は null（＝金額を問わない申請）", () => {
    expect(requestApprovalSchema.parse({ kind: "expense", title: "x", amount: "３５０，０００" }).amount).toBe(350_000);
    expect(requestApprovalSchema.parse({ kind: "expense", title: "x", amount: "1,200.50" }).amount).toBe(1200.5);
    expect(requestApprovalSchema.parse({ kind: "expense", title: "x", amount: "" }).amount).toBeNull();
  });

  it("件名は必須で、200 文字を超えると弾く", () => {
    expect(requestApprovalSchema.safeParse({ kind: "other", title: "   " }).success).toBe(false);
    expect(requestApprovalSchema.safeParse({ kind: "other", title: "あ".repeat(201) }).success).toBe(false);
    expect(requestApprovalSchema.safeParse({ kind: "other", title: "あ".repeat(200) }).success).toBe(true);
  });

  it("種別は DB の approval_kind と同じ並びで、ラベルが全種別にある", () => {
    expect(APPROVAL_KINDS).toEqual(["expense", "rate_change", "project", "contract", "loan", "month_reopen", "payout", "purchase", "hire", "other"]);
    for (const k of APPROVAL_KINDS) expect(APPROVAL_KIND_LABELS[k]).toBeTruthy();
    expect(approvalKindSchema.safeParse("unknown").success).toBe(false);
  });

  it("期限は YYYY-MM-DD のみ", () => {
    expect(requestApprovalSchema.parse({ kind: "other", title: "x", due_on: "2026-09-30" }).due_on).toBe("2026-09-30");
    expect(requestApprovalSchema.safeParse({ kind: "other", title: "x", due_on: "2026/09/30" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 決裁・取り下げ
// ---------------------------------------------------------------------------

describe("decideApprovalSchema", () => {
  it("承認は理由なしでよい。意思決定ログを作るかの既定は false", () => {
    const v = decideApprovalSchema.parse({ id: UUID, approve: true });
    expect(v.approve).toBe(true);
    expect(v.note).toBe("");
    expect(v.as_decision).toBe(false);
  });

  it("却下は理由が要る（空白だけも不可）", () => {
    expect(decideApprovalSchema.safeParse({ id: UUID, approve: false }).success).toBe(false);
    expect(decideApprovalSchema.safeParse({ id: UUID, approve: false, note: "   " }).success).toBe(false);
    const ok = decideApprovalSchema.safeParse({ id: UUID, approve: false, note: "今期は見送り" });
    expect(ok.success).toBe(true);
  });

  it("却下の理由が無いときは note の欄にエラーを出す", () => {
    const res = decideApprovalSchema.safeParse({ id: UUID, approve: false, note: "" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.path).toEqual(["note"]);
  });

  it("id は uuid のみ", () => {
    expect(decideApprovalSchema.safeParse({ id: "abc", approve: true }).success).toBe(false);
    expect(withdrawApprovalSchema.safeParse({ id: "abc" }).success).toBe(false);
    expect(withdrawApprovalSchema.parse({ id: UUID }).note).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 決裁のルールと委任
// ---------------------------------------------------------------------------

describe("approvalRuleSchema", () => {
  it("しきい値の空欄は null（＝金額を問わず必ず決裁が要る）", () => {
    const v = approvalRuleSchema.parse({ id: UUID, threshold_amount: "", due_days: "3" });
    expect(v.threshold_amount).toBeNull();
    expect(v.due_days).toBe(3);
    expect(v.is_enabled).toBe(true);
  });

  it("期限の日数は 0〜60 日", () => {
    expect(approvalRuleSchema.safeParse({ id: UUID, due_days: -1 }).success).toBe(false);
    expect(approvalRuleSchema.safeParse({ id: UUID, due_days: 61 }).success).toBe(false);
    expect(approvalRuleSchema.safeParse({ id: UUID, due_days: 0 }).success).toBe(true);
  });
});

describe("delegationSchema", () => {
  it("種別を選ばなければ空配列（＝種別を問わない）", () => {
    const v = delegationSchema.parse({ to_profile_id: UUID, from_on: "2026-09-01", to_on: "2026-09-30" });
    expect(v.kinds).toEqual([]);
    expect(v.id).toBeNull();
    expect(v.max_amount).toBeNull();
    expect(v.is_active).toBe(true);
  });

  it("終わりの日が始まりの日より前だと弾く（同じ日は可）", () => {
    expect(delegationSchema.safeParse({ to_profile_id: UUID, from_on: "2026-09-30", to_on: "2026-09-01" }).success).toBe(false);
    expect(delegationSchema.safeParse({ to_profile_id: UUID, from_on: "2026-09-01", to_on: "2026-09-01" }).success).toBe(true);
  });

  it("種別は approval_kind だけを受ける", () => {
    expect(delegationSchema.parse({ to_profile_id: UUID, from_on: "2026-09-01", to_on: "2026-09-30", kinds: ["expense", "payout"] }).kinds).toEqual([
      "expense",
      "payout",
    ]);
    expect(delegationSchema.safeParse({ to_profile_id: UUID, from_on: "2026-09-01", to_on: "2026-09-30", kinds: ["nope"] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 意思決定ログ・会社の台帳
// ---------------------------------------------------------------------------

describe("decisionSchema", () => {
  it("件名と決定日があれば成り立つ", () => {
    const v = decisionSchema.parse({ title: "単価を上げる", decided_on: "2026-09-20" });
    expect(v.id).toBeNull();
    expect(v.approval_id).toBeNull();
    expect(v.review_on).toBeNull();
    expect(v.amount).toBeNull();
    expect(v.context).toBe("");
  });

  it("振り返りの状態は open / reviewed / dropped のみ", () => {
    expect(decisionReviewSchema.parse({ id: UUID, status: "reviewed" }).outcome).toBe("");
    expect(decisionReviewSchema.safeParse({ id: UUID, status: "done" }).success).toBe(false);
  });
});

describe("companyProfileSchema", () => {
  it("法人番号は 13 桁の数字か空欄のみ", () => {
    expect(companyProfileSchema.parse({ corporate_number: "1234567890123" }).corporate_number).toBe("1234567890123");
    expect(companyProfileSchema.parse({}).corporate_number).toBe("");
    expect(companyProfileSchema.safeParse({ corporate_number: "12345" }).success).toBe(false);
    expect(companyProfileSchema.safeParse({ corporate_number: "123456789012A" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 中期計画
// ---------------------------------------------------------------------------

describe("planSchema", () => {
  it("終わりの期は始まりの期以降（年は期の決算の年）", () => {
    const bad = planSchema.safeParse({ name: "3か年", from_year: 2027, to_year: 2026 });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe("終わりの期は始まりの期以降にしてください");
    expect(planSchema.safeParse({ name: "3か年", from_year: 2026, to_year: 2026 }).success).toBe(true);
    expect(planSchema.parse({ name: "3か年", from_year: "2026", to_year: "2028" }).to_year).toBe(2028);
  });

  it("年の目標は空欄を 0 として受け、人数は整数", () => {
    const v = planYearSchema.parse({ id: UUID, bill_target: "", profit_target: "1,000,000", driver_target: "12" });
    expect(v.bill_target).toBe(0);
    expect(v.profit_target).toBe(1_000_000);
    expect(v.driver_target).toBe(12);
    expect(planYearSchema.safeParse({ id: UUID, driver_target: 1.5 }).success).toBe(false);
  });

  it("月への配り方は even / actual のみ（既定は even）", () => {
    expect(spreadPlanYearSchema.parse({ plan_id: UUID, year: 2026 }).weight).toBe("even");
    expect(spreadPlanYearSchema.safeParse({ plan_id: UUID, year: 2026, weight: "random" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 並び替え（DB の urgency / severity と同じ意味）
// ---------------------------------------------------------------------------

function approvalRow(id: string, urgency: string, requestedAt: string): ApprovalRow {
  return { id, urgency, requested_at: requestedAt } as unknown as ApprovalRow;
}

describe("sortApprovals", () => {
  it("期限切れ → 滞留 → 待ち → 決裁済み の順、同じ急ぎぐあいなら新しい順", () => {
    const rows = [
      approvalRow("done", "done", "2026-09-19T00:00:00Z"),
      approvalRow("waiting", "waiting", "2026-09-18T00:00:00Z"),
      approvalRow("overdue", "overdue", "2026-09-01T00:00:00Z"),
      approvalRow("stale", "stale", "2026-09-10T00:00:00Z"),
    ];
    expect(sortApprovals(rows).map((r) => r.id)).toEqual(["overdue", "stale", "waiting", "done"]);
  });

  it("元の配列を壊さない", () => {
    const rows = [approvalRow("a", "done", "2026-09-01T00:00:00Z"), approvalRow("b", "overdue", "2026-09-02T00:00:00Z")];
    const sorted = sortApprovals(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(sorted.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("同じ急ぎぐあいなら申請が新しいものを先に出す", () => {
    const rows = [approvalRow("old", "waiting", "2026-09-01T00:00:00Z"), approvalRow("new", "waiting", "2026-09-15T00:00:00Z")];
    expect(sortApprovals(rows).map((r) => r.id)).toEqual(["new", "old"]);
  });
});

function task(refId: string, severity: string, dueOn: string | null): ExecutiveTask {
  return { ref_id: refId, severity, due_on: dueOn } as unknown as ExecutiveTask;
}

describe("sortExecutiveTasks", () => {
  it("重いものが先、同じ重さなら期限が近いものが先（期限なしは最後）", () => {
    const rows = [
      task("low", "low", "2026-09-01"),
      task("high-late", "high", "2026-12-01"),
      task("medium", "medium", null),
      task("high-soon", "high", "2026-09-21"),
    ];
    expect(sortExecutiveTasks(rows).map((r) => r.ref_id)).toEqual(["high-soon", "high-late", "medium", "low"]);
  });
});

// ---------------------------------------------------------------------------
// 機密の見せ方（DB の can_see_confidential と同じ判定）
// ---------------------------------------------------------------------------

describe("機密の見せ方", () => {
  it("壊れた値・知らない値は既定（管理者まで）に落とす", () => {
    expect(toConfidentialScope(null)).toEqual({ loans: "admin", cash: "admin", bank_account: "admin" });
    expect(toConfidentialScope({ loans: "staff", cash: "nope" })).toEqual({ loans: "staff", cash: "admin", bank_account: "admin" });
    expect(toConfidentialScope("owner")).toEqual({ loans: "admin", cash: "admin", bank_account: "admin" });
  });

  it("代表はいつでも見える。ドライバーは決して見えない", () => {
    const scope = toConfidentialScope({ loans: "owner", cash: "owner", bank_account: "owner" });
    expect(canSeeConfidential("owner", scope, "loans")).toBe(true);
    expect(canSeeConfidential("driver", scope, "loans")).toBe(false);
    expect(canSeeConfidential("admin", scope, "loans")).toBe(false);
  });

  it("admin までなら管理者は見えて閲覧者は見えない。staff までなら閲覧者も見える", () => {
    const adminScope = toConfidentialScope({ loans: "admin", cash: "admin", bank_account: "admin" });
    expect(canSeeConfidential("admin", adminScope, "cash")).toBe(true);
    expect(canSeeConfidential("viewer", adminScope, "cash")).toBe(false);

    const staffScope = toConfidentialScope({ loans: "staff", cash: "staff", bank_account: "staff" });
    expect(canSeeConfidential("viewer", staffScope, "bank_account")).toBe(true);
    expect(canSeeConfidential("driver", staffScope, "bank_account")).toBe(false);
  });

  it("事務員まで（clerk）なら管理者と事務員は見えて、閲覧者は見えない。admin までなら事務員は見えない", () => {
    const clerkScope = toConfidentialScope({ loans: "admin", cash: "admin", bank_account: "clerk" });
    expect(canSeeConfidential("clerk", clerkScope, "bank_account")).toBe(true);
    expect(canSeeConfidential("admin", clerkScope, "bank_account")).toBe(true);
    expect(canSeeConfidential("owner", clerkScope, "bank_account")).toBe(true);
    expect(canSeeConfidential("viewer", clerkScope, "bank_account")).toBe(false);
    expect(canSeeConfidential("clerk", clerkScope, "loans")).toBe(false);
    expect(canSeeConfidential("clerk", toConfidentialScope({ loans: "staff", cash: "staff", bank_account: "staff" }), "cash")).toBe(true);
  });

  it("見せ方の保存は owner / admin / clerk / staff だけを受ける", () => {
    expect(confidentialScopeSchema.safeParse({ loans: "owner", cash: "admin", bank_account: "staff" }).success).toBe(true);
    expect(confidentialScopeSchema.safeParse({ loans: "owner", cash: "admin", bank_account: "clerk" }).success).toBe(true);
    expect(confidentialScopeSchema.safeParse({ loans: "everyone", cash: "admin", bank_account: "staff" }).success).toBe(false);
    expect(confidentialScopeSchema.safeParse({ loans: "owner", cash: "admin" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 持ち出しの記録で使う種別
// ---------------------------------------------------------------------------

describe("持ち出しの種別", () => {
  it("出力ルートで使う種別はすべてラベル表にある（DB の is_sensitive の判定と同じキー）", () => {
    for (const kind of ["entries", "payouts", "statement", "statements", "backup", "expenses", "invoices", "rates", "records", "report", "other"]) {
      expect(EXPORT_KIND_LABELS[kind]).toBeTruthy();
    }
  });

  it("個人情報を含む種別はラベル表に揃っている（DB 側で is_sensitive が立つもの）", () => {
    for (const kind of ["transfer", "backup", "statements", "statement", "drivers", "month-pack", "records"]) {
      expect(EXPORT_KIND_LABELS[kind]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 意思決定ログの id 欄（申請から作った下書きは approval_id を持つ）
// ---------------------------------------------------------------------------

describe("decisionSchema の任意 ID", () => {
  it("空欄は null、uuid はそのまま、壊れた値は弾く", () => {
    expect(decisionSchema.parse({ title: "x", decided_on: "2026-09-20", approval_id: "" }).approval_id).toBeNull();
    expect(decisionSchema.parse({ title: "x", decided_on: "2026-09-20", approval_id: UUID2 }).approval_id).toBe(UUID2);
    expect(decisionSchema.safeParse({ title: "x", decided_on: "2026-09-20", approval_id: "xyz" }).success).toBe(false);
  });
});
