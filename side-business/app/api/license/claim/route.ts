import { NextResponse } from "next/server";
import { importPrivateKey, maskEmail, signLicense } from "@/lib/license";
import { paymentsEnabled } from "@/lib/env";
import { isPaidFor, retrieveCheckoutSession, StripeError } from "@/lib/stripe";
import { PRODUCT } from "@/site.config";

export const dynamic = "force-dynamic";

/**
 * 決済が終わった画面（/pro/success）から呼ばれ、支払いを Stripe に確かめてからライセンスを発行する。
 * 同じ購入なら何度呼んでも有効なライセンスが返る（端末を変えたときの再発行にも使える）。
 */
export async function POST(request: Request) {
  if (!paymentsEnabled()) {
    return NextResponse.json({ error: "決済の設定がまだです" }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { sessionId?: unknown } | null;
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) {
    return NextResponse.json({ error: "購入の番号が正しくありません" }, { status: 400 });
  }
  try {
    const session = await retrieveCheckoutSession(sessionId);
    if (!isPaidFor(session, PRODUCT.id)) {
      return NextResponse.json({ error: "お支払いが確認できませんでした。数分おいてからもう一度お試しください" }, { status: 402 });
    }
    const key = await importPrivateKey(process.env.LICENSE_PRIVATE_KEY!);
    const email = maskEmail(session.customer_details?.email);
    const license = await signLicense(
      { v: 1, p: "pro", s: session.id, t: Math.floor(Date.now() / 1000), ...(email ? { m: email } : {}) },
      key,
    );
    return NextResponse.json({ license, email });
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) {
      return NextResponse.json({ error: "購入が見つかりませんでした" }, { status: 404 });
    }
    console.error("claim failed", error);
    return NextResponse.json({ error: "いま確認できませんでした。時間をおいてもう一度お試しください" }, { status: 502 });
  }
}
