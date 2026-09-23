import { describe, expect, it } from "vitest";
import { MAX_RECIPIENTS, emailListError, isValidEmail, normalizeEmailList, splitEmails } from "@/lib/mail/address";
import { invoiceMailSubject, invoiceMailText } from "@/lib/mail/invoice";
import { mailErrorMessage } from "@/lib/mail/send";
import { clientInputSchema } from "@/lib/schemas/clients";
import { sendInvoiceMailSchema } from "@/lib/schemas/invoices";

describe("メールアドレス", () => {
  it("カンマ・読点・空白・全角＠で区切っても同じ並びになり、重複は 1 つにする", () => {
    expect(splitEmails("a@x.jp, b@y.jp")).toEqual(["a@x.jp", "b@y.jp"]);
    expect(splitEmails("a@x.jp、b@y.jp；c@z.jp")).toEqual(["a@x.jp", "b@y.jp", "c@z.jp"]);
    expect(splitEmails(" a＠x.jp  A@X.jp ")).toEqual(["a@x.jp"]);
    expect(splitEmails("")).toEqual([]);
    expect(normalizeEmailList("a@x.jp,b@y.jp")).toBe("a@x.jp, b@y.jp");
  });

  it("形の誤りと件数の上限", () => {
    expect(isValidEmail("keiri@example.co.jp")).toBe(true);
    expect(isValidEmail("keiri@example")).toBe(false);
    expect(emailListError("a@x.jp, あいう")).toContain("あいう");
    expect(emailListError(Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@x.jp`).join(","))).toContain("5 件まで");
    expect(emailListError("a@x.jp")).toBeNull();
    expect(emailListError("")).toBeNull();
  });
});

describe("請求書のメールの文面", () => {
  const input = {
    companyName: "株式会社ROOTIVE",
    companyTel: "048-000-0000",
    clientName: "株式会社サンプル物流",
    honorific: "御中",
    invoiceNo: "R-202608-001",
    monthLabel: "2026年8月",
    total: 330000,
    dueDateLabel: "2026年9月30日",
  };

  it("件名に会社名・月・請求書番号が入る", () => {
    expect(invoiceMailSubject(input)).toBe("【株式会社ROOTIVE】2026年8月分 ご請求書のご送付（R-202608-001）");
  });

  it("本文に宛名・金額（税込）・期限・ひとこと・署名が入る", () => {
    const t = invoiceMailText({ ...input, message: "今月から単価が変わっております。" });
    expect(t.startsWith("株式会社サンプル物流 御中")).toBe(true);
    expect(t).toContain("ご請求金額：¥330,000（税込）");
    expect(t).toContain("お支払い期限：2026年9月30日");
    expect(t).toContain("今月から単価が変わっております。");
    expect(t).toContain("TEL 048-000-0000");
  });

  it("期限・ひとこと・電話が無ければ行ごと出さない。敬称が空なら御中", () => {
    const t = invoiceMailText({ ...input, dueDateLabel: null, companyTel: "", honorific: "" });
    expect(t).not.toContain("お支払い期限");
    expect(t).not.toContain("TEL");
    expect(t.startsWith("株式会社サンプル物流 御中")).toBe(true);
  });
});

describe("送信サービスのエラー", () => {
  it("日本語で、何を直せばよいか分かる", () => {
    expect(mailErrorMessage(401, "")).toContain("RESEND_API_KEY");
    expect(mailErrorMessage(422, JSON.stringify({ message: "Invalid `to` field." }))).toContain("Invalid `to` field.");
    expect(mailErrorMessage(429, "")).toContain("しばらく待って");
    expect(mailErrorMessage(500, "boom")).toContain("500");
  });
});

describe("スキーマ", () => {
  const client = {
    id: null,
    name: "サンプル物流",
    honorific: "",
    address: "",
    tel: "",
    invoice_reg_no: "",
    payment_month_offset: "1",
    payment_day: "0",
    memo: "",
    is_active: true,
  };

  it("取引先のメールは任意で、保存する形にそろえる", () => {
    expect(clientInputSchema.parse(client).email).toBe("");
    expect(clientInputSchema.parse({ ...client, email: "a@x.jp、b@y.jp" }).email).toBe("a@x.jp, b@y.jp");
    expect(clientInputSchema.safeParse({ ...client, email: "not-an-email" }).success).toBe(false);
  });

  it("送るときは宛先が必須", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(sendInvoiceMailSchema.safeParse({ id, to: "" }).success).toBe(false);
    expect(sendInvoiceMailSchema.parse({ id, to: "a@x.jp,a@x.jp" })).toEqual({ id, to: "a@x.jp", message: "", remember: false });
  });
});
