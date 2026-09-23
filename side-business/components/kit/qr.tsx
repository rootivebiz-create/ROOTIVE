/** QR コード（サーバーで SVG にして埋め込む。画像の読み込みも外部のサービスも使わない） */
import QRCode from "qrcode";
import { cx } from "@/lib/cx";

const LEVEL = "M" as const;
/** 読み取りに必要な周りの白い余白（マスの数） */
const QUIET = 4;

export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: LEVEL });
}

/**
 * QR の周りの白い余白（4 マス分）も、この箱の中に入れる。className で決めた幅がそのまま白い正方形になるので、
 * 置く側は幅だけ決めればよく、FAX の粗い画質や、すぐ下の文字・枠の線があっても読み取れる。
 * 白い地（bg-white）なので、ダークモードや色の付いた紙面でも読める。
 */
export async function Qr({ url, label, className }: { url: string; label: string; className?: string }) {
  const svg = await qrSvg(url);
  const size = QRCode.create(url, { errorCorrectionLevel: LEVEL }).modules.size;
  // padding の % は外側の箱の幅に対する割合。外側の幅 ＝（マス数 ＋ 余白 × 2）マス分になる
  const quiet = `${((QUIET / (size + QUIET * 2)) * 100).toFixed(3)}%`;
  return (
    <div role="img" aria-label={label} className={cx("kit-qr bg-white", className)}>
      <div
        className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
        style={{ padding: quiet }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
