/**
 * Playwright global setup
 *
 * 1. PostgreSQL（127.0.0.1:54329）が無ければ tests/sql/run.sh と同じ手順で起動
 * 2. DB rootive_e2e を作り直し、auth スタブ ＋ supabase/migrations を適用（supabase-lite/prepare-db.sh）
 * 3. supabase-lite（Supabase 互換サーバー）を起動（同じ DB の既存プロセスがあれば再利用）
 * 4. 会社「株式会社ROOTIVE」と owner / admin / viewer の招待を投入
 * 5. Next.js を build → start（E2E_SKIP_BUILD=1 で build 省略、E2E_DEV=1 で next dev、E2E_SKIP_APP=1 で起動しない）
 * 6. /login が 200 になるまで待ち、状態を tests/e2e/.state.json に保存
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { E2E, E2E_DIR, LOG_DIR, ROOT_DIR, adminSql, writeState, type E2EState } from "./helpers";

const LITE_DIR = path.join(E2E_DIR, "supabase-lite");

function log(msg: string) {
  console.log(`[e2e:setup] ${msg}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url: string, timeoutMs: number, label: string, ok: (r: Response) => boolean = (r) => r.ok): Promise<void> {
  const start = Date.now();
  let lastError = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (ok(r)) return;
      lastError = `HTTP ${r.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await sleep(500);
  }
  throw new Error(`${label} の起動待ちがタイムアウトしました（${url}: ${lastError}）`);
}

/** 同じ DB を向いた supabase-lite が既に起動していれば true */
async function liteAlreadyRunning(url: string, dbName: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`);
    if (!r.ok) return false;
    const j = (await r.json()) as { name?: string; db?: string };
    if (j.name !== "supabase-lite") return false;
    if (j.db !== dbName) throw new Error(`ポート ${url} の supabase-lite は別の DB（${j.db}）に接続しています。停止してから再実行してください`);
    return true;
  } catch (e) {
    if (e instanceof Error && /別の DB/.test(e.message)) throw e;
    return false;
  }
}

function openLog(name: string): number {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  return fs.openSync(path.join(LOG_DIR, name), "a");
}

function tailLog(name: string, lines = 60): string {
  try {
    const text = fs.readFileSync(path.join(LOG_DIR, name), "utf8");
    return text.split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const skipApp = process.env.E2E_SKIP_APP === "1";
  const skipBuild = process.env.E2E_SKIP_BUILD === "1";
  const useDev = process.env.E2E_DEV === "1";
  fs.mkdirSync(LOG_DIR, { recursive: true });

  // 1-2. PostgreSQL と DB
  log(`DB を準備します（${E2E.dbName}）`);
  const prep = execFileSync("bash", [path.join(LITE_DIR, "prepare-db.sh"), E2E.dbName], { cwd: ROOT_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const pgStarted = /PG_STARTED=1/.test(prep);
  const dbUrl = /DB_URL=(.+)/.exec(prep)?.[1]?.trim() ?? E2E.dbUrl;

  // 3. supabase-lite
  const liteUrl = E2E.liteUrl;
  let litePid: number | null = null;
  let liteStarted = false;
  if (await liteAlreadyRunning(liteUrl, E2E.dbName)) {
    log(`supabase-lite は既に起動しています（${liteUrl}）。再利用します`);
  } else {
    log(`supabase-lite を起動します（${liteUrl}）`);
    const fd = openLog("supabase-lite.log");
    const child = spawn(
      process.execPath,
      [path.join(LITE_DIR, "server.mjs"), "--port", String(E2E.litePort), "--db", dbUrl, "--storage", path.join(E2E_DIR, ".storage"), "--site-url", E2E.appUrl, ...(process.env.E2E_VERBOSE ? ["--verbose"] : [])],
      { cwd: ROOT_DIR, stdio: ["ignore", fd, fd], detached: true },
    );
    child.unref();
    litePid = child.pid ?? null;
    liteStarted = true;
    try {
      await waitForHttp(`${liteUrl}/health`, 20_000, "supabase-lite");
    } catch (e) {
      console.error(tailLog("supabase-lite.log"));
      throw e;
    }
  }
  const keys = (await (await fetch(`${liteUrl}/__test/keys`)).json()) as { anon: string; service_role: string };

  // 4. 会社と招待
  log("会社とオーナー／管理者／閲覧者／事務員の招待を投入します");
  const u = E2E.users;
  const companyId = adminSql(
    `with c as (
       insert into public.companies (name, rounding_mode, default_royalty_rate, default_mgmt_fee, payout_month_offset, payout_day)
       values ('${E2E.companyName}', 'none', 0.1, 15000, 1, 0) returning id
     ), i as (
       insert into public.invitations (company_id, email, role, display_name, token, expires_at)
       select c.id, v.email, v.role::public.user_role, v.display_name, v.token, now() + interval '30 days'
         from c, (values
           ('${u.owner.email}', 'owner', '${u.owner.displayName}', '${u.owner.token}'),
           ('${u.admin.email}', 'admin', '${u.admin.displayName}', '${u.admin.token}'),
           ('${u.viewer.email}', 'viewer', '${u.viewer.displayName}', '${u.viewer.token}'),
           ('${u.clerk.email}', 'clerk', '${u.clerk.displayName}', '${u.clerk.token}')
         ) as v(email, role, display_name, token)
       returning 1
     )
     select id from c`,
    dbUrl,
  );
  if (!/^[0-9a-f-]{36}$/.test(companyId)) throw new Error(`会社の作成に失敗しました: ${companyId}`);

  // 5. Next.js
  const appUrl = E2E.appUrl;
  let appPid: number | null = null;
  let appStarted = false;
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: liteUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anon,
    SUPABASE_SERVICE_ROLE_KEY: keys.service_role,
    NEXT_PUBLIC_APP_URL: appUrl,
    // 外部サービス（LINE・メール）はテストサーバーのモックへ向ける（/__test/outbox で届いたものを確かめる）
    LINE_API_BASE: `${liteUrl}/__mock/line`,
    RESEND_API_BASE: `${liteUrl}/__mock/resend`,
    RESEND_API_KEY: "re_e2e_dummy",
    MAIL_FROM: "ROOTIVE <billing@e2e.test>",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(E2E.appPort),
  };
  if (skipApp) {
    log("E2E_SKIP_APP=1 のため Next.js は起動しません（アプリを使うテストは skip されます）");
  } else {
    let alreadyUp = false;
    try {
      const r = await fetch(`${appUrl}/login`, { redirect: "manual" });
      alreadyUp = r.status === 200;
    } catch {
      alreadyUp = false;
    }
    if (alreadyUp) {
      log(`Next.js は既に ${appUrl} で応答しています。再利用します（環境変数が E2E 用であることを確認してください）`);
    } else {
      if (!useDev && !skipBuild) {
        log("next build を実行します（数分かかることがあります。ログ: tests/e2e/.logs/next-build.log）");
        const fd = openLog("next-build.log");
        const r = spawnSync("npx", ["next", "build"], { cwd: ROOT_DIR, env, stdio: ["ignore", fd, fd] });
        fs.closeSync(fd);
        if (r.status !== 0) {
          console.error(tailLog("next-build.log", 80));
          throw new Error("next build に失敗しました（tests/e2e/.logs/next-build.log を確認してください）");
        }
      }
      const fd = openLog(useDev ? "next-dev.log" : "next-start.log");
      const args = useDev ? ["next", "dev", "-p", String(E2E.appPort), "-H", "127.0.0.1"] : ["next", "start", "-p", String(E2E.appPort), "-H", "127.0.0.1"];
      log(`Next.js を起動します: npx ${args.join(" ")}`);
      const child = spawn("npx", args, { cwd: ROOT_DIR, env, stdio: ["ignore", fd, fd], detached: true });
      child.unref();
      appPid = child.pid ?? null;
      appStarted = true;
      try {
        await waitForHttp(`${appUrl}/login`, useDev ? 240_000 : 120_000, "Next.js", (r) => r.status === 200);
      } catch (e) {
        console.error(tailLog(useDev ? "next-dev.log" : "next-start.log", 80));
        throw e;
      }
    }
  }

  const state: E2EState = {
    liteUrl,
    anonKey: keys.anon,
    serviceRoleKey: keys.service_role,
    dbUrl,
    dbName: E2E.dbName,
    appUrl,
    appSkipped: skipApp,
    companyId,
    companyName: E2E.companyName,
    pids: { lite: litePid, app: appPid },
    started: { pg: pgStarted, lite: liteStarted, app: appStarted },
    createdAt: new Date().toISOString(),
  };
  writeState(state);
  log(`準備完了: supabase-lite=${liteUrl} app=${skipApp ? "（省略）" : appUrl} company=${companyId}`);
}
