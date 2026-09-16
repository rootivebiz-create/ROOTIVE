/**
 * E2E 共通ヘルパー（Playwright のテストと global-setup から使う）
 *
 * - 固定の会社・ユーザー・招待トークン（global-setup が投入する）
 * - .state.json（起動した supabase-lite / Next.js の URL・鍵・PID）の読み書き
 * - psql 経由の SQL 実行、supabase-js クライアント、ログイン補助
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/db/database.types";

export type E2ERole = "owner" | "admin" | "viewer";

export interface E2EUser {
  email: string;
  /** 招待トークン（/invite/<token>）。lib/actions/auth.ts の検証に合わせて 16 進 48 文字 */
  token: string;
  displayName: string;
  role: E2ERole;
}

/** 招待トークンは 16 進のみ許可されるため "e2e" ＋ 0 埋め ＋ 末尾の番号で識別する */
function fixedToken(n: number): string {
  return `e2e${"0".repeat(44)}${n}`;
}

export const E2E = {
  dbName: "rootive_e2e",
  pgPort: Number(process.env.TEST_PG_PORT ?? 54329),
  litePort: Number(process.env.E2E_LITE_PORT ?? 54321),
  appPort: Number(process.env.E2E_PORT ?? 3100),
  companyName: "株式会社ROOTIVE",
  users: {
    owner: { email: "owner@example.com", token: fixedToken(1), displayName: "オーナー", role: "owner" },
    admin: { email: "admin@example.com", token: fixedToken(2), displayName: "管理者", role: "admin" },
    viewer: { email: "viewer@example.com", token: fixedToken(3), displayName: "閲覧者", role: "viewer" },
  } satisfies Record<E2ERole, E2EUser>,
  get liteUrl() {
    return `http://127.0.0.1:${this.litePort}`;
  },
  get appUrl() {
    return `http://127.0.0.1:${this.appPort}`;
  },
  get dbUrl() {
    return process.env.TEST_DATABASE_URL ? `${process.env.TEST_DATABASE_URL.replace(/\/[^/]*$/, "")}/${this.dbName}` : `postgresql://postgres@127.0.0.1:${this.pgPort}/${this.dbName}`;
  },
};

export interface E2EState {
  liteUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  dbUrl: string;
  dbName: string;
  appUrl: string;
  /** E2E_SKIP_APP=1 で Next.js の起動を省略した */
  appSkipped: boolean;
  companyId: string;
  companyName: string;
  pids: { lite: number | null; app: number | null };
  started: { pg: boolean; lite: boolean; app: boolean };
  createdAt: string;
}

export const E2E_DIR = __dirname;
export const ROOT_DIR = path.resolve(__dirname, "../..");
export const STATE_FILE = path.join(E2E_DIR, ".state.json");
export const LOG_DIR = path.join(E2E_DIR, ".logs");

export function readState(): E2EState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as E2EState;
  } catch {
    return null;
  }
}

export function writeState(state: E2EState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function requireState(): E2EState {
  const s = readState();
  if (!s) throw new Error(`E2E の状態ファイルがありません: ${STATE_FILE}（global-setup が実行されていません）`);
  return s;
}

/** psql で SQL を実行し、標準出力（-A -t：区切りはタブ）を返す */
export function adminSql(sql: string, dbUrl: string = readState()?.dbUrl ?? E2E.dbUrl): string {
  return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-Atq", "-F", "\t", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: process.env.PGOPTIONS ?? "--client-min-messages=warning" },
  }).trim();
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

/** サービスロールのクライアント（RLS を無視。テストの準備専用） */
export function createServiceClient(state: E2EState = requireState()): SupabaseClient<Database> {
  return createClient<Database>(state.liteUrl, state.serviceRoleKey, clientOptions);
}

export function createAnonClient(state: E2EState = requireState()): SupabaseClient<Database> {
  return createClient<Database>(state.liteUrl, state.anonKey, clientOptions);
}

/** auth ユーザーが無ければ作成する（招待が必要。トリガーで profiles が作られる） */
export async function ensureAuthUser(email: string, displayName?: string): Promise<string> {
  const admin = createServiceClient();
  const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  if (existing) return existing.id;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: displayName ? { display_name: displayName } : {} });
  if (error) throw new Error(`ユーザー作成に失敗（招待がありますか？）: ${email}: ${error.message}`);
  return data.user.id;
}

/** 指定ユーザーとしてログイン済みの supabase-js クライアント（RLS 適用） */
export async function sessionFor(email: string): Promise<SupabaseClient<Database>> {
  await ensureAuthUser(email);
  const admin = createServiceClient();
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !link.properties?.hashed_token) throw new Error(`generateLink に失敗: ${error?.message}`);
  const client = createAnonClient();
  const { error: verifyErr } = await client.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (verifyErr) throw verifyErr;
  return client;
}

/** 初期データ（§8.6）を owner として投入する。既に投入済みなら何もしない（冪等） */
export async function seedInitialData(withEntries = true): Promise<void> {
  const owner = await sessionFor(E2E.users.owner.email);
  const { error } = await owner.rpc("seed_initial_data", { p_with_entries: withEntries });
  if (error && error.hint !== "NOT_EMPTY") throw new Error(`seed_initial_data に失敗: ${error.message}`);
}

/** 招待を作成してトークンを返す（psql 経由。driver ロールは driverId 必須） */
export function createInvitation(opts: { email: string; role: E2ERole | "driver"; displayName?: string; driverId?: string; token?: string; expiresInDays?: number }): string {
  const state = requireState();
  const token = opts.token ?? crypto.randomBytes(24).toString("hex");
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  adminSql(
    `insert into public.invitations (company_id, email, role, display_name, driver_id, token, expires_at)
     values (${q(state.companyId)}, ${q(opts.email.toLowerCase())}, ${q(opts.role)}, ${q(opts.displayName ?? "")}, ${opts.driverId ? q(opts.driverId) : "null"}, ${q(token)}, now() + interval '${opts.expiresInDays ?? 7} days')`,
  );
  return token;
}

/** supabase-lite のテスト用 API：最後に発行されたマジックリンク／OTP */
export async function lastOtp(email: string): Promise<{ email: string; token_hash: string; type: string; link: string; email_otp: string; code: string }> {
  const state = requireState();
  const r = await fetch(`${state.liteUrl}/__test/last-otp?email=${encodeURIComponent(email)}`);
  if (!r.ok) throw new Error(`OTP が発行されていません: ${email}`);
  return (await r.json()) as { email: string; token_hash: string; type: string; link: string; email_otp: string; code: string };
}

/** 招待リンク（/invite/<token>）からログインする。ログイン後の画面（/dashboard 等）まで待つ */
export async function loginViaInvite(page: Page, token: string): Promise<void> {
  await page.goto(`/invite/${token}`);
  await page.getByRole("button", { name: "ログインして始める" }).click();
  await page.waitForURL(/\/(dashboard|driver|settings)/, { timeout: 30_000 });
}

/**
 * マジックリンクでログインする。ログイン画面と同じく /auth/v1/otp でリンクを発行し、
 * メールの代わりに /__test/last-otp から token_hash を取得して /auth/confirm を開く
 */
export async function loginViaMagicLink(page: Page, email: string, next = "/dashboard"): Promise<void> {
  const state = requireState();
  await ensureAuthUser(email);
  const r = await fetch(`${state.liteUrl}/auth/v1/otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: state.anonKey, Authorization: `Bearer ${state.anonKey}` },
    body: JSON.stringify({ email, create_user: false }),
  });
  if (!r.ok) throw new Error(`OTP の発行に失敗: ${r.status} ${await r.text()}`);
  const otp = await lastOtp(email);
  await page.goto(`/auth/confirm?token_hash=${encodeURIComponent(otp.token_hash)}&type=${encodeURIComponent(otp.type)}&next=${encodeURIComponent(next)}`);
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/") && !u.pathname.startsWith("/login"), { timeout: 30_000 });
}

/** ユーザーメニューからログアウトする */
export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "ユーザーメニュー" }).click();
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
  await page.waitForURL(/\/login/, { timeout: 30_000 });
}
