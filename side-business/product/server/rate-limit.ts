/** 同じ相手からの試行を数える（サーバー 1 台の中だけ。ログインの総当たりを遅らせる目安） */
const buckets = new Map<string, number[]>();

export function tooMany(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const list = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    buckets.set(key, list);
    return true;
  }
  list.push(now);
  buckets.set(key, list);
  return false;
}

export function resetRateLimit(key?: string) {
  if (key) buckets.delete(key);
  else buckets.clear();
}
