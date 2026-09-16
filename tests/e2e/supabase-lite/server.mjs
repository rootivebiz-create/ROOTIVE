#!/usr/bin/env node
/**
 * supabase-lite — Supabase 互換の最小テストサーバー（Auth / PostgREST / Storage）
 *
 * ローカル PostgreSQL（tests/sql/auth_stub.sql ＋ supabase/migrations を適用済み）に接続し、
 * supabase-js / @supabase/ssr がアプリで使う範囲の API を Node.js だけで再現する。
 * Docker・PostgREST・GoTrue が無い環境で E2E と本番前の動作確認に使う（本番では使わない）。
 *
 * 起動:
 *   node tests/e2e/supabase-lite/server.mjs --port 54321 \
 *     --db postgresql://postgres@127.0.0.1:54329/rootive_e2e --storage tests/e2e/.storage [--verbose]
 *   node tests/e2e/supabase-lite/server.mjs --print-keys   # anon / service_role キーだけ出力
 *
 * 依存: pg, jose（devDependencies）
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import pg from "pg";
import { SignJWT, jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// 起動オプション
// ---------------------------------------------------------------------------
const { values: opts } = parseArgs({
  options: {
    port: { type: "string", default: "54321" },
    host: { type: "string", default: "127.0.0.1" },
    db: { type: "string", default: "postgresql://postgres@127.0.0.1:54329/rootive_e2e" },
    storage: { type: "string", default: "tests/e2e/.storage" },
    "jwt-secret": { type: "string", default: "super-secret-jwt-token-with-at-least-32-characters-long" },
    "site-url": { type: "string", default: "http://127.0.0.1:3100" },
    verbose: { type: "boolean", default: false },
    "print-keys": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (opts.help) {
  console.log(`supabase-lite: Supabase 互換テストサーバー
  --port <n>         待ち受けポート（既定 54321）
  --host <h>         待ち受けホスト（既定 127.0.0.1）
  --db <url>         PostgreSQL 接続文字列（既定 postgresql://postgres@127.0.0.1:54329/rootive_e2e）
  --storage <dir>    Storage のファイル保存先（既定 tests/e2e/.storage）
  --jwt-secret <s>   JWT の秘密鍵（HS256）
  --site-url <url>   generate_link の action_link に使うアプリ URL
  --verbose          リクエストごとに 1 行ログ
  --print-keys       anon / service_role キーを出力して終了`);
  process.exit(0);
}

const PORT = Number(opts.port);
const HOST = opts.host;
const DB_URL = opts.db;
const STORAGE_DIR = path.resolve(opts.storage);
const SITE_URL = opts["site-url"].replace(/\/$/, "");
const VERBOSE = opts.verbose;
const ISSUER = "supabase-lite";
const SECRET = new TextEncoder().encode(opts["jwt-secret"]);
const ACCESS_TOKEN_TTL = 3600;
/** 鍵を決定的にするため iat を固定する（再起動しても同じ anon / service_role キーになる） */
const FIXED_IAT = 1700000000;
const TEN_YEARS = 10 * 365 * 24 * 3600;

async function signKey(role) {
  return new SignJWT({ iss: ISSUER, ref: ISSUER, role })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(FIXED_IAT)
    .setExpirationTime(FIXED_IAT + TEN_YEARS)
    .sign(SECRET);
}

const ANON_KEY = await signKey("anon");
const SERVICE_ROLE_KEY = await signKey("service_role");

if (opts["print-keys"]) {
  console.log(`ANON_KEY=${ANON_KEY}`);
  console.log(`SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, body, headers = {}) {
    super(typeof body === "string" ? body : JSON.stringify(body));
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

function isPgError(e) {
  return Boolean(e) && typeof e === "object" && typeof e.code === "string" && "severity" in e;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBody(buf, required = false) {
  if (!buf || buf.length === 0) {
    if (required) throw new HttpError(400, { code: "PGRST102", message: "Empty or invalid json request body", details: null, hint: null });
    return undefined;
  }
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch (e) {
    throw new HttpError(400, { code: "PGRST102", message: `Empty or invalid json request body: ${e.message}`, details: null, hint: null });
  }
}

function send(res, status, body, headers = {}) {
  const h = { ...headers };
  let payload = body;
  if (body !== undefined && body !== null && typeof body === "object" && !Buffer.isBuffer(body)) {
    payload = JSON.stringify(body);
    h["Content-Type"] = h["Content-Type"] ?? "application/json; charset=utf-8";
  } else if (typeof body === "string") {
    h["Content-Type"] = h["Content-Type"] ?? "application/json; charset=utf-8";
  }
  if (payload === undefined || payload === null) {
    res.writeHead(status, h);
    res.end();
    return;
  }
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  h["Content-Length"] = String(buf.length);
  res.writeHead(status, h);
  res.end(buf);
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function quoteIdent(name) {
  if (typeof name !== "string" || !IDENT_RE.test(name)) {
    throw new HttpError(400, { code: "PGRST100", message: `識別子が不正です: "${name}"`, details: null, hint: null });
  }
  return `"${name}"`;
}

/** カンマ区切りを括弧・引用符を考慮して分割する */
function splitTopLevel(str, sep = ",") {
  const out = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quoted) {
      cur += ch;
      if (ch === "\\" && i + 1 < str.length) cur += str[++i];
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(.)/g, "$1");
  return t;
}

/** JSON の値を pg のパラメータ（テキスト）へ。型は PostgreSQL 側が列・引数から推論する */
function toParam(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function parsePrefer(header) {
  const out = {};
  for (const part of String(header ?? "").split(",")) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (k) out[k] = v ?? true;
  }
  return out;
}

function isoOrNull(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function log(...args) {
  if (VERBOSE) console.log(`[supabase-lite]`, ...args);
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------
const pool = new pg.Pool({ connectionString: DB_URL, max: 8 });
pool.on("error", (e) => console.error("[supabase-lite] pool error:", e.message));

const DB_ROLES = new Set(["anon", "authenticated", "service_role"]);

/**
 * 1 リクエスト＝1 トランザクション。PostgREST と同じく role と JWT クレームをセッション変数に設定する
 * @param {{role: string, claims: object|null, sub: string|null}} ctx
 */
async function withTx(ctx, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${quoteIdent(ctx.role)}`);
    if (ctx.claims) {
      await client.query(
        "SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)",
        [JSON.stringify(ctx.claims), ctx.sub ?? "", ctx.claims.role ?? ctx.role],
      );
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// JWT / 認証コンテキスト
// ---------------------------------------------------------------------------
async function verifyJwt(token) {
  const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
  return payload;
}

function bearerOf(req) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""));
  return m ? m[1].trim() : null;
}

/** PostgREST / Storage 用：apikey か Bearer の JWT からロールとクレームを取り出す */
async function restContext(req) {
  const token = bearerOf(req) ?? (typeof req.headers.apikey === "string" ? req.headers.apikey : null);
  if (!token) {
    throw new HttpError(401, { code: "PGRST300", message: "No API key found in request", details: null, hint: "No `apikey` request header or url param was found." });
  }
  let claims;
  try {
    claims = await verifyJwt(token);
  } catch (e) {
    throw new HttpError(401, { code: "PGRST301", message: `JWT: ${e.message}`, details: null, hint: null });
  }
  const role = typeof claims.role === "string" ? claims.role : "anon";
  if (!DB_ROLES.has(role)) {
    throw new HttpError(401, { code: "PGRST302", message: `Anonymous access is disabled or role "${role}" is unknown`, details: null, hint: null });
  }
  return { role, claims, sub: typeof claims.sub === "string" ? claims.sub : null, token };
}

// ---------------------------------------------------------------------------
// PostgREST 互換 /rest/v1
// ---------------------------------------------------------------------------
const PG_STATUS = {
  "23503": 409,
  "23505": 409,
  "25006": 405,
  "42P01": 404,
  "42883": 404,
  "42P17": 500,
  "08000": 503,
};

function pgErrorToRest(e, role) {
  let status = PG_STATUS[e.code] ?? 400;
  if (e.code === "42501") status = role === "anon" ? 401 : 403;
  else if (e.code.startsWith("08")) status = 503;
  else if (e.code.startsWith("PT")) status = Number(e.code.slice(2)) || 500;
  return new HttpError(status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
}

const FILTER_OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "LIKE", ilike: "ILIKE", match: "~", imatch: "~*" };

function buildFilter(column, spec, params) {
  let negate = false;
  let s = spec;
  if (s.startsWith("not.")) {
    negate = true;
    s = s.slice(4);
  }
  const dot = s.indexOf(".");
  if (dot < 0) throw new HttpError(400, { code: "PGRST100", message: `フィルタの形式が不正です: ${column}=${spec}`, details: null, hint: null });
  const op = s.slice(0, dot);
  const raw = s.slice(dot + 1);
  const col = quoteIdent(column);
  let expr;
  if (op === "is") {
    const v = raw.toLowerCase();
    if (!["null", "true", "false", "unknown"].includes(v)) {
      throw new HttpError(400, { code: "PGRST100", message: `is の値が不正です: ${raw}`, details: null, hint: null });
    }
    expr = `${col} IS ${v.toUpperCase()}`;
  } else if (op === "in") {
    const inner = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
    const items = splitTopLevel(inner, ",").map(unquote);
    if (items.length === 0) expr = "FALSE";
    else {
      const ph = items.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      expr = `${col} IN (${ph.join(", ")})`;
    }
  } else if (FILTER_OPS[op]) {
    let v = raw;
    if (op === "like" || op === "ilike") v = v.replace(/\*/g, "%");
    params.push(v);
    expr = `${col} ${FILTER_OPS[op]} $${params.length}`;
  } else {
    throw new HttpError(400, { code: "PGRST100", message: `未対応の演算子です: ${op}（対応: eq, neq, gt, gte, lt, lte, like, ilike, is, in, not.*）`, details: null, hint: null });
  }
  return negate ? `NOT (${expr})` : expr;
}

function buildLogic(kind, inner, params) {
  const parts = splitTopLevel(inner, ",").map((item) => {
    const m = /^(not\.)?(and|or)\((.*)\)$/s.exec(item);
    if (m) {
      const sub = buildLogic(m[2], m[3], params);
      return m[1] ? `NOT ${sub}` : sub;
    }
    const dot = item.indexOf(".");
    if (dot < 0) throw new HttpError(400, { code: "PGRST100", message: `or/and の要素が不正です: ${item}`, details: null, hint: null });
    return buildFilter(item.slice(0, dot), item.slice(dot + 1), params);
  });
  if (parts.length === 0) return "TRUE";
  return `(${parts.join(kind === "or" ? " OR " : " AND ")})`;
}

function buildOrder(order) {
  return splitTopLevel(order, ",")
    .map((item) => {
      const parts = item.split(".");
      const col = quoteIdent(parts[0]);
      let dir = "ASC";
      let nulls = "";
      for (const p of parts.slice(1)) {
        const l = p.toLowerCase();
        if (l === "asc" || l === "desc") dir = l.toUpperCase();
        else if (l === "nullsfirst") nulls = " NULLS FIRST";
        else if (l === "nullslast") nulls = " NULLS LAST";
        else throw new HttpError(400, { code: "PGRST100", message: `order の指定が不正です: ${item}`, details: null, hint: null });
      }
      return `${col} ${dir}${nulls}`;
    })
    .join(", ");
}

function buildSelect(select) {
  const s = (select ?? "*").trim();
  if (s === "" || s === "*") return "*";
  return splitTopLevel(s, ",")
    .map((item) => {
      if (item.includes("(")) {
        throw new HttpError(400, {
          code: "PGRST100",
          message: `埋め込みリソースには対応していません: ${item}（名称が必要な場合は v_* ビューを使ってください）`,
          details: null,
          hint: null,
        });
      }
      if (item === "*") return "*";
      let alias = null;
      let col = item;
      let cast = null;
      const c = col.indexOf(":");
      if (c >= 0 && col[c + 1] !== ":") {
        alias = col.slice(0, c);
        col = col.slice(c + 1);
      }
      const cc = col.indexOf("::");
      if (cc >= 0) {
        cast = col.slice(cc + 2);
        col = col.slice(0, cc);
      }
      let expr = quoteIdent(col);
      if (cast) expr = `${expr}::${quoteIdent(cast)}`;
      return `${expr} AS ${quoteIdent(alias ?? col)}`;
    })
    .join(", ");
}

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function parseRestQuery(url, rangeHeader) {
  const q = { select: "*", order: null, limit: null, offset: null, onConflict: null, params: [], conds: [] };
  for (const [key, value] of url.searchParams) {
    if (key === "select") q.select = value;
    else if (key === "order") q.order = value;
    else if (key === "limit") q.limit = Number(value);
    else if (key === "offset") q.offset = Number(value);
    else if (key === "on_conflict") q.onConflict = value;
    else if (key === "columns") continue;
    else if (key === "or" || key === "and" || key === "not.or" || key === "not.and") {
      const negate = key.startsWith("not.");
      const kind = negate ? key.slice(4) : key;
      const inner = value.trim().startsWith("(") && value.trim().endsWith(")") ? value.trim().slice(1, -1) : value;
      const sub = buildLogic(kind, inner, q.params);
      q.conds.push(negate ? `NOT ${sub}` : sub);
    } else if (!RESERVED_PARAMS.has(key)) {
      q.conds.push(buildFilter(key, value, q.params));
    }
  }
  if (rangeHeader) {
    const m = /^(?:items=)?(\d+)-(\d*)$/.exec(String(rangeHeader).trim());
    if (m) {
      const from = Number(m[1]);
      q.offset = q.offset ?? from;
      if (m[2] !== "") q.limit = q.limit ?? Number(m[2]) - from + 1;
    }
  }
  if (q.limit !== null && (!Number.isInteger(q.limit) || q.limit < 0)) throw new HttpError(400, { code: "PGRST100", message: "limit が不正です", details: null, hint: null });
  if (q.offset !== null && (!Number.isInteger(q.offset) || q.offset < 0)) throw new HttpError(400, { code: "PGRST100", message: "offset が不正です", details: null, hint: null });
  q.whereParamCount = q.params.length;
  q.where = q.conds.length ? ` WHERE ${q.conds.join(" AND ")}` : "";
  return q;
}

const pkCache = new Map();
async function primaryKeyColumns(client, table) {
  if (pkCache.has(table)) return pkCache.get(table);
  const r = await client.query(
    `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = ($1)::regclass AND i.indisprimary ORDER BY array_position(i.indkey, a.attnum)`,
    [`public.${table}`],
  );
  const cols = r.rows.map((x) => x.attname);
  pkCache.set(table, cols);
  return cols;
}

/** 行の JSON（配列テキスト）と件数から、Accept に応じた本文を作る */
function finishRows(bodyText, n, wantObject, method) {
  if (wantObject) {
    if (n !== 1) {
      throw new HttpError(406, {
        code: "PGRST116",
        details: `The result contains ${n} rows`,
        hint: null,
        message: "JSON object requested, multiple (or no) rows returned",
      });
    }
    const t = bodyText.trim();
    return t.slice(1, -1).trim();
  }
  if (method === "HEAD") return undefined;
  return bodyText;
}

function contentRange(offset, n, total) {
  const from = offset ?? 0;
  const range = n > 0 ? `${from}-${from + n - 1}` : "*";
  return `${range}/${total === null ? "*" : total}`;
}

async function handleRest(req, url, bodyBuf, ctx) {
  const rel = decodeURIComponent(url.pathname.slice("/rest/v1/".length)).replace(/^\/+|\/+$/g, "");
  if (rel.startsWith("rpc/")) return handleRpc(req, url, bodyBuf, ctx, rel.slice(4));
  if (rel === "") {
    return { status: 200, body: { swagger: "2.0", info: { title: "supabase-lite", version: "0.1.0" } } };
  }
  const table = rel;
  const relSql = `"public".${quoteIdent(table)}`;
  const prefer = parsePrefer(req.headers.prefer);
  const accept = String(req.headers.accept ?? "");
  const wantObject = accept.includes("application/vnd.pgrst.object+json");
  const wantRepresentation = prefer.return === "representation";
  const q = parseRestQuery(url, req.headers.range);
  const selectSql = buildSelect(q.select);
  const method = req.method;

  return withTx(ctx, async (client) => {
    try {
      if (method === "GET" || method === "HEAD") {
        let total = null;
        if (prefer.count === "exact" || prefer.count === "planned" || prefer.count === "estimated") {
          const c = await client.query(`SELECT count(*)::int AS n FROM ${relSql}${q.where}`, q.params.slice(0, q.whereParamCount));
          total = c.rows[0].n;
        }
        if (method === "HEAD") {
          return { status: 200, headers: { "Content-Range": contentRange(q.offset, 0, total), "Content-Type": "application/json; charset=utf-8" } };
        }
        const params = q.params.slice();
        let tail = "";
        if (q.order) tail += ` ORDER BY ${buildOrder(q.order)}`;
        if (q.limit !== null) {
          params.push(q.limit);
          tail += ` LIMIT $${params.length}`;
        }
        if (q.offset !== null && q.offset > 0) {
          params.push(q.offset);
          tail += ` OFFSET $${params.length}`;
        }
        const sql = `WITH _q AS (SELECT ${selectSql} FROM ${relSql}${q.where}${tail}) SELECT coalesce(json_agg(_q), '[]')::text AS body, count(*)::int AS n FROM _q`;
        const r = await client.query(sql, params);
        const { body, n } = r.rows[0];
        return {
          status: 200,
          headers: { "Content-Range": contentRange(q.offset, n, total) },
          body: finishRows(body, n, wantObject, method),
        };
      }

      if (method === "POST") {
        const payload = parseJsonBody(bodyBuf, true);
        const rows = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? [payload] : null;
        if (!rows) throw new HttpError(400, { code: "PGRST102", message: "JSON のオブジェクトまたは配列を指定してください", details: null, hint: null });
        if (rows.length === 0) {
          return { status: 201, headers: { "Content-Range": "*/*" }, body: wantRepresentation ? "[]" : undefined };
        }
        const cols = [];
        for (const row of rows) {
          if (!row || typeof row !== "object" || Array.isArray(row)) throw new HttpError(400, { code: "PGRST102", message: "行はオブジェクトで指定してください", details: null, hint: null });
          for (const k of Object.keys(row)) if (!cols.includes(k)) cols.push(k);
        }
        const params = [];
        let sql;
        if (cols.length === 0) {
          sql = `INSERT INTO ${relSql} DEFAULT VALUES`;
        } else {
          const values = rows
            .map(
              (row) =>
                "(" +
                cols
                  .map((c) => {
                    if (Object.prototype.hasOwnProperty.call(row, c)) {
                      params.push(toParam(row[c]));
                      return `$${params.length}`;
                    }
                    return "DEFAULT";
                  })
                  .join(", ") +
                ")",
            )
            .join(", ");
          sql = `INSERT INTO ${relSql} (${cols.map(quoteIdent).join(", ")}) VALUES ${values}`;
        }
        if (prefer.resolution === "merge-duplicates" || prefer.resolution === "ignore-duplicates") {
          const conflictCols = q.onConflict ? q.onConflict.split(",").map((s) => s.trim()) : await primaryKeyColumns(client, table);
          if (conflictCols.length === 0) {
            throw new HttpError(400, { code: "PGRST100", message: "on_conflict の列を指定してください（主キーがありません）", details: null, hint: null });
          }
          const target = conflictCols.map(quoteIdent).join(", ");
          if (prefer.resolution === "ignore-duplicates" || cols.length === 0) {
            sql += ` ON CONFLICT (${target}) DO NOTHING`;
          } else {
            sql += ` ON CONFLICT (${target}) DO UPDATE SET ${cols.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(", ")}`;
          }
        }
        const wrapped = `WITH _ins AS (${sql} RETURNING *) SELECT coalesce(json_agg(_r), '[]')::text AS body, count(*)::int AS n FROM (SELECT ${selectSql} FROM _ins) _r`;
        const r = await client.query(wrapped, params);
        const { body, n } = r.rows[0];
        const headers = { "Content-Range": `*/${prefer.count ? n : "*"}` };
        if (!wantRepresentation) return { status: 201, headers };
        return { status: 201, headers, body: finishRows(body, n, wantObject, method) };
      }

      if (method === "PATCH") {
        const payload = parseJsonBody(bodyBuf, true);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new HttpError(400, { code: "PGRST102", message: "更新内容はオブジェクトで指定してください", details: null, hint: null });
        }
        if (q.conds.length === 0) {
          throw new HttpError(400, { code: "PGRST100", message: "UPDATE にはフィルタ（eq 等）が必要です", details: null, hint: null });
        }
        const keys = Object.keys(payload);
        if (keys.length === 0) {
          return { status: wantRepresentation ? 200 : 204, headers: { "Content-Range": "*/*" }, body: wantRepresentation ? "[]" : undefined };
        }
        const params = q.params.slice();
        const setSql = keys
          .map((k) => {
            params.push(toParam(payload[k]));
            return `${quoteIdent(k)} = $${params.length}`;
          })
          .join(", ");
        const wrapped = `WITH _u AS (UPDATE ${relSql} SET ${setSql}${q.where} RETURNING *) SELECT coalesce(json_agg(_r), '[]')::text AS body, count(*)::int AS n FROM (SELECT ${selectSql} FROM _u) _r`;
        const r = await client.query(wrapped, params);
        const { body, n } = r.rows[0];
        const headers = { "Content-Range": `*/${prefer.count ? n : "*"}` };
        if (!wantRepresentation) return { status: 204, headers };
        return { status: 200, headers, body: finishRows(body, n, wantObject, method) };
      }

      if (method === "DELETE") {
        if (q.conds.length === 0) {
          throw new HttpError(400, { code: "PGRST100", message: "DELETE にはフィルタ（eq 等）が必要です", details: null, hint: null });
        }
        const wrapped = `WITH _d AS (DELETE FROM ${relSql}${q.where} RETURNING *) SELECT coalesce(json_agg(_r), '[]')::text AS body, count(*)::int AS n FROM (SELECT ${selectSql} FROM _d) _r`;
        const r = await client.query(wrapped, q.params);
        const { body, n } = r.rows[0];
        const headers = { "Content-Range": `*/${prefer.count ? n : "*"}` };
        if (!wantRepresentation) return { status: 204, headers };
        return { status: 200, headers, body: finishRows(body, n, wantObject, method) };
      }

      throw new HttpError(405, { code: "PGRST105", message: `Method ${method} not allowed`, details: null, hint: null });
    } catch (e) {
      if (isPgError(e)) throw pgErrorToRest(e, ctx.role);
      throw e;
    }
  });
}

// ---------- RPC ----------
const fnCache = new Map();
async function resolveFunction(client, name, argNames) {
  let candidates = fnCache.get(name);
  if (!candidates) {
    const r = await client.query(
      `SELECT p.oid::int AS oid, p.proretset, p.proargnames, t.typname, t.typtype
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_type t ON t.oid = p.prorettype
        WHERE n.nspname = 'public' AND p.proname = $1 ORDER BY p.oid`,
      [name],
    );
    candidates = r.rows;
    fnCache.set(name, candidates);
  }
  if (candidates.length === 0) {
    throw new HttpError(404, {
      code: "PGRST202",
      message: `Could not find the function public.${name}(${argNames.join(", ")}) in the schema cache`,
      details: null,
      hint: `関数 public.${name} が見つかりません（マイグレーションを確認してください）`,
    });
  }
  const match = candidates.find((c) => argNames.every((a) => (c.proargnames ?? []).includes(a)));
  return match ?? candidates[0];
}

async function handleRpc(req, url, bodyBuf, ctx, fnName) {
  if (!IDENT_RE.test(fnName)) throw new HttpError(400, { code: "PGRST100", message: `関数名が不正です: ${fnName}`, details: null, hint: null });
  const prefer = parsePrefer(req.headers.prefer);
  const accept = String(req.headers.accept ?? "");
  const wantObject = accept.includes("application/vnd.pgrst.object+json");
  let args;
  if (req.method === "POST") {
    args = parseJsonBody(bodyBuf) ?? {};
  } else if (req.method === "GET" || req.method === "HEAD") {
    args = {};
    for (const [k, v] of url.searchParams) if (!RESERVED_PARAMS.has(k)) args[k] = v;
  } else {
    throw new HttpError(405, { code: "PGRST105", message: `Method ${req.method} not allowed`, details: null, hint: null });
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new HttpError(400, { code: "PGRST102", message: "RPC の引数は名前付きのオブジェクトで指定してください", details: null, hint: null });
  }
  const argNames = Object.keys(args);
  return withTx(ctx, async (client) => {
    try {
      const fn = await resolveFunction(client, fnName, argNames);
      const params = [];
      const argSql = argNames
        .map((k) => {
          params.push(toParam(args[k]));
          return `${quoteIdent(k)} := $${params.length}`;
        })
        .join(", ");
      const call = `"public".${quoteIdent(fnName)}(${argSql})`;
      const headers = { "Content-Range": "*/*" };
      if (fn.typname === "void") {
        await client.query(`SELECT ${call}`, params);
        return { status: 204, headers };
      }
      if (!fn.proretset) {
        // スカラー／単一の複合型：値そのものを返す
        const r = await client.query(`SELECT to_json(${call})::text AS body`, params);
        const body = r.rows[0].body ?? "null";
        if (req.method === "HEAD") return { status: 200, headers };
        return { status: 200, headers, body };
      }
      const composite = fn.typtype === "c" || fn.typtype === "p";
      const sql = composite
        ? `WITH _q AS (SELECT * FROM ${call} AS _r) SELECT coalesce(json_agg(_q), '[]')::text AS body, count(*)::int AS n FROM _q`
        : `SELECT coalesce(json_agg(_v), '[]')::text AS body, count(*)::int AS n FROM ${call} AS _r(_v)`;
      const r = await client.query(sql, params);
      const { body, n } = r.rows[0];
      headers["Content-Range"] = contentRange(0, n, prefer.count ? n : null);
      return { status: 200, headers, body: finishRows(body, n, wantObject, req.method) };
    } catch (e) {
      if (isPgError(e)) throw pgErrorToRest(e, ctx.role);
      throw e;
    }
  });
}

// ---------------------------------------------------------------------------
// GoTrue 互換 /auth/v1
// ---------------------------------------------------------------------------
const AUTH_CTX = { role: "supabase_auth_admin", claims: null, sub: null };

function authError(status, errorCode, msg) {
  return new HttpError(status, { code: status, error_code: errorCode, msg });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `$scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[1] !== "scrypt") return false;
  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function toUser(row) {
  if (!row) return null;
  const confirmed = isoOrNull(row.email_confirmed_at);
  return {
    id: row.id,
    aud: row.aud ?? "authenticated",
    role: row.role ?? "authenticated",
    email: row.email,
    email_confirmed_at: confirmed,
    phone: row.phone ?? "",
    confirmed_at: confirmed,
    invited_at: isoOrNull(row.invited_at),
    last_sign_in_at: isoOrNull(row.last_sign_in_at),
    app_metadata: row.raw_app_meta_data ?? { provider: "email", providers: ["email"] },
    user_metadata: row.raw_user_meta_data ?? {},
    identities: [],
    created_at: isoOrNull(row.created_at),
    updated_at: isoOrNull(row.updated_at),
    is_anonymous: Boolean(row.is_anonymous),
  };
}

const authState = {
  /** refresh_token → { userId, sessionId } */
  refreshTokens: new Map(),
  /** token_hash → { userId, email, type, used, createdAt, code, challenge, emailOtp } */
  otps: new Map(),
  /** email → 最後に発行した OTP（テスト用 /__test/last-otp） */
  lastOtpByEmail: new Map(),
  /** auth_code（PKCE） → { userId, challenge, method } */
  pkceCodes: new Map(),
};

async function findUserByEmail(client, email) {
  const r = await client.query("SELECT * FROM auth.users WHERE lower(email) = lower($1) LIMIT 1", [email]);
  return r.rows[0] ?? null;
}
async function findUserById(client, id) {
  const r = await client.query("SELECT * FROM auth.users WHERE id = $1", [id]);
  return r.rows[0] ?? null;
}

/** auth.users への INSERT（public.on_auth_user_created トリガーが走る。招待が無ければ失敗） */
async function insertUser(client, { email, password, emailConfirm, userMetadata, appMetadata, phone, invitedAt }) {
  try {
    const r = await client.query(
      `INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, raw_app_meta_data, raw_user_meta_data, phone, created_at, updated_at, is_anonymous)
       VALUES (gen_random_uuid(), 'authenticated', 'authenticated', lower($1), $2, CASE WHEN $3::boolean THEN now() ELSE NULL END, $4::timestamptz,
               $5::jsonb, $6::jsonb, $7, now(), now(), false)
       RETURNING *`,
      [
        email,
        password ? hashPassword(password) : null,
        Boolean(emailConfirm),
        invitedAt ?? null,
        JSON.stringify(appMetadata ?? { provider: "email", providers: ["email"] }),
        JSON.stringify(userMetadata ?? {}),
        phone ?? "",
      ],
    );
    return r.rows[0];
  } catch (e) {
    if (isPgError(e) && e.code === "23505") {
      throw authError(422, "email_exists", "A user with this email address has already been registered");
    }
    if (isPgError(e)) {
      console.error(`[supabase-lite] auth.users への INSERT に失敗: ${e.message}${e.hint ? ` (hint: ${e.hint})` : ""}`);
      throw authError(500, "unexpected_failure", "Database error creating new user");
    }
    throw e;
  }
}

async function issueSession(client, user, { amrMethod = "otp", sessionId } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_TTL;
  const sid = sessionId ?? crypto.randomUUID();
  await client.query("UPDATE auth.users SET last_sign_in_at = now(), updated_at = now() WHERE id = $1", [user.id]);
  const fresh = (await findUserById(client, user.id)) ?? user;
  const claims = {
    iss: ISSUER,
    sub: fresh.id,
    aud: "authenticated",
    exp,
    iat: now,
    email: fresh.email,
    phone: fresh.phone ?? "",
    app_metadata: fresh.raw_app_meta_data ?? { provider: "email", providers: ["email"] },
    user_metadata: fresh.raw_user_meta_data ?? {},
    role: "authenticated",
    aal: "aal1",
    amr: [{ method: amrMethod, timestamp: now }],
    session_id: sid,
    is_anonymous: false,
  };
  const accessToken = await new SignJWT(claims).setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(SECRET);
  const refreshToken = crypto.randomBytes(24).toString("base64url");
  authState.refreshTokens.set(refreshToken, { userId: fresh.id, sessionId: sid });
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL,
    expires_at: exp,
    refresh_token: refreshToken,
    user: toUser(fresh),
  };
}

function createOtp({ user, type, challenge, challengeMethod, redirectTo }) {
  const tokenHash = crypto.randomBytes(24).toString("hex");
  const emailOtp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  const code = crypto.randomUUID();
  const rec = { userId: user.id, email: user.email, type, used: false, createdAt: Date.now(), emailOtp, code, challenge: challenge ?? null, challengeMethod: challengeMethod ?? "s256" };
  authState.otps.set(tokenHash, rec);
  authState.pkceCodes.set(code, { userId: user.id, challenge: challenge ?? null, method: challengeMethod ?? "s256" });
  const redirect = redirectTo ?? SITE_URL;
  const link = `http://${HOST}:${PORT}/auth/v1/verify?token=${tokenHash}&type=${encodeURIComponent(type)}&redirect_to=${encodeURIComponent(redirect)}`;
  const entry = { email: user.email, token_hash: tokenHash, type, link, email_otp: emailOtp, code, redirect_to: redirect };
  authState.lastOtpByEmail.set(user.email.toLowerCase(), entry);
  return entry;
}

const OTP_TYPES = new Set(["magiclink", "invite", "recovery", "email", "signup", "email_change"]);

async function consumeOtp(client, { type, tokenHash, email, token }) {
  let hash = tokenHash;
  if (!hash && email && token) {
    for (const [h, rec] of authState.otps) if (!rec.used && rec.email.toLowerCase() === email.toLowerCase() && rec.emailOtp === token) hash = h;
  }
  const rec = hash ? authState.otps.get(hash) : null;
  if (!rec || rec.used || Date.now() - rec.createdAt > 24 * 3600 * 1000) {
    throw authError(403, "otp_expired", "Token has expired or is invalid");
  }
  if (type && OTP_TYPES.has(type) && type !== rec.type && !(type === "email" || rec.type === "email")) {
    // GoTrue は magiclink/signup/invite を同一視する。厳密にしすぎない
    if (!(["magiclink", "signup", "invite"].includes(type) && ["magiclink", "signup", "invite"].includes(rec.type))) {
      throw authError(403, "otp_expired", "Token has expired or is invalid");
    }
  }
  rec.used = true;
  const user = await findUserById(client, rec.userId);
  if (!user) throw authError(403, "user_not_found", "User not found");
  await client.query("UPDATE auth.users SET email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() WHERE id = $1", [user.id]);
  return await findUserById(client, user.id);
}

async function requireUserFromBearer(req, client) {
  const token = bearerOf(req);
  if (!token) throw authError(401, "no_authorization", "This endpoint requires a Bearer token");
  let claims;
  try {
    claims = await verifyJwt(token);
  } catch (e) {
    throw authError(401, "bad_jwt", `invalid JWT: ${e.message}`);
  }
  if (typeof claims.sub !== "string") throw authError(401, "bad_jwt", "invalid claim: missing sub claim");
  const user = await findUserById(client, claims.sub);
  if (!user) throw authError(403, "user_not_found", "User from sub claim in JWT does not exist");
  return { user, claims };
}

async function requireServiceRole(req) {
  const token = bearerOf(req) ?? (typeof req.headers.apikey === "string" ? req.headers.apikey : null);
  if (!token) throw authError(401, "no_authorization", "This endpoint requires a valid Bearer token");
  let claims;
  try {
    claims = await verifyJwt(token);
  } catch (e) {
    throw authError(401, "bad_jwt", `invalid JWT: ${e.message}`);
  }
  if (claims.role !== "service_role") throw authError(401, "not_admin", "User not allowed");
  return claims;
}

async function handleAuth(req, url, bodyBuf) {
  const sub = url.pathname.slice("/auth/v1/".length).replace(/\/+$/, "");
  const method = req.method;
  const body = method === "GET" || method === "HEAD" ? {} : (parseJsonBody(bodyBuf) ?? {});

  if (sub === "health" && method === "GET") return { status: 200, body: { version: "supabase-lite", name: "GoTrue", description: "Supabase 互換テストサーバー" } };
  if (sub === "settings" && method === "GET") {
    return { status: 200, body: { external: { email: true, phone: false }, disable_signup: true, mailer_autoconfirm: false, phone_autoconfirm: false, sms_provider: "", saml_enabled: false, external_labels: {} } };
  }
  if (sub === ".well-known/jwks.json" && method === "GET") return { status: 200, body: { keys: [] } };

  // ---- ログイン系 ----
  if (sub === "token" && method === "POST") {
    const grant = url.searchParams.get("grant_type");
    return withTx(AUTH_CTX, async (client) => {
      if (grant === "password") {
        const email = String(body.email ?? "").trim();
        const password = String(body.password ?? "");
        const user = email ? await findUserByEmail(client, email) : null;
        if (!user || !verifyPassword(password, user.encrypted_password)) throw authError(400, "invalid_credentials", "Invalid login credentials");
        if (!user.email_confirmed_at) throw authError(400, "email_not_confirmed", "Email not confirmed");
        return { status: 200, body: await issueSession(client, user, { amrMethod: "password" }) };
      }
      if (grant === "refresh_token") {
        const rt = String(body.refresh_token ?? "");
        const rec = authState.refreshTokens.get(rt);
        if (!rec) throw authError(400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
        authState.refreshTokens.delete(rt);
        const user = await findUserById(client, rec.userId);
        if (!user) throw authError(400, "user_not_found", "User not found");
        return { status: 200, body: await issueSession(client, user, { amrMethod: "otp", sessionId: rec.sessionId }) };
      }
      if (grant === "pkce") {
        const code = String(body.auth_code ?? "");
        const verifier = String(body.code_verifier ?? "");
        const rec = authState.pkceCodes.get(code);
        if (!rec) throw authError(404, "flow_state_not_found", "invalid flow state, no valid flow state found");
        if (rec.challenge) {
          const digest = rec.method === "plain" ? verifier : crypto.createHash("sha256").update(verifier).digest("base64url");
          if (digest !== rec.challenge) throw authError(400, "bad_code_verifier", "code challenge does not match previously saved code verifier");
        }
        authState.pkceCodes.delete(code);
        const user = await findUserById(client, rec.userId);
        if (!user) throw authError(404, "user_not_found", "User not found");
        await client.query("UPDATE auth.users SET email_confirmed_at = coalesce(email_confirmed_at, now()) WHERE id = $1", [user.id]);
        return { status: 200, body: await issueSession(client, user) };
      }
      throw authError(400, "invalid_grant", `unsupported grant_type: ${grant}`);
    });
  }

  if (sub === "signup" && method === "POST") {
    throw authError(422, "signup_disabled", "Signups not allowed for this instance");
  }

  if ((sub === "otp" || sub === "magiclink") && method === "POST") {
    const email = String(body.email ?? "").trim();
    if (!email) throw authError(400, "validation_failed", "An email address is required");
    return withTx(AUTH_CTX, async (client) => {
      let user = await findUserByEmail(client, email);
      if (!user && body.create_user === true) {
        user = await insertUser(client, { email, emailConfirm: false, userMetadata: body.data ?? {} });
      }
      if (user) {
        createOtp({ user, type: "magiclink", challenge: body.code_challenge, challengeMethod: body.code_challenge_method, redirectTo: url.searchParams.get("redirect_to") });
      }
      // 存在しないメールでも 200（情報漏えい防止。GoTrue と同様）
      return { status: 200, body: {} };
    });
  }

  if (sub === "recover" && method === "POST") {
    const email = String(body.email ?? "").trim();
    if (!email) throw authError(400, "validation_failed", "An email address is required");
    return withTx(AUTH_CTX, async (client) => {
      const user = await findUserByEmail(client, email);
      if (user) createOtp({ user, type: "recovery", challenge: body.code_challenge, challengeMethod: body.code_challenge_method, redirectTo: url.searchParams.get("redirect_to") });
      return { status: 200, body: {} };
    });
  }

  if (sub === "verify" && method === "POST") {
    return withTx(AUTH_CTX, async (client) => {
      const user = await consumeOtp(client, { type: body.type, tokenHash: body.token_hash, email: body.email, token: body.token });
      return { status: 200, body: await issueSession(client, user, { amrMethod: "otp" }) };
    });
  }

  if (sub === "verify" && method === "GET") {
    const tokenHash = url.searchParams.get("token") ?? url.searchParams.get("token_hash");
    const type = url.searchParams.get("type") ?? "magiclink";
    const redirectTo = url.searchParams.get("redirect_to") ?? SITE_URL;
    return withTx(AUTH_CTX, async (client) => {
      let location;
      try {
        const user = await consumeOtp(client, { type, tokenHash });
        const s = await issueSession(client, user);
        const frag = new URLSearchParams({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: String(s.expires_in), expires_at: String(s.expires_at), token_type: "bearer", type });
        location = `${redirectTo}#${frag.toString()}`;
      } catch (e) {
        const q = new URLSearchParams({ error: "access_denied", error_code: e.body?.error_code ?? "otp_expired", error_description: e.body?.msg ?? "Email link is invalid or has expired" });
        location = `${redirectTo}#${q.toString()}`;
      }
      return { status: 303, headers: { Location: location } };
    });
  }

  if (sub === "logout" && method === "POST") {
    const token = bearerOf(req);
    if (token) {
      try {
        const claims = await verifyJwt(token);
        for (const [rt, rec] of authState.refreshTokens) if (rec.sessionId === claims.session_id || rec.userId === claims.sub) authState.refreshTokens.delete(rt);
      } catch {
        // 無効なトークンでも 204（auth-js は 401/403/404 も無視する）
      }
    }
    return { status: 204 };
  }

  if (sub === "user" && method === "GET") {
    return withTx(AUTH_CTX, async (client) => {
      const { user } = await requireUserFromBearer(req, client);
      return { status: 200, body: toUser(user) };
    });
  }

  if (sub === "user" && method === "PUT") {
    return withTx(AUTH_CTX, async (client) => {
      const { user } = await requireUserFromBearer(req, client);
      await applyUserUpdate(client, user, body);
      return { status: 200, body: toUser(await findUserById(client, user.id)) };
    });
  }

  // ---- 管理 API（service_role 必須） ----
  if (sub.startsWith("admin/") || sub === "invite") {
    await requireServiceRole(req);
  }

  if (sub === "admin/users" && method === "POST") {
    const email = String(body.email ?? "").trim();
    if (!email) throw authError(400, "validation_failed", "Cannot create a user without either an email or phone");
    return withTx(AUTH_CTX, async (client) => {
      const user = await insertUser(client, {
        email,
        password: body.password ? String(body.password) : null,
        emailConfirm: body.email_confirm === true,
        userMetadata: body.user_metadata ?? {},
        appMetadata: body.app_metadata ? { provider: "email", providers: ["email"], ...body.app_metadata } : undefined,
        phone: body.phone,
      });
      return { status: 200, body: toUser(user) };
    });
  }

  if (sub === "admin/users" && method === "GET") {
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const perPage = Math.min(1000, Math.max(1, Number(url.searchParams.get("per_page") || 50)));
    return withTx(AUTH_CTX, async (client) => {
      const total = (await client.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n;
      const r = await client.query("SELECT * FROM auth.users ORDER BY created_at DESC, id LIMIT $1 OFFSET $2", [perPage, (page - 1) * perPage]);
      return { status: 200, headers: { "X-Total-Count": String(total) }, body: { users: r.rows.map(toUser), aud: "authenticated" } };
    });
  }

  const adminUser = /^admin\/users\/([0-9a-fA-F-]{36})$/.exec(sub);
  if (adminUser) {
    const id = adminUser[1];
    return withTx(AUTH_CTX, async (client) => {
      const user = await findUserById(client, id);
      if (!user) throw authError(404, "user_not_found", "User not found");
      if (method === "GET") return { status: 200, body: toUser(user) };
      if (method === "PUT") {
        await applyUserUpdate(client, user, body, { admin: true });
        return { status: 200, body: toUser(await findUserById(client, id)) };
      }
      if (method === "DELETE") {
        await client.query("DELETE FROM auth.users WHERE id = $1", [id]);
        for (const [rt, rec] of authState.refreshTokens) if (rec.userId === id) authState.refreshTokens.delete(rt);
        return { status: 200, body: {} };
      }
      throw authError(405, "method_not_allowed", "Method not allowed");
    });
  }

  if (sub === "admin/generate_link" && method === "POST") {
    const type = String(body.type ?? "magiclink");
    const email = String(body.email ?? "").trim();
    if (!email) throw authError(400, "validation_failed", "An email address is required");
    const redirectTo = url.searchParams.get("redirect_to") ?? body.redirect_to ?? SITE_URL;
    return withTx(AUTH_CTX, async (client) => {
      let user = await findUserByEmail(client, email);
      if (!user) {
        if (type === "magiclink" || type === "recovery") throw authError(404, "user_not_found", "User not found");
        user = await insertUser(client, {
          email,
          password: body.password ? String(body.password) : null,
          emailConfirm: false,
          userMetadata: body.data ?? {},
          invitedAt: type === "invite" ? new Date().toISOString() : null,
        });
      }
      const otpType = type === "signup" ? "signup" : type;
      const otp = createOtp({ user, type: otpType, redirectTo });
      return {
        status: 200,
        body: {
          action_link: otp.link,
          email_otp: otp.email_otp,
          hashed_token: otp.token_hash,
          redirect_to: otp.redirect_to,
          verification_type: otpType,
          ...toUser(user),
        },
      };
    });
  }

  if (sub === "invite" && method === "POST") {
    const email = String(body.email ?? "").trim();
    if (!email) throw authError(400, "validation_failed", "An email address is required");
    const redirectTo = url.searchParams.get("redirect_to") ?? SITE_URL;
    return withTx(AUTH_CTX, async (client) => {
      let user = await findUserByEmail(client, email);
      if (!user) {
        user = await insertUser(client, { email, emailConfirm: false, userMetadata: body.data ?? {}, invitedAt: new Date().toISOString() });
      } else {
        await client.query("UPDATE auth.users SET invited_at = now(), updated_at = now() WHERE id = $1", [user.id]);
        user = await findUserById(client, user.id);
      }
      createOtp({ user, type: "invite", redirectTo });
      return { status: 200, body: toUser(user) };
    });
  }

  throw authError(404, "not_found", `Unknown auth endpoint: ${method} /auth/v1/${sub}`);
}

async function applyUserUpdate(client, user, body, { admin = false } = {}) {
  const sets = [];
  const params = [];
  const push = (sql, v) => {
    params.push(v);
    sets.push(`${sql} $${params.length}`);
  };
  if (typeof body.email === "string" && body.email.trim() && body.email.trim().toLowerCase() !== user.email) {
    const dup = await findUserByEmail(client, body.email.trim());
    if (dup) throw authError(422, "email_exists", "A user with this email address has already been registered");
    push("email =", body.email.trim().toLowerCase());
    if (admin && body.email_confirm !== true) sets.push("email_confirmed_at = NULL");
  }
  if (typeof body.password === "string") {
    if (body.password.length < 6) throw authError(422, "weak_password", "Password should be at least 6 characters.");
    push("encrypted_password =", hashPassword(body.password));
  }
  if (body.data && typeof body.data === "object") push("raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) ||", JSON.stringify(body.data));
  if (admin && body.user_metadata && typeof body.user_metadata === "object") push("raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) ||", JSON.stringify(body.user_metadata));
  if (admin && body.app_metadata && typeof body.app_metadata === "object") push("raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) ||", JSON.stringify(body.app_metadata));
  if (admin && body.email_confirm === true) sets.push("email_confirmed_at = coalesce(email_confirmed_at, now())");
  if (typeof body.phone === "string") push("phone =", body.phone);
  if (sets.length === 0) return;
  sets.push("updated_at = now()");
  params.push(user.id);
  await client.query(`UPDATE auth.users SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

// ---------------------------------------------------------------------------
// Storage 互換 /storage/v1
// ---------------------------------------------------------------------------
function storageError(status, statusCode, error, message) {
  return new HttpError(status, { statusCode: String(statusCode), error, message });
}

function parseObjectPath(rest) {
  const decoded = rest.split("/").map((s) => decodeURIComponent(s));
  const bucket = decoded.shift() ?? "";
  const objectPath = decoded.join("/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
  if (!bucket || !IDENT_RE.test(bucket.replace(/-/g, "_"))) throw storageError(400, 400, "InvalidRequest", "バケット名が不正です");
  if (!objectPath || objectPath.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw storageError(400, 400, "InvalidRequest", "オブジェクトのパスが不正です");
  }
  return { bucket, objectPath };
}

function storageFilePath(bucket, objectPath) {
  const file = path.resolve(STORAGE_DIR, bucket, objectPath);
  if (!file.startsWith(STORAGE_DIR + path.sep)) throw storageError(400, 400, "InvalidRequest", "パスが不正です");
  return file;
}

function pgErrorToStorage(e, role) {
  if (e.code === "42501") return storageError(role === "anon" ? 401 : 403, 403, "Unauthorized", e.message);
  return storageError(400, e.code, "DatabaseError", e.message);
}

async function extractUpload(req, bodyBuf) {
  const ct = String(req.headers["content-type"] ?? "");
  if (ct.startsWith("multipart/form-data")) {
    const fd = await new Response(bodyBuf, { headers: { "content-type": ct } }).formData();
    let file = null;
    let cacheControl = "3600";
    for (const [key, value] of fd.entries()) {
      if (typeof value !== "string" && !file) file = value;
      else if (key === "cacheControl" && typeof value === "string") cacheControl = value;
    }
    if (!file) throw storageError(400, 400, "InvalidRequest", "ファイルが含まれていません");
    return { data: Buffer.from(await file.arrayBuffer()), mimetype: file.type || "application/octet-stream", cacheControl: `max-age=${cacheControl}` };
  }
  return { data: bodyBuf, mimetype: ct || "application/octet-stream", cacheControl: String(req.headers["cache-control"] ?? "max-age=3600") };
}

async function serveFile(bucket, objectPath, metadata) {
  const file = storageFilePath(bucket, objectPath);
  if (!fs.existsSync(file)) throw storageError(404, 404, "not_found", "Object not found");
  const stat = fs.statSync(file);
  return {
    status: 200,
    headers: {
      "Content-Type": metadata?.mimetype ?? "application/octet-stream",
      "Content-Length": String(stat.size),
      "Cache-Control": metadata?.cacheControl ?? "no-cache",
      ETag: metadata?.eTag ?? `"${stat.mtimeMs}"`,
      "Last-Modified": stat.mtime.toUTCString(),
    },
    stream: fs.createReadStream(file),
  };
}

async function handleStorage(req, url, bodyBuf, ctxPromise) {
  const sub = url.pathname.slice("/storage/v1/".length).replace(/\/+$/, "");
  const method = req.method;

  // 署名付き URL からのダウンロード（認証不要）
  if (sub.startsWith("object/sign/") && method === "GET") {
    const { bucket, objectPath } = parseObjectPath(sub.slice("object/sign/".length));
    const token = url.searchParams.get("token") ?? "";
    let claims;
    try {
      claims = await verifyJwt(token);
    } catch {
      throw storageError(400, 400, "InvalidJWT", "署名付き URL のトークンが無効です");
    }
    if (claims.url !== `${bucket}/${objectPath}`) throw storageError(400, 400, "InvalidJWT", "署名付き URL のパスが一致しません");
    const meta = await withTx({ role: "service_role", claims: { role: "service_role" }, sub: null }, async (client) => {
      const r = await client.query("SELECT metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2", [bucket, objectPath]);
      return r.rows[0]?.metadata ?? null;
    });
    return serveFile(bucket, objectPath, meta);
  }

  const ctx = await ctxPromise;

  if (sub === "bucket" && method === "GET") {
    return withTx(ctx, async (client) => {
      const r = await client.query(
        "SELECT coalesce(json_agg(b), '[]')::text AS body FROM (SELECT id, name, owner, public, created_at, updated_at, NULL::text[] AS allowed_mime_types, NULL::bigint AS file_size_limit FROM storage.buckets ORDER BY name) b",
      );
      return { status: 200, body: r.rows[0].body };
    }).catch((e) => {
      throw isPgError(e) ? pgErrorToStorage(e, ctx.role) : e;
    });
  }

  if (sub.startsWith("object/sign/") && method === "POST") {
    const { bucket, objectPath } = parseObjectPath(sub.slice("object/sign/".length));
    const body = parseJsonBody(bodyBuf) ?? {};
    const expiresIn = Math.max(1, Number(body.expiresIn ?? 60));
    await withTx(ctx, async (client) => {
      const r = await client.query("SELECT id FROM storage.objects WHERE bucket_id = $1 AND name = $2", [bucket, objectPath]);
      if (r.rowCount === 0) throw storageError(400, 404, "not_found", "Object not found");
    }).catch((e) => {
      throw isPgError(e) ? pgErrorToStorage(e, ctx.role) : e;
    });
    const token = await new SignJWT({ url: `${bucket}/${objectPath}` })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
      .sign(SECRET);
    return { status: 200, body: { signedURL: `/object/sign/${bucket}/${objectPath}?token=${token}` } };
  }

  if (sub.startsWith("object/list/") && method === "POST") {
    const bucket = decodeURIComponent(sub.slice("object/list/".length));
    const body = parseJsonBody(bodyBuf) ?? {};
    let prefix = String(body.prefix ?? "").replace(/^\/+|\/+$/g, "");
    if (prefix) prefix += "/";
    const limit = Math.max(0, Number(body.limit ?? 100));
    const offset = Math.max(0, Number(body.offset ?? 0));
    const sortCol = ["name", "updated_at", "created_at", "last_accessed_at"].includes(body.sortBy?.column) ? body.sortBy.column : "name";
    const sortAsc = String(body.sortBy?.order ?? "asc").toLowerCase() !== "desc";
    const search = String(body.search ?? "");
    return withTx(ctx, async (client) => {
      const r = await client.query(
        "SELECT id, name, created_at, updated_at, metadata FROM storage.objects WHERE bucket_id = $1 AND name LIKE $2 || '%' ORDER BY name",
        [bucket, prefix.replace(/[\\%_]/g, (m) => `\\${m}`)],
      );
      const folders = new Map();
      const files = [];
      for (const row of r.rows) {
        const rel = row.name.slice(prefix.length);
        const slash = rel.indexOf("/");
        if (slash >= 0) {
          const folder = rel.slice(0, slash);
          if (!folders.has(folder)) folders.set(folder, { name: folder, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
        } else {
          files.push({ name: rel, id: row.id, updated_at: isoOrNull(row.updated_at), created_at: isoOrNull(row.created_at), last_accessed_at: isoOrNull(row.created_at), metadata: row.metadata });
        }
      }
      let entries = [...folders.values(), ...files];
      if (search) entries = entries.filter((e) => e.name.includes(search));
      entries.sort((a, b) => {
        const av = a[sortCol] ?? "";
        const bv = b[sortCol] ?? "";
        const c = av < bv ? -1 : av > bv ? 1 : 0;
        return sortAsc ? c : -c;
      });
      return { status: 200, body: entries.slice(offset, offset + limit) };
    }).catch((e) => {
      throw isPgError(e) ? pgErrorToStorage(e, ctx.role) : e;
    });
  }

  if (sub.startsWith("object/info/") && method === "GET") {
    const { bucket, objectPath } = parseObjectPath(sub.slice("object/info/".length));
    return withTx(ctx, async (client) => {
      const r = await client.query("SELECT id, name, created_at, updated_at, metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2", [bucket, objectPath]);
      const row = r.rows[0];
      if (!row) throw storageError(404, 404, "not_found", "Object not found");
      return {
        status: 200,
        body: { id: row.id, name: row.name, bucket_id: bucket, created_at: isoOrNull(row.created_at), updated_at: isoOrNull(row.updated_at), last_modified: isoOrNull(row.updated_at), metadata: row.metadata, size: row.metadata?.size ?? null, content_type: row.metadata?.mimetype ?? null },
      };
    }).catch((e) => {
      throw isPgError(e) ? pgErrorToStorage(e, ctx.role) : e;
    });
  }

  if (sub.startsWith("object/authenticated/") && (method === "GET" || method === "HEAD")) {
    return downloadObject(ctx, parseObjectPath(sub.slice("object/authenticated/".length)), method);
  }

  if (sub.startsWith("object/") && !sub.startsWith("object/upload/") && !sub.startsWith("object/public/")) {
    const rest = sub.slice("object/".length);
    if (method === "GET" || method === "HEAD") return downloadObject(ctx, parseObjectPath(rest), method);
    if (method === "POST" || method === "PUT") {
      const { bucket, objectPath } = parseObjectPath(rest);
      const upsert = String(req.headers["x-upsert"] ?? "false").toLowerCase() === "true" || method === "PUT";
      const upload = await extractUpload(req, bodyBuf);
      const metadata = {
        eTag: `"${crypto.createHash("md5").update(upload.data).digest("hex")}"`,
        size: upload.data.length,
        mimetype: upload.mimetype,
        cacheControl: upload.cacheControl,
        lastModified: new Date().toISOString(),
        contentLength: upload.data.length,
        httpStatusCode: 200,
      };
      return withTx(ctx, async (client) => {
        const b = await client.query("SELECT id FROM storage.buckets WHERE id = $1", [bucket]);
        if (b.rowCount === 0) throw storageError(404, 404, "Bucket not found", "Bucket not found");
        const existing = await client.query("SELECT id FROM storage.objects WHERE bucket_id = $1 AND name = $2", [bucket, objectPath]);
        let id;
        if (existing.rowCount > 0) {
          if (!upsert) throw storageError(400, 409, "Duplicate", "The resource already exists");
          const u = await client.query("UPDATE storage.objects SET metadata = $3::jsonb, updated_at = now(), owner = $4 WHERE bucket_id = $1 AND name = $2 RETURNING id", [
            bucket,
            objectPath,
            JSON.stringify(metadata),
            ctx.sub,
          ]);
          if (u.rowCount === 0) throw storageError(403, 403, "Unauthorized", "new row violates row-level security policy");
          id = u.rows[0].id;
        } else {
          const ins = await client.query("INSERT INTO storage.objects (bucket_id, name, owner, metadata) VALUES ($1, $2, $3, $4::jsonb) RETURNING id", [
            bucket,
            objectPath,
            ctx.sub,
            JSON.stringify(metadata),
          ]);
          id = ins.rows[0].id;
        }
        const file = storageFilePath(bucket, objectPath);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, upload.data);
        return { status: 200, body: { Key: `${bucket}/${objectPath}`, Id: id } };
      }).catch((e) => {
        throw isPgError(e) ? pgErrorToStorage(e, ctx.role) : e;
      });
    }
    if (method === "DELETE") {
      // POST /object/:bucket { prefixes: [...] } 相当（supabase-js の remove）
      const bucket = decodeURIComponent(rest.split("/")[0]);
      const body = parseJsonBody(bodyBuf) ?? {};
      const prefixes = Array.isArray(body.prefixes) ? body.prefixes.map(String) : [];
      return withTx(ctx, async (client) => {
        const removed = [];
        for (const p of prefixes) {
          const r = await client.query("DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2 RETURNING id, name, created_at, updated_at, metadata", [bucket, p]);
          for (const row of r.rows) {
            const file = storageFilePath(bucket, row.name);
            if (fs.existsSync(file)) fs.unlinkSync(file);
            removed.push({ id: row.id, name: row.name, bucket_id: bucket, created_at: isoOrNull(row.created_at), updated_at: isoOrNull(row.updated_at), metadata: row.metadata });
          }
        }
        return { status: 200, body: removed };
      }).catch((e) => {
        throw isPgError(e) ? pgErrorToStorage(e, ctx.role) : e;
      });
    }
  }

  throw storageError(404, 404, "not_found", `Unknown storage endpoint: ${method} /storage/v1/${sub}`);
}

async function downloadObject(ctx, { bucket, objectPath }, method) {
  const meta = await withTx(ctx, async (client) => {
    const r = await client.query("SELECT metadata FROM storage.objects WHERE bucket_id = $1 AND name = $2", [bucket, objectPath]);
    if (r.rowCount === 0) throw storageError(404, 404, "not_found", "Object not found");
    return r.rows[0].metadata;
  }).catch((e) => {
    throw isPgError(e) ? pgErrorToStorage(e, ctx.role) : e;
  });
  const out = await serveFile(bucket, objectPath, meta);
  if (method === "HEAD") {
    out.stream.destroy();
    delete out.stream;
  }
  return out;
}

// ---------------------------------------------------------------------------
// テスト補助 /__test
// ---------------------------------------------------------------------------
function handleTest(req, url) {
  const sub = url.pathname.slice("/__test/".length);
  if (sub === "keys") return { status: 200, body: { anon: ANON_KEY, service_role: SERVICE_ROLE_KEY } };
  if (sub === "last-otp") {
    const email = String(url.searchParams.get("email") ?? "").toLowerCase();
    const entry = authState.lastOtpByEmail.get(email);
    if (!entry) return { status: 404, body: { error: "not_found", message: `OTP が発行されていません: ${email}` } };
    return { status: 200, body: entry };
  }
  if (sub === "reset-auth" && req.method === "POST") {
    authState.refreshTokens.clear();
    authState.otps.clear();
    authState.lastOtpByEmail.clear();
    authState.pkceCodes.clear();
    return { status: 200, body: { ok: true } };
  }
  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------------
// HTTP サーバー
// ---------------------------------------------------------------------------
function dbNameOf(urlStr) {
  try {
    return new URL(urlStr).pathname.replace(/^\//, "");
  } catch {
    return urlStr;
  }
}

async function route(req, url, bodyBuf) {
  const p = url.pathname;
  if (req.method === "OPTIONS") return { status: 204 };
  if (p === "/" || p === "/health") {
    return { status: 200, body: { name: "supabase-lite", version: "0.1.0", db: dbNameOf(DB_URL), storage: STORAGE_DIR, site_url: SITE_URL } };
  }
  if (p.startsWith("/__test/")) return handleTest(req, url);
  if (p.startsWith("/rest/v1/") || p === "/rest/v1") {
    const ctx = await restContext(req);
    return handleRest(req, url, bodyBuf, ctx);
  }
  if (p.startsWith("/auth/v1/")) return handleAuth(req, url, bodyBuf);
  if (p.startsWith("/storage/v1/")) return handleStorage(req, url, bodyBuf, restContext(req).catch((e) => Promise.reject(e)));
  return { status: 404, body: { message: `Not found: ${req.method} ${p}` } };
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  let status = 500;
  try {
    const bodyBuf = await readBody(req);
    const out = await route(req, url, bodyBuf);
    status = out.status;
    if (out.stream) {
      res.writeHead(status, out.headers ?? {});
      out.stream.pipe(res);
    } else {
      send(res, status, out.body, out.headers ?? {});
    }
  } catch (e) {
    if (e instanceof HttpError) {
      status = e.status;
      send(res, e.status, e.body, e.headers);
      if (VERBOSE) console.error(`[supabase-lite] ${req.method} ${url.pathname} → ${e.status} ${typeof e.body === "object" ? JSON.stringify(e.body) : e.body}`);
    } else if (e instanceof HttpError || isPgError(e)) {
      status = 400;
      send(res, 400, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null });
      console.error(`[supabase-lite] DB error: ${e.message}`);
    } else {
      status = 500;
      console.error(`[supabase-lite] ${req.method} ${url.pathname} で予期しないエラー:`, e);
      send(res, 500, { message: String(e?.message ?? e), code: "500" });
    }
  } finally {
    log(`${req.method} ${url.pathname}${url.search} → ${status} (${Date.now() - started}ms)`);
  }
});

fs.mkdirSync(STORAGE_DIR, { recursive: true });

server.listen(PORT, HOST, async () => {
  try {
    await pool.query("SELECT 1");
  } catch (e) {
    console.error(`[supabase-lite] PostgreSQL に接続できません (${DB_URL}): ${e.message}`);
    process.exit(1);
  }
  console.log(`[supabase-lite] listening on http://${HOST}:${PORT} (db=${dbNameOf(DB_URL)}, storage=${STORAGE_DIR})`);
  console.log(`ANON_KEY=${ANON_KEY}`);
  console.log(`SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}`);
});

function shutdown(signal) {
  log(`${signal} を受信。終了します`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
