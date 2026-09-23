/** 営業資料（/kit）で使う宛名・リンクの組み立て（純関数）。料金は lib/plans、円と日付の書式は lib/format */
import { SITE } from "@/site.config";

/* ───────────── 宛名 ───────────── */

const COMPANY_MAX = 40;

/** 見えない文字（制御文字・ゼロ幅・向きの制御） */
function isInvisible(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    c < 0x20 ||
    (c >= 0x7f && c <= 0x9f) ||
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x2028 && c <= 0x202e) ||
    (c >= 0x2066 && c <= 0x2069) ||
    c === 0xfeff
  );
}

/**
 * ?company= の値を表紙の宛名にする。空・読めないときは null。
 * 見えない文字を消し、空白をまとめ、40 文字で切る。「御中」「様」「殿」で終わっていればそのまま、無ければ「御中」を付ける。
 */
export function addressee(raw: string | string[] | undefined): string | null {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== "string") return null;
  const visible = [...first.replace(/\s+/g, " ")].filter((ch) => !isInvisible(ch));
  const name = [...visible.join("").trim()].slice(0, COMPANY_MAX).join("").trim();
  if (name === "") return null;
  if (/(御中|様|殿)$/.test(name)) return name;
  return `${name} 御中`;
}

/* ───────────── リンクと QR ───────────── */

export type KitSource = "fax" | "flyer" | "proposal";

/** 印刷物の QR に入れる URL（SITE.url ＋ パス ＋ ?utm_source=） */
export function kitUrl(path: string, source: KitSource, base: string = SITE.url): string {
  const url = new URL(path, `${base.replace(/\/+$/, "")}/`);
  url.searchParams.set("utm_source", source);
  return url.toString();
}

/** 紙に印刷する短い URL（https:// と utm を付けない）。例：example.jp/tools/invoice-cost */
export function displayUrl(path: string, base: string = SITE.url): string {
  const url = new URL(path, `${base.replace(/\/+$/, "")}/`);
  const p = url.pathname === "/" ? "" : url.pathname;
  return `${url.host}${p}`;
}

/** 本番の URL が入っていない（QR が localhost などを指してしまう） */
export function isLocalSiteUrl(base: string = SITE.url): boolean {
  try {
    const host = new URL(base).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host.endsWith(".local");
  } catch {
    return true;
  }
}
