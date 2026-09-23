/** 営業資料（/kit）で使う小さな書式と、料金・リンクの組み立て（純関数）。料金は site.config.ts の PLANS だけを見る */
import { PLANS, SITE, type Plan } from "@/site.config";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const yenFormat = new Intl.NumberFormat("ja-JP");

/** 250000 → 250,000円 */
export function yenText(value: number): string {
  return `${yenFormat.format(Math.round(value))}円`;
}

/** 250000 → 25万円、18000 → 1.8万円（千円単位で割り切れないときは 12,345円 のまま） */
export function compactYen(value: number): string {
  if (value >= 10_000 && value % 1_000 === 0) return `${value / 10_000}万円`;
  return yenText(value);
}

/** 250000, 480000 → 25万〜48万円 */
export function rangeYen(min: number, max: number): string {
  if (min === max) return compactYen(min);
  return `${compactYen(min).replace(/円$/, "")}〜${compactYen(max)}`;
}

/** 月額のない「お試し」（無ければ null） */
export function trialPlan(plans: Plan[] = PLANS): Plan | null {
  return plans.find((p) => p.monthlyYen === 0) ?? null;
}

/** 構築して毎月使うパック（月額のあるもの） */
export function buildPlans(plans: Plan[] = PLANS): Plan[] {
  return plans.filter((p) => p.monthlyYen > 0);
}

/** 「お試し5万円・月額1.8万円から（税抜）」 */
export function priceSummary(plans: Plan[] = PLANS): string {
  const trial = trialPlan(plans);
  const packs = buildPlans(plans);
  const parts: string[] = [];
  if (trial) parts.push(`お試し${compactYen(trial.initialYen)}`);
  if (packs.length > 0) parts.push(`月額${compactYen(Math.min(...packs.map((p) => p.monthlyYen)))}から`);
  return parts.length > 0 ? `${parts.join("・")}（税抜）` : "";
}

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

/* ───────────── 日付 ───────────── */

/** いまの日付（日本時間）を「2026年9月23日」にする */
export function jpToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(now);
}
