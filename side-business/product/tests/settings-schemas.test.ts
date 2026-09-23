import { describe, expect, it } from "vitest";
import { resolveStatementNote } from "~/server/features/settings/company";
import {
  deadlineHint,
  deemedNote,
  driverBadges,
  marginOf,
  maskAccount,
  payRuleSentence,
  rulePreview,
  ruleValueText,
  wordingWarnings,
} from "~/server/features/settings/format";
import {
  clientSchema,
  companySchema,
  driverSchema,
  normalizeRegNo,
  overrideSchema,
  percentToRate,
  projectSchema,
  rateToPercent,
  ruleSchema,
  splitAliases,
} from "~/server/features/settings/schemas";

/** zod の誤りを { 項目: 文 } にする（runAction と同じ形） */
function errors(r: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of r.error?.issues ?? []) {
    const key = i.path.join(".");
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}

const driverBase = { name: "テスト 太郎", accountType: "ordinary", active: "on" };

const companyBase = {
  name: "テスト運送",
  taxMethod: "general",
  taxRounding: "floor",
  amountRounding: "round",
  closingDay: "0",
  payMonthOffset: "1",
  payDay: "25",
  transferFeeBearer: "company",
  requesterAccountType: "ordinary",
};

describe("登録番号", () => {
  it("全角・空白・ハイフンを外し、数字 13 桁なら T を付ける", () => {
    expect(normalizeRegNo("１２３４５６７８９０１２３")).toBe("T1234567890123");
    expect(normalizeRegNo(" t1234-5678-90123 ")).toBe("T1234567890123");
  });

  it("形が違えば止める。登録しているのに番号が無ければ止める", () => {
    const bad = driverSchema.safeParse({ ...driverBase, registrationNo: "T12345" });
    expect(errors(bad).registrationNo).toContain("13 桁");
    const missing = driverSchema.safeParse({ ...driverBase, invoiceRegistered: "on" });
    expect(errors(missing).registrationNo).toContain("登録番号");
    const ok = driverSchema.parse({ ...driverBase, invoiceRegistered: "on", registrationNo: "１２３４５６７８９０１２３" });
    expect(ok.registrationNo).toBe("T1234567890123");
    expect(ok.invoiceRegistered).toBe(true);
    // 会社の番号も同じ確かめ
    expect(errors(companySchema.safeParse({ ...companyBase, registrationNo: "1234" })).registrationNo).toContain("13 桁");
  });
});

describe("口座（全銀）", () => {
  it("銀行 4 桁・支店 3 桁・口座 7 桁まで。口座番号は 7 桁に 0 で埋め、名義は半角カナにする", () => {
    const d = driverSchema.parse({
      ...driverBase,
      bankCode: "０００１",
      bankNameKana: "みずほ",
      branchCode: "１０１",
      accountNumber: "12345",
      holderKana: "あおき しょうた",
    });
    expect(d.bankCode).toBe("0001");
    expect(d.branchCode).toBe("101");
    expect(d.accountNumber).toBe("0012345");
    expect(d.holderKana).toBe("ｱｵｷ ｼﾖｳﾀ");
    expect(d.bankNameKana).toBe("ﾐｽﾞﾎ");
  });

  it("桁が違う・使えない文字は、その欄に理由を出す", () => {
    const e = errors(
      driverSchema.safeParse({ ...driverBase, bankCode: "001", branchCode: "12", accountNumber: "12345678", holderKana: "青木 翔太" }),
    );
    expect(e.bankCode).toContain("4 桁");
    expect(e.branchCode).toContain("3 桁");
    expect(e.accountNumber).toContain("7 桁");
    expect(e.holderKana).toContain("青木");
    expect(e.holderKana).toContain("翔太");
  });

  it("口座の一部だけ入れたら、足りない欄を知らせる", () => {
    const e = errors(driverSchema.safeParse({ ...driverBase, bankCode: "0001" }));
    expect(e.branchCode).toContain("支店コード");
    expect(e.accountNumber).toContain("口座番号");
    expect(e.holderKana).toContain("口座名義");
    expect(e.bankCode).toBeUndefined();
  });

  it("名義が長すぎると、略し方を案内する", () => {
    const e = errors(driverSchema.safeParse({ ...driverBase, bankCode: "0001", branchCode: "001", accountNumber: "1", holderKana: "カブシキガイシャサンプルウンソウホッカイドウシテンエイギョウブ" }));
    expect(e.holderKana).toContain("30 文字");
    expect(e.holderKana).toContain("ｶ)");
  });

  it("振込依頼人：コードは 10 桁。1 つでも入れたら、要るものをそろえる。依頼人名は半角カナに", () => {
    const partial = errors(companySchema.safeParse({ ...companyBase, requesterCode: "123456789" }));
    expect(partial.requesterCode).toContain("10 桁");
    expect(partial.requesterName).toContain("依頼人名");
    expect(partial.requesterBankCode).toContain("金融機関コード");
    const bad = errors(companySchema.safeParse({ ...companyBase, requesterName: "サンプル運送" }));
    expect(bad.requesterName).toContain("運送");
    const ok = companySchema.parse({
      ...companyBase,
      requesterCode: "１２３４５６７８９０",
      requesterName: "さんぷるうんそう(カ",
      requesterBankCode: "0001",
      requesterBranchCode: "001",
      requesterAccountNumber: "7654321",
    });
    expect(ok.requesterCode).toBe("1234567890");
    expect(ok.requesterName).toBe("ｻﾝﾌﾟﾙｳﾝｿｳ(ｶ");
    // 金融機関名だけ入れても、黙って捨てずに足りない欄を知らせる
    const nameOnly = errors(companySchema.safeParse({ ...companyBase, requesterBankName: "みずほ" }));
    expect(nameOnly.requesterCode).toContain("依頼人コード");
    expect(nameOnly.requesterAccountNumber).toContain("口座番号");
  });

  it("電話番号は、長音（ー）や全角のハイフンで書いても「-」にそろえる", () => {
    expect(driverSchema.parse({ ...driverBase, phone: "０９０ー１２３４ー５６７８" }).phone).toBe("090-1234-5678");
    expect(errors(driverSchema.safeParse({ ...driverBase, phone: "でんわ" })).phone).toContain("電話番号");
  });
});

describe("数の入力（全角・カンマ）", () => {
  it("控除の率は 10 → 0.1、10.5 → 0.105。0 や 100 超え・小数 3 桁は止める", () => {
    const base = { name: "ロイヤリティ", kind: "percent", onlyWhenWorked: "on", taxable: "on", active: "on" };
    expect(ruleSchema.parse({ ...base, value: "10" }).rate).toBe(0.1);
    expect(ruleSchema.parse({ ...base, value: "１０．５" }).rate).toBe(0.105);
    expect(ruleSchema.parse({ ...base, value: "10" }).amount).toBeNull();
    expect(errors(ruleSchema.safeParse({ ...base, value: "0" })).value).toContain("0 より大きく");
    expect(errors(ruleSchema.safeParse({ ...base, value: "101" })).value).toContain("大きすぎ");
    expect(errors(ruleSchema.safeParse({ ...base, value: "12.345" })).value).toContain("2 桁");
    expect(percentToRate(8)).toBe(0.08);
    expect(rateToPercent(0.1025)).toBe(10.25);
    // 「10%」「１０％」と書いても 0.1（定額のほうは % を読まない）
    expect(ruleSchema.parse({ ...base, value: "10%" }).rate).toBe(0.1);
    expect(ruleSchema.parse({ ...base, value: "１０％" }).rate).toBe(0.1);
    expect(errors(ruleSchema.safeParse({ name: "管理費", kind: "fixed", value: "15000%" })).value).toContain("数で");
  });

  it("定額はカンマつき・全角でも円の整数に。数量 × 単価は小数も", () => {
    const fixed = ruleSchema.parse({ name: "管理費", kind: "fixed", value: "１５，０００", onlyWhenWorked: "on" });
    expect(fixed).toMatchObject({ kind: "fixed", amount: 15000, rate: null, onlyWhenWorked: true, taxable: false, agreedInWriting: false });
    expect(errors(ruleSchema.safeParse({ name: "管理費", kind: "fixed", value: "1500.5" })).value).toContain("整数");
    expect(ruleSchema.parse({ name: "燃料", kind: "per_unit", value: "2.5" })).toMatchObject({ rate: 2.5, amount: null });
    expect(errors(ruleSchema.safeParse({ name: "管理費", kind: "fixed", value: "abc" })).value).toContain("数で");
  });

  it("案件の単価（小数 4 桁まで）と、ドライバー別の単価", () => {
    const p = projectSchema.parse({ name: "宅配", unit: "個", billRate: "１９０", payRate: "150.5", active: "on" });
    expect(p).toMatchObject({ billRate: 190, payRate: 150.5, clientId: null, active: true });
    expect(errors(projectSchema.safeParse({ name: "宅配", unit: "個", billRate: "", payRate: "-1" })).billRate).toContain("受注単価");
    expect(errors(projectSchema.safeParse({ name: "宅配", unit: "個", billRate: "1", payRate: "-1" })).payRate).toContain("0 以上");
    const o = overrideSchema.parse({ driverId: "00000000-0000-4000-8000-000000000001", projectId: "00000000-0000-4000-8000-000000000002", payRate: "１５５", agreedOn: "2026-10-01" });
    expect(o.payRate).toBe(155);
    expect(errors(overrideSchema.safeParse({ driverId: "x", projectId: "y", payRate: "1", agreedOn: "2026-02-30" })).agreedOn).toContain("日付");
  });

  it("資本金・従業員・確認とみなす日数", () => {
    const c = companySchema.parse({ ...companyBase, capitalYen: "１０，０００，０００", employees: "12", deemedConfirmDays: "" });
    expect(c.capitalYen).toBe(10_000_000);
    expect(c.employees).toBe(12);
    expect(c.deemedConfirmDays).toBe(7);
    expect(errors(companySchema.safeParse({ ...companyBase, deemedConfirmDays: "0" })).deemedConfirmDays).toContain("1 以上");
  });
});

describe("会社：締め日と支払日", () => {
  it("当月払いで支払日が締め日より前なら止める（サイトの道具と同じ確かめ）", () => {
    const e = errors(companySchema.safeParse({ ...companyBase, closingDay: "20", payMonthOffset: "0", payDay: "10" }));
    expect(e.payDay).toContain("当月払い");
    // 31 日は末日（0）として保存する
    expect(companySchema.parse({ ...companyBase, closingDay: "31" }).closingDay).toBe(0);
  });

  it("言い方と 60 日の目安", () => {
    expect(payRuleSentence(0, 1, 25)).toBe("毎月末日締め・翌月25日払い");
    expect(deadlineHint(0, 1, 25, "2026-09-23").status).toBe("ok");
    const late = deadlineHint(0, 2, 0, "2026-09-23");
    expect(late.status).toBe("ng");
    expect(late.text).toContain("60日");
    expect(late.text).toContain("確認をおすすめします");
    expect(late.safer).toContain("までなら");
    expect(deadlineHint(20, 0, 10, "2026-09-23").status).toBe("error");
  });

  it("支払期日の文言：期間・請求書から数える書き方を知らせる", () => {
    const w = wordingWarnings("請求書受領後60日以内に支払う", ["まで", "以内"], ["請求書受領", "請求書到着", "検収後"]);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain("以内");
    expect(w[1]).toContain("請求書受領");
    expect(wordingWarnings("毎月末日締め・翌月25日払い", ["まで", "以内"], ["請求書受領"])).toEqual([]);
  });

  it("明細の注記：空か決まった文なら保存せず、確認とみなす日数から明細が文を作る", () => {
    // 空・決まった文（日数だけ違う）は保存しない。明細の計算が「確認とみなすまでの日数」から文を作る
    expect(resolveStatementNote(null)).toBeUndefined();
    expect(resolveStatementNote("")).toBeUndefined();
    expect(resolveStatementNote(deemedNote(10))).toBeUndefined();
    expect(resolveStatementNote(` ${deemedNote(7)} `)).toBeUndefined();
    expect(resolveStatementNote("独自の文です")).toBe("独自の文です");
  });
});

describe("名前・別名", () => {
  it("別名は「、」かカンマで区切り、重複・名前と同じものは外す（かなとカナも同じと見る）", () => {
    expect(splitAliases("青木、アオキ,あおき，, 青木 翔太", "青木 翔太")).toEqual(["青木", "アオキ"]);
    const c = clientSchema.parse({ name: "A物流", aliases: "Ａ物流、A物流（架空）", closingDay: "0" });
    expect(c.aliases).toEqual(["A物流（架空）"]);
  });
});

describe("表示の小さな部品", () => {
  it("粗利と割合・控除の例・口座の伏せ字・しるし", () => {
    expect(marginOf(190, 150)).toMatchObject({ perUnit: 40, loss: false, label: "40円（21.1%）" });
    expect(marginOf(100, 120).loss).toBe(true);
    const r = { kind: "percent" as const, rate: 0.1, amount: null, taxable: true, onlyWhenWorked: true };
    expect(rulePreview(r, { amount: "round", tax: "floor" })).toBe("例：委託料 300,000円 の人は 30,000円（消費税 3,000円 も合わせて差し引きます）");
    expect(rulePreview({ kind: "fixed", rate: null, amount: 32000, taxable: false, onlyWhenWorked: false }, { amount: "round", tax: "floor" })).toBe("毎月 32,000円・稼働が無い月も");
    expect(ruleValueText({ kind: "percent", rate: 0.1, amount: null })).toBe("委託料 × 10%");
    expect(maskAccount("1234567")).toBe("****567");
    const badges = driverBadges({ invoiceRegistered: false, registrationNo: null, bankCode: null, branchCode: null, accountNumber: null, holderKana: null, termsIssuedOn: null, active: true });
    expect(badges.map((b) => b.label)).toEqual(["インボイス未登録", "口座なし", "取引条件の明示なし"]);
  });
});
