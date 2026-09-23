import "server-only";
import { eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { getTenant } from "~/server/repo";
import { hasBank, payRuleSentence } from "./format";

/** 設定のはじめの画面：項目ごとの数と、月末の前に直しておきたいところ */
export async function settingsOverview(db: Db, tenantId: string) {
  const [tenant, drivers, clients, projects, overrides, rules, users] = await Promise.all([
    getTenant(db, tenantId),
    db
      .select({
        active: s.drivers.active,
        invoiceRegistered: s.drivers.invoiceRegistered,
        registrationNo: s.drivers.registrationNo,
        bankCode: s.drivers.bankCode,
        branchCode: s.drivers.branchCode,
        accountNumber: s.drivers.accountNumber,
        holderKana: s.drivers.holderKana,
        termsIssuedOn: s.drivers.termsIssuedOn,
      })
      .from(s.drivers)
      .where(eq(s.drivers.tenantId, tenantId)),
    db.select({ id: s.clients.id }).from(s.clients).where(eq(s.clients.tenantId, tenantId)),
    db.select({ active: s.projects.active, billRate: s.projects.billRate, payRate: s.projects.payRate }).from(s.projects).where(eq(s.projects.tenantId, tenantId)),
    db.select({ agreedOn: s.rateOverrides.agreedOn }).from(s.rateOverrides).where(eq(s.rateOverrides.tenantId, tenantId)),
    db.select({ active: s.deductionRules.active, agreedInWriting: s.deductionRules.agreedInWriting }).from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId)),
    db.select({ disabledAt: s.users.disabledAt }).from(s.users).where(eq(s.users.tenantId, tenantId)),
  ]);
  const activeDrivers = drivers.filter((d) => d.active);
  const activeProjects = projects.filter((p) => p.active);
  const activeRules = rules.filter((r) => r.active);
  const r = tenant.settings?.requester;
  return {
    company: {
      name: tenant.name,
      payRule: payRuleSentence(tenant.closingDay, tenant.payMonthOffset, tenant.payDay),
      missing: [
        // 免税の会社は登録番号が無いのがふつうなので、抜けとして出さない
        !tenant.registrationNo && tenant.taxMethod !== "exempt" && "登録番号",
        !(r?.code && r.bankCode && r.accountNumber) && "振込依頼人（全銀）",
        !tenant.settings?.paymentTermsText && "支払期日の文言",
      ].filter((x): x is string => typeof x === "string"),
      feeByDriver: tenant.settings?.transferFeeBearer === "driver",
      aiConsent: tenant.settings?.aiAssistConsent === true,
    },
    drivers: {
      total: drivers.length,
      active: activeDrivers.length,
      noBank: activeDrivers.filter((d) => !hasBank(d)).length,
      noTerms: activeDrivers.filter((d) => !d.termsIssuedOn).length,
      unregistered: activeDrivers.filter((d) => !d.invoiceRegistered).length,
      noRegNo: activeDrivers.filter((d) => d.invoiceRegistered && !d.registrationNo).length,
    },
    clients: { total: clients.length },
    projects: {
      total: projects.length,
      active: activeProjects.length,
      loss: activeProjects.filter((p) => p.payRate > p.billRate).length,
      noBill: activeProjects.filter((p) => !(p.billRate > 0)).length,
    },
    rates: { total: overrides.length, noAgreedOn: overrides.filter((o) => !o.agreedOn).length },
    rules: { total: rules.length, active: activeRules.length, notAgreed: activeRules.filter((x) => !x.agreedInWriting).length },
    users: { total: users.length, active: users.filter((u) => !u.disabledAt).length },
  };
}

export type SettingsOverview = Awaited<ReturnType<typeof settingsOverview>>;
