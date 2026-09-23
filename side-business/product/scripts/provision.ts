/**
 * お客様 1 社ぶんの置き場所を 1 回で作る。
 *
 *   DATABASE_URL=postgres://…  VERCEL_TOKEN=…  npx tsx scripts/provision.ts \
 *     --client "〇〇運送" --repo 自分のアカウント/shimebi --root product [--team team_xxx] [--demo] [--dry-run]
 *
 * すること：① お客様の Postgres にマイグレーションを当てる ② Vercel にプロジェクトを作る（GitHub のリポジトリとつなぐ）
 * ③ 環境変数（DATABASE_URL・APP_SECRET・SETUP_TOKEN／デモは DEMO_MODE）を入れる ④ 本番をデプロイする
 * ⑤ 最初のオーナーの登録リンク（/setup?token=…）を出す。
 * 秘密の値（DATABASE_URL・VERCEL_TOKEN）はコマンドの引数に書かない（シェルの履歴に残るため、環境変数で渡す）。
 */
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { buildPlan, summaryLines, validateInput, type ProvisionInput, type ProvisionPlan } from "./provision-plan";

const API = "https://api.vercel.com";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "";
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function vercel<T>(token: string, method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const err = (json.error as { message?: string; code?: string } | undefined) ?? {};
    throw new Error(`Vercel API ${method} ${pathname} が失敗しました（${res.status} ${err.code ?? ""}）：${err.message ?? text.slice(0, 200)}`);
  }
  return json as T;
}

async function migrateDatabase(url: string) {
  const client = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
  } finally {
    await client.end();
  }
}

type Project = { id: string; name: string; link?: { repoId?: number | string; type?: string } };
type Deployment = { id: string; url: string; readyState?: string };

async function run(input: ProvisionInput, plan: ProvisionPlan, token: string) {
  console.log("① お客様の Postgres にマイグレーションを当てます…");
  await migrateDatabase(input.databaseUrl);
  console.log("   済み");

  console.log(`② Vercel にプロジェクト「${plan.projectName}」を作ります…`);
  const project = await vercel<Project>(token, "POST", `/v11/projects${plan.query}`, plan.createProjectBody);
  console.log(`   済み（${project.id}）`);

  console.log("③ 環境変数を入れます…");
  const sep = plan.query ? "&" : "?";
  await vercel(token, "POST", `/v10/projects/${project.id}/env${plan.query}${sep}upsert=true`, plan.env);
  console.log(`   済み（${plan.env.map((e) => e.key).join("・")}）`);

  console.log("④ 本番をデプロイします…");
  const repoId = project.link?.repoId;
  const url = `https://${plan.projectName}.vercel.app`;
  if (repoId) {
    const dep = await vercel<Deployment>(token, "POST", `/v13/deployments${plan.query}`, {
      name: plan.projectName,
      project: project.id,
      target: "production",
      gitSource: { type: "github", repoId, ref: input.ref ?? "main" },
    });
    console.log(`   受け付けました（https://${dep.url}）。数分で本番に出ます`);
  } else {
    console.log("   リポジトリとのつながりが確かめられませんでした。Vercel の画面でこのプロジェクトを開き「Deploy」を押してください");
    console.log("   （Vercel に GitHub のアクセスを許していない場合は、Vercel の設定 → Git から許可してください）");
  }
  console.log("");
  for (const line of summaryLines(plan, url, !!input.demo)) console.log(line);
}

async function main() {
  const input: ProvisionInput = {
    client: arg("client") ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    repo: arg("repo") ?? "",
    rootDirectory: arg("root") ?? "product",
    teamId: arg("team") || undefined,
    demo: flag("demo"),
    ref: arg("ref") || undefined,
  };
  if (input.demo && !input.client) input.client = "demo";
  const problems = validateInput(input);
  const token = process.env.VERCEL_TOKEN ?? "";
  if (!token && !flag("dry-run")) problems.push("VERCEL_TOKEN（Vercel の Account Settings → Tokens で作る）を環境変数で渡してください");
  if (problems.length) {
    for (const p of problems) console.error(`・${p}`);
    process.exit(1);
  }
  const plan = buildPlan(input);
  if (flag("dry-run")) {
    console.log("（試し：通信はしません）");
    console.log(JSON.stringify({ project: plan.createProjectBody, env: plan.env.map((e) => ({ ...e, value: e.key === "DEMO_MODE" ? e.value : "••••" })) }, null, 2));
    return;
  }
  await run(input, plan, token);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
