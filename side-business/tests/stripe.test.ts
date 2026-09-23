import { describe, expect, it } from "vitest";
import { encodeForm, isPaidFor, type CheckoutSession } from "@/lib/stripe";

describe("Stripe のフォーム形式", () => {
  it("入れ子と配列を角括弧で表す", () => {
    expect(
      encodeForm({
        mode: "payment",
        line_items: [{ price: "price_1", quantity: 1 }],
        metadata: { product: "pro" },
        skip: undefined,
        none: null,
        flag: true,
      }),
    ).toEqual([
      ["mode", "payment"],
      ["line_items[0][price]", "price_1"],
      ["line_items[0][quantity]", "1"],
      ["metadata[product]", "pro"],
      ["flag", "true"],
    ]);
  });

  it("スカラーの配列も番号を付ける", () => {
    expect(encodeForm({ payment_method_types: ["card", "konbini"] })).toEqual([
      ["payment_method_types[0]", "card"],
      ["payment_method_types[1]", "konbini"],
    ]);
  });
});

describe("支払いが済んだか", () => {
  const base: CheckoutSession = {
    id: "cs_1",
    url: null,
    status: "complete",
    payment_status: "paid",
    mode: "payment",
    metadata: { product: "pro" },
    customer_details: { email: "a@example.com" },
  };

  it("支払い済みで商品が合えば通す", () => {
    expect(isPaidFor(base, "pro")).toBe(true);
    expect(isPaidFor({ ...base, payment_status: "no_payment_required" }, "pro")).toBe(true);
  });

  it("未払い・未完了・別の商品・定期課金は通さない", () => {
    expect(isPaidFor({ ...base, payment_status: "unpaid" }, "pro")).toBe(false);
    expect(isPaidFor({ ...base, status: "open" }, "pro")).toBe(false);
    expect(isPaidFor({ ...base, metadata: { product: "other" } }, "pro")).toBe(false);
    expect(isPaidFor({ ...base, metadata: null }, "pro")).toBe(false);
    expect(isPaidFor({ ...base, mode: "subscription" }, "pro")).toBe(false);
  });
});
