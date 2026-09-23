/**
 * 同じ相手からの試行を数える（サーバー 1 台の中だけ。ログインの総当たりを遅らせる目安）。
 * 覚えておく数には上限があり、窓を過ぎた記録は消す（長い値や多くの相手で、サーバーのメモリを使い切らせない）
 */
type Bucket = { times: number[]; windowMs: number };
const buckets = new Map<string, Bucket>();

/** 覚えておく相手の数の上限（超えたら、窓を過ぎたものを消し、それでも多ければ古いものから消す） */
export const MAX_RATE_LIMIT_KEYS = 20_000;
/** キーの長さの上限（長い値は切り詰めずに要約する。呼ぶ側の書き方が変わっても、1 つのキーが大きくならない） */
const MAX_KEY_LENGTH = 200;
const SWEEP_EVERY_MS = 60_000;
let lastSweep = 0;

function compactKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  // 暗号の強さは要らない。長いキーを短い目印にするだけ（同じ値は同じ目印になる）
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x5bd1e995) >>> 0;
  }
  return `${key.slice(0, 64)}…${key.length}:${h1.toString(36)}${h2.toString(36)}`;
}

function sweep(now: number) {
  lastSweep = now;
  for (const [key, b] of buckets) {
    const last = b.times[b.times.length - 1];
    if (last === undefined || now - last >= b.windowMs) buckets.delete(key);
  }
  // それでも多ければ、古く入ったものから 1 割ほど消す（Map は入れた順に並ぶ。毎回消し直さないように、まとめて空ける）
  if (buckets.size >= MAX_RATE_LIMIT_KEYS) {
    let extra = buckets.size - Math.floor(MAX_RATE_LIMIT_KEYS * 0.9);
    for (const key of buckets.keys()) {
      if (extra-- <= 0) break;
      buckets.delete(key);
    }
  }
}

export function tooMany(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (buckets.size >= MAX_RATE_LIMIT_KEYS || now - lastSweep >= SWEEP_EVERY_MS || now < lastSweep) sweep(now);
  const k = compactKey(key);
  const list = (buckets.get(k)?.times ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    buckets.set(k, { times: list, windowMs });
    return true;
  }
  list.push(now);
  // 入れ直して、新しく使ったものを後ろへ（古いものから消すときに残る）
  buckets.delete(k);
  buckets.set(k, { times: list, windowMs });
  return false;
}

export function resetRateLimit(key?: string) {
  if (key) buckets.delete(compactKey(key));
  else buckets.clear();
}

/** テスト用：いま覚えている相手の数 */
export function rateLimitSize(): number {
  return buckets.size;
}
