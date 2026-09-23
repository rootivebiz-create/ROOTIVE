import "server-only";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { BuildInput, CalcRule } from "~/server/calc/statement";
import type { Rounding } from "@/lib/payroll/types";

/**
 * 会社（tenant）で必ず絞って読む。ここを通さずに表を読まないこと（他社のデータが混ざらないように）。
 */
export async function getTenant(db: Db, tenantId: string) {
  const rows = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId)).limit(1);
  const t = rows[0];
  if (!t) throw new Error("会社が見つかりません");
  return t;
}

export async function isMonthClosed(db: Db, tenantId: string, month: string): Promise<boolean> {
  const rows = await db
    .select({ status: s.monthCloses.status })
    .from(s.monthCloses)
    .where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, month)))
    .limit(1);
  return rows[0]?.status === "closed";
}

/** 明細の計算に必要なものを、その会社・その月だけ読み出す */
export async function loadBuildInput(db: Db, tenantId: string, month: string): Promise<BuildInput> {
  const t = await getTenant(db, tenantId);
  const [drivers, projects, clients, overrides, rules, work, adjustments] = await Promise.all([
    db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId)).orderBy(asc(s.drivers.name)),
    db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select().from(s.clients).where(eq(s.clients.tenantId, tenantId)),
    db.select().from(s.rateOverrides).where(eq(s.rateOverrides.tenantId, tenantId)),
    db.select().from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId)),
    db.select().from(s.workEntries).where(and(eq(s.workEntries.tenantId, tenantId), eq(s.workEntries.month, month))),
    db.select().from(s.adjustments).where(and(eq(s.adjustments.tenantId, tenantId), eq(s.adjustments.month, month))),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  return {
    month,
    tenant: {
      name: t.name,
      registrationNo: t.registrationNo,
      taxMethod: t.taxMethod,
      payTaxToExempt: t.payTaxToExempt,
      taxRounding: t.taxRounding as Rounding,
      amountRounding: t.amountRounding as Rounding,
      closingDay: t.closingDay,
      payMonthOffset: t.payMonthOffset,
      payDay: t.payDay,
      statementNote: t.settings?.statementNote,
    },
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      invoiceRegistered: d.invoiceRegistered,
      registrationNo: d.registrationNo,
      isCorporation: d.isCorporation,
      withholdingCategory: d.withholdingCategory,
      active: d.active,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.clientId ? clientName.get(p.clientId) ?? null : null,
      unit: p.unit,
      billRate: p.billRate,
      payRate: p.payRate,
    })),
    overrides: overrides.map((o) => ({ driverId: o.driverId, projectId: o.projectId, payRate: o.payRate })),
    rules: rules.map((r) => ({
      id: r.id,
      driverId: r.driverId,
      name: r.name,
      kind: r.kind as CalcRule["kind"],
      rate: r.rate,
      amount: r.amount,
      onlyWhenWorked: r.onlyWhenWorked,
      taxable: r.taxable,
      agreedInWriting: r.agreedInWriting,
      active: r.active,
      sort: r.sort,
    })),
    work: work.map((w) => ({ driverId: w.driverId, projectId: w.projectId, qty: w.qty })),
    adjustments: adjustments.map((a) => ({ driverId: a.driverId, label: a.label, amount: a.amount, taxable: a.taxable, agreedInWriting: a.agreedInWriting })),
  };
}
