import "server-only";

/** 決済に必要な環境変数がそろっているか。そろっていなければ購入ボタンを出さない */
export function paymentsEnabled(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_PRICE_ID &&
      process.env.LICENSE_PRIVATE_KEY &&
      process.env.NEXT_PUBLIC_LICENSE_PUBLIC_KEY,
  );
}

/** リクエストから公開 URL の起点を決める（NEXT_PUBLIC_SITE_URL があればそれを優先） */
export function siteOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
