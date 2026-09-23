/** QR コード（サーバーで SVG にして埋め込む。画像の読み込みも外部のサービスも使わない） */
import QRCode from "qrcode";
import { cx } from "./format";

export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
}

/**
 * QR の周りの白い余白（4 マス分）は、置く側で空けておく。
 * 白い地（bg-white）の上に置くので、ダークモードや色の付いた紙面でも読める。
 */
export async function Qr({ url, label, className }: { url: string; label: string; className?: string }) {
  const svg = await qrSvg(url);
  return (
    <div
      role="img"
      aria-label={label}
      className={cx("kit-qr bg-white", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
