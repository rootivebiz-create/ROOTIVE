/**
 * 突合（元請の支払通知 ⇄ 当社の記録）で使う型と、画面・問い合わせ文の言葉。
 * 純関数だけ（DB に触らない）。画面の部品（client）からも読む。
 */

/** 差の種類 */
export type ItemKind = "missing" | "qty" | "price" | "amount" | "extra";

/** 差の扱い：未対応 → 問い合わせ済み → 解決 ／ この金額で了承 */
export type ItemStatus = "open" | "asked" | "resolved" | "accepted";

export const ITEM_STATUSES = ["open", "asked", "resolved", "accepted"] as const satisfies readonly ItemStatus[];

export const KIND_LABEL: Record<ItemKind, string> = {
  missing: "お支払通知に無い",
  qty: "数量の違い",
  price: "単価の違い",
  amount: "金額の違い",
  extra: "お支払通知にだけある",
};

/** 種類の短い説明（画面の小さな字） */
export const KIND_HELP: Record<ItemKind, string> = {
  missing: "当社の記録にはありますが、お支払通知に行が見当たりません。",
  qty: "単価は同じで、数量が違います。",
  price: "数量は同じで、単価が違います。",
  amount: "数量・単価では説明できない金額の違いです（端数の扱いの違いや、金額だけの行など）。",
  extra: "お支払通知にありますが、当社の記録に同じ案件がありません（待機料・再配達・高速代などの追加の料金か、当社の記録の漏れかもしれません）。",
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  open: "未対応",
  asked: "問い合わせ済み",
  resolved: "解決",
  accepted: "この金額で了承",
};

export const STATUS_TONE: Record<ItemStatus, "red" | "yellow" | "green" | "gray"> = {
  open: "red",
  asked: "yellow",
  resolved: "green",
  accepted: "gray",
};

/** まだ片付いていない（合計に数える）状態 */
export function isUnsettled(status: string): boolean {
  return status === "open" || status === "asked";
}

/** 問い合わせてから、この日数を過ぎても返事が無ければ「返事待ち n 日」を目立たせる */
export const WAIT_ALERT_DAYS = 14;

/** 日本時間の日付の通し番号（日をまたいだ数を数えるため） */
const JST_OFFSET = 9 * 3600000;
const jstDayNo = (ms: number) => Math.floor((ms + JST_OFFSET) / 86400000);

/**
 * 問い合わせてから何日たったか（問い合わせ済みでなければ null）。
 * 日本時間の暦の日で数える（10/31 に問い合わせたら、11/14 は時刻に関係なく 14 日）
 */
export function waitingDays(status: string, askedAt: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (status !== "asked" || !askedAt) return null;
  const t = typeof askedAt === "string" ? new Date(askedAt) : askedAt;
  if (Number.isNaN(t.getTime())) return null;
  return Math.max(0, jstDayNo(now.getTime()) - jstDayNo(t.getTime()));
}

/** 「返事待ち n日」の印の色：14 日を過ぎたら黄色（それまでは灰色で、日数だけ見せる） */
export function waitingTone(days: number): "yellow" | "gray" {
  return days >= WAIT_ALERT_DAYS ? "yellow" : "gray";
}

/** 追加の料金らしい名前（待機料・再配達・積込・取卸・高速代・燃料サーチャージ など） */
export const CHARGE_RE = /待機|再配達|再配|積込|積み込|取卸|取り卸|荷卸|荷降|高速|燃料|サーチャージ|付帯/;

export function isChargeName(name: string): boolean {
  return CHARGE_RE.test(name.normalize("NFKC"));
}

/**
 * お支払通知の品目・ドライバー名をまとめる鍵。全角半角・大文字小文字・空白だけをそろえる。
 * 括弧の中は消さない（「宅配（再配達）」と「宅配」を別の行として扱うため）
 */
export function lineKey(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().replace(/[\s　]/g, "");
}

// ---------------------------------------------------------------- 数の書き方

const qtyFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const priceFormat = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 });
const intFormat = new Intl.NumberFormat("ja-JP");

/** 4950 → 4,950（小数は 2 桁まで） */
export function qtyText(value: number): string {
  return qtyFormat.format(value);
}

/** 単価：12000 → 12,000円、12.5 → 12.5円 */
export function priceText(value: number): string {
  return `${priceFormat.format(value)}円`;
}

/** 金額：940500 → 940,500円（マイナスは −） */
export function amountText(value: number): string {
  const v = Math.round(value);
  return `${v < 0 ? "−" : ""}${intFormat.format(Math.abs(v))}円`;
}

/** 数量＋単位：4950, 個 → 4,950個 */
export function qtyUnitText(qty: number, unit: string | null | undefined): string {
  return `${qtyText(qty)}${unit ?? ""}`;
}

/** 「4,950個 × 190円 = 940,500円」。数量・単価が無ければ金額だけ */
export function formulaText(qty: number | null, price: number | null, amount: number, unit: string | null | undefined): string {
  if (qty !== null && price !== null) return `${qtyUnitText(qty, unit)} × ${priceText(price)} = ${amountText(amount)}`;
  if (qty !== null) return `${qtyUnitText(qty, unit)}（${amountText(amount)}）`;
  return amountText(amount);
}

/** YYYY-MM-DD → 2026年10月31日 */
export function dateJa(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/**
 * 元請の締めの期間（画面の部品からも使えるように、ほかのモジュールを読まない）。
 * server/calc/statement の periodOf と同じ決め方：前の月の締め日の翌日 〜 その月の締め日（0・31 以上は末日。短い月は末日に寄せる）。
 * 締め日が月末なら null（暦の月と同じなので、書き添えることが無い）
 */
export function closingSpan(month: string, closingDay: number): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m || !(closingDay >= 1 && closingDay <= 30)) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const py = mo === 1 ? y - 1 : y;
  const pm = mo === 1 ? 12 : mo - 1;
  const prevClose = Math.min(closingDay, last(py, pm));
  const from = prevClose === last(py, pm) ? iso(y, mo, 1) : iso(py, pm, prevClose + 1);
  const to = iso(y, mo, Math.min(closingDay, last(y, mo)));
  return { from, to };
}

/** YYYY-MM(-01) → 2026年10月 */
export function monthJa(month: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) return month;
  return `${Number(m[1])}年${Number(m[2])}月`;
}
