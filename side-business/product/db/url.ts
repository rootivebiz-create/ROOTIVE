/**
 * Postgres の接続文字列を、postgres-js が読める形にそろえる（純関数。アプリ・スクリプト・テストで共通）。
 *
 * postgres-js は、接続文字列の `?` のあとの知らない項目を「サーバーの設定」としてそのまま送る。
 * Neon が表示する接続文字列には `channel_binding=require`、Prisma 向けの説明をまねた Supabase の文字列には
 * `pgbouncer=true` などが付いていて、送るとサーバーが「unrecognized configuration parameter」で接続を断る。
 * これらは libpq・Prisma だけが使う項目なので、取り除いてからつなぐ（sslmode などの読める項目は残す）。
 */
const CLIENT_ONLY_PARAMS = new Set(["channel_binding", "gssencmode", "requiressl", "krbsrvname", "pgbouncer", "connection_limit", "pool_timeout"]);

export function isPostgresUrl(url: string | undefined | null): url is string {
  return !!url && /^postgres(ql)?:\/\/.+/.test(url.trim());
}

/** サーバーに送ると断られる項目を外す。それ以外（ユーザー名・パスワード・ホスト・sslmode など）は一文字も変えない */
export function cleanPostgresUrl(url: string): string {
  const trimmed = url.trim();
  const q = trimmed.indexOf("?");
  if (q < 0) return trimmed;
  const hashAt = trimmed.indexOf("#", q);
  const query = trimmed.slice(q + 1, hashAt < 0 ? undefined : hashAt);
  const hash = hashAt < 0 ? "" : trimmed.slice(hashAt);
  const kept = query
    .split("&")
    .filter((pair) => pair !== "")
    .filter((pair) => !CLIENT_ONLY_PARAMS.has(paramName(pair)));
  return `${trimmed.slice(0, q)}${kept.length ? `?${kept.join("&")}` : ""}${hash}`;
}

function paramName(pair: string): string {
  const raw = pair.split("=")[0] ?? "";
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}
