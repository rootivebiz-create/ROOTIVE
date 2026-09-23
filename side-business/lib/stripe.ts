import "server-only";

/**
 * Stripe の REST API を fetch で呼ぶだけの小さな包み（SDK を入れない）。
 * 使うのは Checkout Session の作成・取得と Price の取得だけ。
 */

type Params = Record<string, unknown>;

/** { a: { b: [ { c: 1 } ] } } → a[b][0][c]=1（Stripe のフォーム形式） */
export function encodeForm(params: Params, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") out.push(...encodeForm(item as Params, `${name}[${i}]`));
        else out.push([`${name}[${i}]`, String(item)]);
      });
    } else if (typeof value === "object") {
      out.push(...encodeForm(value as Params, name));
    } else {
      out.push([name, String(value)]);
    }
  }
  return out;
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function stripe<T>(method: "GET" | "POST", path: string, params?: Params): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeError("決済の設定がまだです", 503);
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "POST" && params ? new URLSearchParams(encodeForm(params)).toString() : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new StripeError(json.error?.message ?? `Stripe エラー (${res.status})`, res.status);
  return json;
}

export type CheckoutSession = {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  mode: "payment" | "subscription" | "setup";
  metadata: Record<string, string> | null;
  customer_details: { email: string | null } | null;
};

export type Price = { id: string; unit_amount: number | null; currency: string; active: boolean };

export function getPrice(priceId: string): Promise<Price> {
  return stripe<Price>("GET", `prices/${encodeURIComponent(priceId)}`);
}

export function createCheckoutSession(input: {
  priceId: string;
  origin: string;
  product: string;
}): Promise<CheckoutSession> {
  return stripe<CheckoutSession>("POST", "checkout/sessions", {
    mode: "payment",
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: `${input.origin}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/pro?canceled=1`,
    locale: "ja",
    customer_creation: "always",
    allow_promotion_codes: true,
    submit_type: "pay",
    metadata: { product: input.product },
    payment_intent_data: { metadata: { product: input.product } },
  });
}

export function retrieveCheckoutSession(id: string): Promise<CheckoutSession> {
  return stripe<CheckoutSession>("GET", `checkout/sessions/${encodeURIComponent(id)}`);
}

/** 支払いが済んだ購入か（100% 割引のクーポンで 0 円になったものも含む） */
export function isPaidFor(session: CheckoutSession, product: string): boolean {
  return (
    session.mode === "payment" &&
    session.status === "complete" &&
    (session.payment_status === "paid" || session.payment_status === "no_payment_required") &&
    session.metadata?.product === product
  );
}
