/**
 * Vercel の REST API と CLI の小さな包み（provision.ts・publish-site.ts が使う）。
 * 通信するのはここだけ。何を作るか・どの値を入れるかは provision-plan.ts の純関数が決める。
 * トークンは画面に出さない（エラーの文にも入れない）。
 */
import { spawn } from "node:child_process";
import { missingEnv, pickProductionDomain, uploadDeployArgs, withQuery, type EnvVar } from "./provision-plan";

const API = "https://api.vercel.com";

export type VercelProject = { id: string; name: string; accountId: string; link?: { repoId?: number | string; type?: string } };

export class VercelApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function vercelApi<T>(token: string, method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // HTML などが返ったとき（通信が途中で止められたなど）。下で本文の先頭を出す
  }
  if (!res.ok) {
    const err = (json.error as { message?: string; code?: string } | undefined) ?? {};
    const hint =
      res.status === 403 && !err.code
        ? "（この作業環境のネットワークの設定で api.vercel.com が止められているかもしれません）"
        : res.status === 401 || res.status === 403
          ? "（トークンが違うか、期限が切れているか、このチームに使えないかもしれません）"
          : "";
    throw new VercelApiError(`Vercel API ${method} ${pathname} が失敗しました（${res.status} ${err.code ?? ""}）：${err.message ?? text.slice(0, 200)}${hint}`, res.status);
  }
  return json as T;
}

/** 名前でプロジェクトを探す。無ければ null */
export async function findProject(token: string, name: string, query: string): Promise<VercelProject | null> {
  try {
    return await vercelApi<VercelProject>(token, "GET", withQuery(`/v9/projects/${encodeURIComponent(name)}`, query));
  } catch (e) {
    if (e instanceof VercelApiError && e.status === 404) return null;
    throw e;
  }
}

/** プロジェクトを作る（あれば使う）。created はこの回で作ったか */
export async function ensureProject(token: string, body: Record<string, unknown> & { name: string }, query: string): Promise<{ project: VercelProject; created: boolean }> {
  const found = await findProject(token, body.name, query);
  if (found) return { project: found, created: false };
  const project = await vercelApi<VercelProject>(token, "POST", withQuery("/v11/projects", query), body);
  return { project, created: true };
}

/**
 * 環境変数を入れる。overwrite が false なら、足りないもの（キーと対象の組）だけを足す
 * （作り直しのときに APP_SECRET を変えない）。入れた（足した）ものを返す
 */
export async function putEnv(token: string, projectId: string, query: string, env: EnvVar[], overwrite: boolean): Promise<EnvVar[]> {
  let todo = env;
  if (!overwrite) {
    const existing = await vercelApi<{ envs?: { key: string; target?: string | string[] }[] }>(token, "GET", withQuery(`/v9/projects/${projectId}/env`, query));
    todo = missingEnv(existing.envs ?? [], env);
  }
  if (todo.length) await vercelApi(token, "POST", withQuery(`/v10/projects/${projectId}/env`, query, "upsert=true"), todo);
  return todo;
}

/** プロジェクトの設定を変える（地域など）。失敗しても止めない（画面から直せるもの） */
export async function patchProject(token: string, projectId: string, query: string, settings: Record<string, unknown>): Promise<string | null> {
  try {
    await vercelApi(token, "PATCH", withQuery(`/v9/projects/${projectId}`, query), settings);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** 本番の URL（https://…vercel.app）。分からなければ null */
export async function productionUrl(token: string, projectId: string, query: string): Promise<string | null> {
  const res = await vercelApi<{ domains?: { name: string; redirect?: string | null; gitBranch?: string | null }[] }>(
    token,
    "GET",
    withQuery(`/v9/projects/${projectId}/domains`, query),
  );
  return pickProductionDomain(res.domains ?? []);
}

/**
 * Vercel CLI で cwd のファイルを送り、本番にする（ビルドは Vercel の上で動く。本番のビルドなのでマイグレーションもそこで当たる）。
 * 送る元は cwd。何を送らないかは cwd の .vercelignore
 */
export function deployByUpload(opts: { token: string; orgId: string; projectId: string; cwd: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", uploadDeployArgs(opts.token), {
      cwd: opts.cwd,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, VERCEL_ORG_ID: opts.orgId, VERCEL_PROJECT_ID: opts.projectId, VERCEL_TELEMETRY_DISABLED: "1" },
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Vercel CLI でのデプロイが失敗しました（終了コード ${code}）。上のログを見てください`))));
  });
}
