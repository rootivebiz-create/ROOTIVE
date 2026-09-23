import { NextResponse } from "next/server";
import { paymentsEnabled, siteOrigin } from "@/lib/env";
import { createCheckoutSession, getPrice, StripeError } from "@/lib/stripe";
import { PRODUCT } from "@/site.config";

export const dynamic = "force-dynamic";

/**
 * 最終確認画面（/pro）の「購入する」から呼ばれ、Stripe の決済画面へ送る。
 * 画面に出している価格と Stripe の価格が違うときは決済へ進ませない（表示と請求の食い違いを防ぐ）。
 */
export async function POST(request: Request) {
  const origin = siteOrigin(request);
  if (!paymentsEnabled()) {
    return NextResponse.redirect(`${origin}/pro?error=disabled`, 303);
  }
  try {
    const priceId = process.env.STRIPE_PRICE_ID!;
    const price = await getPrice(priceId);
    if (!price.active || price.currency !== "jpy" || price.unit_amount !== PRODUCT.priceYen) {
      console.error("price mismatch", { priceId, unit_amount: price.unit_amount, expected: PRODUCT.priceYen });
      return NextResponse.redirect(`${origin}/pro?error=price`, 303);
    }
    const session = await createCheckoutSession({ priceId, origin, product: PRODUCT.id });
    if (!session.url) throw new StripeError("決済画面を作れませんでした", 502);
    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    console.error("checkout failed", error);
    return NextResponse.redirect(`${origin}/pro?error=checkout`, 303);
  }
}
