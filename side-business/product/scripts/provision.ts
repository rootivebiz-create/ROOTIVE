/**
 * お客様 1 社ぶんの置き場所を 1 回で作る。
 *
 *   DATABASE_URL=postgres://…  VERCEL_TOKEN=…  npx tsx scripts/provision.ts \
 *     --client "〇〇運送" --repo 自分のアカウント/shimebi --root product [--team team_xxx] [--demo] [--dry-run] \
 *     [--region hnd1] [--support-email support@example.com] [--support-line https://lin.ee/…]
 *
 * すること：① お客様の Postgres にマイグレーションを当てる ② Vercel にプロジェクトを作る（GitHub のリポジトリとつなぐ）
 * ③ 環境変数（本番：DATABASE_URL・APP_SECRET・SETUP_TOKEN／デモは DEMO_MODE。プレビュー：揮発する PGlite のデモと別の APP_SECRET）
 *   を入れる ④ 本番をデプロイする
 * ⑤ 最初のオーナーの登録リンク（/setup?token=…）を出す。
 *
 * --upload：GitHub とつながず、Vercel CLI で手元のファイル（製品のひとつ上の side-business/ ごと）を送って本番にする。
 *   会社のリポジトリを Vercel につながないとき・デモを置くときに使う。--repo は要らない。
 *   マイグレーションは Vercel の本番のビルドの中で当たる（package.json の vercel-build）ので、ここからは DB につながない。
 *   もう一度動かすと、同じプロジェクトにデプロイし直す（入っている APP_SECRET などは変えず、足りない環境変数だけ足す）。
 *
 * 秘密の値（DATABASE_URL・VERCEL_TOKEN）はコマンドの引数に書かない（シェルの履歴に残るため、環境変数で渡す）。
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { cleanPostgresUrl } from "../db/url";
import { buildPlan, summaryLines, validateInput, withQuery, type ProvisionInput, type ProvisionPlan } from "./provision-plan";
import { deployByUpload, ensureProject, patchProject, productionUrl, putEnv, vercelApi } from "./vercel-api";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "";
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function migrateDatabase(url: string) {
  const client = postgres(cleanPostgresUrl(url), { max: 1, prepare: false });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
  } finally {
    await client.end();
  }
}

type Deployment = { id: string; url: string; readyState?: string };

/** 送る元（side-business/）に製品があり、送らないものの一覧（.vercelignore）があるか。無いと預かったファイルまで送ってしまう */
function uploadRootProblems(uploadRoot: string, rootDirectory: string): string[] {
  const problems: string[] = [];
  if (!fs.existsSync(path.join(uploadRoot, rootDirectory, "package.json"))) {
    problems.push(`送る元（${uploadRoot}）の中に ${rootDirectory}/package.json がありません。製品のフォルダ（product）で動かしてください`);
  }
  if (!fs.existsSync(path.join(uploadRoot, ".vercelignore"))) {
    problems.push(`送る元（${uploadRoot}）に .vercelignore がありません。お客様から預かったファイル（private/）などを送らないよう、先に置いてください`);
  }
  return problems;
}

async function run(input: ProvisionInput, plan: ProvisionPlan, token: string, uploadRoot: string) {
  if (input.upload) {
    console.log("① マイグレーションは、Vercel の本番のビルドの中で当てます（ここからは DB につながない）");
  } else {
    console.log("① お客様の Postgres にマイグレーションを当てます…");
    await migrateDatabase(input.databaseUrl);
    console.log("   済み");
  }

  console.log(`② Vercel にプロジェクト「${plan.projectName}」を作ります…`);
  const { project, created } = input.upload
    ? await ensureProject(token, plan.createProjectBody as Record<string, unknown> & { name: string }, plan.query)
    : { project: await vercelApi<{ id: string; name: string; accountId: string; link?: { repoId?: number | string } }>(token, "POST", withQuery("/v11/projects", plan.query), plan.createProjectBody), created: true };
  console.log(`   ${created ? "済み" : "前に作ったものを使います"}（${project.name}）`);
  if (input.region) {
    const failed = await patchProject(token, project.id, plan.query, { serverlessFunctionRegion: input.region });
    console.log(failed ? `   地域（${input.region}）は入れられませんでした。Vercel の画面の Settings → Functions で選んでください：${failed}` : `   地域：${input.region}`);
  }

  console.log("③ 環境変数を入れます…");
  const added = await putEnv(token, project.id, plan.query, plan.env, created);
  console.log(added.length ? `   済み（${added.map((e) => `${e.key}：${e.target.join("・")}`).join("／")}）` : "   前に入れたものをそのまま使います");

  console.log("④ 本番をデプロイします…");
  let url = `https://${plan.projectName}.vercel.app`;
  if (input.upload) {
    await deployByUpload({ token, orgId: project.accountId, projectId: project.id, cwd: uploadRoot });
    url = (await productionUrl(token, project.id, plan.query).catch(() => null)) ?? url;
    console.log("   済み");
  } else {
    const repoId = project.link?.repoId;
    if (repoId) {
      const dep = await vercelApi<Deployment>(token, "POST", withQuery("/v13/deployments", plan.query), {
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
  }
  console.log("");
  const setupTokenIsNew = added.some((e) => e.key === "SETUP_TOKEN");
  for (const line of summaryLines(plan, url, !!input.demo, setupTokenIsNew)) console.log(line);
}

async function main() {
  const input: ProvisionInput = {
    client: arg("client") ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    repo: arg("repo") ?? "",
    rootDirectory: arg("root") ?? "product",
    teamId: arg("team") || undefined,
    demo: flag("demo"),
    upload: flag("upload"),
    region: arg("region"),
    ref: arg("ref") || undefined,
    supportEmail: arg("support-email") || undefined,
    supportLineUrl: arg("support-line") || undefined,
  };
  if (input.demo && !input.client) input.client = "demo";
  const problems = validateInput(input);
  const uploadRoot = path.resolve(process.cwd(), arg("upload-root") || "..");
  if (input.upload) problems.push(...uploadRootProblems(uploadRoot, input.rootDirectory));
  const token = process.env.VERCEL_TOKEN ?? "";
  if (!token && !flag("dry-run")) problems.push("VERCEL_TOKEN（Vercel の Account Settings → Tokens で作る）を環境変数で渡してください");
  if (problems.length) {
    for (const p of problems) console.error(`・${p}`);
    process.exit(1);
  }
  const plan = buildPlan(input);
  if (flag("dry-run")) {
    console.log("（試し：通信はしません）");
    console.log(
      JSON.stringify(
        {
          project: plan.createProjectBody,
          region: input.region ?? null,
          upload: input.upload ? uploadRoot : false,
          env: plan.env.map((e) => ({ ...e, value: e.type === "plain" ? e.value : "••••" })),
        },
        null,
        2,
      ),
    );
    return;
  }
  await run(input, plan, token, uploadRoot);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
