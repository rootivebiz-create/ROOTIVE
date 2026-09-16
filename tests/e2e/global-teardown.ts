/**
 * Playwright global teardown：global-setup が起動した子プロセスだけを停止する
 * （既に起動していた PostgreSQL / supabase-lite / Next.js には触らない）
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { ROOT_DIR, STATE_FILE, readState } from "./helpers";

function log(msg: string) {
  console.log(`[e2e:teardown] ${msg}`);
}

function killGroup(pid: number | null, label: string) {
  if (!pid) return;
  try {
    // detached で起動しているのでプロセスグループごと止める（npx → next の子プロセスも含める）
    process.kill(-pid, "SIGTERM");
    log(`${label} を停止しました (pid ${pid})`);
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      log(`${label} を停止しました (pid ${pid})`);
    } catch {
      // 既に終了している
    }
  }
}

export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const state = readState();
  if (!state) return;
  if (state.started.app) killGroup(state.pids.app, "Next.js");
  if (state.started.lite) killGroup(state.pids.lite, "supabase-lite");
  if (state.started.pg && !process.env.KEEP_PG) {
    const pgBin = process.env.PG_BIN ?? (fs.readdirSync("/usr/lib/postgresql").sort().pop() ? `/usr/lib/postgresql/${fs.readdirSync("/usr/lib/postgresql").sort().pop()}/bin` : "");
    const data = path.join(ROOT_DIR, "tests/sql/.pg/data");
    const cmd = `${pgBin}/pg_ctl -D '${data}' stop -m fast`;
    try {
      if (process.getuid?.() === 0) execFileSync("su", ["postgres", "-c", cmd], { stdio: "ignore" });
      else execFileSync("bash", ["-c", cmd], { stdio: "ignore" });
      log("PostgreSQL を停止しました");
    } catch (e) {
      log(`PostgreSQL の停止に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, finishedAt: new Date().toISOString(), started: { pg: false, lite: false, app: false } }, null, 2));
}
