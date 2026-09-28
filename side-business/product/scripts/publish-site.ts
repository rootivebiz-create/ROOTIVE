/**
 * 売るためのサイト（side-business/ の直下）を、Vercel CLI でファイルを直接送って公開する（GitHub とつながない）。
 *
 *   VERCEL_TOKEN=…  npx tsx scripts/publish-site.ts --demo-url https://shimebi-demo.vercel.app [--name shimebi-lab] [--team team_xxx] [--dry-run]
 *
 * --demo-url：製品のデモの URL（scripts/provision.ts --demo --upload で出たもの）。サイトの「製品のデモを触る」がここにつながる。
 * 問い合わせ先（NEXT_PUBLIC_CONTACT_EMAIL など）は入れない。入れるときは Vercel の画面の環境変数に足して、もう一度このスクリプトを動かす。
 * もう一度動かすと、同じプロジェクトにデプロイし直す（デモの URL は新しい値で上書きする）。
 */
import fs from "node:fs";
import path from "node:path";
import { buildSitePlan, sitePlanProblems } from "./provision-plan";
import { deployByUpload, ensureProject, productionUrl, putEnv } from "./vercel-api";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "";
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const input = { demoUrl: arg("demo-url"), name: arg("name"), teamId: arg("team") || undefined };
  const problems = sitePlanProblems(input);
  const siteRoot = path.resolve(process.cwd(), arg("site-root") || "..");
  if (!fs.existsSync(path.join(siteRoot, "site.config.ts"))) problems.push(`サイトのフォルダ（${siteRoot}）に site.config.ts がありません。製品のフォルダ（product）で動かしてください`);
  if (!fs.existsSync(path.join(siteRoot, ".vercelignore"))) problems.push(`サイトのフォルダ（${siteRoot}）に .vercelignore がありません。預かったファイル（private/）などを送らないよう、先に置いてください`);
  const token = process.env.VERCEL_TOKEN ?? "";
  if (!token && !flag("dry-run")) problems.push("VERCEL_TOKEN（Vercel の Account Settings → Tokens で作る）を環境変数で渡してください");
  if (problems.length) {
    for (const p of problems) console.error(`・${p}`);
    process.exit(1);
  }
  const plan = buildSitePlan(input);
  if (flag("dry-run")) {
    console.log("（試し：通信はしません）");
    console.log(JSON.stringify({ project: plan.createProjectBody, upload: siteRoot, env: plan.env }, null, 2));
    return;
  }

  console.log(`① Vercel にプロジェクト「${plan.projectName}」を作ります…`);
  const { project, created } = await ensureProject(token, plan.createProjectBody as Record<string, unknown> & { name: string }, plan.query);
  console.log(`   ${created ? "済み" : "前に作ったものを使います"}（${project.name}）`);

  console.log("② 環境変数を入れます…");
  const added = plan.env.length ? await putEnv(token, project.id, plan.query, plan.env, true) : [];
  console.log(added.length ? `   済み（${added.map((e) => `${e.key}＝${e.value}`).join("／")}）` : "   入れるものはありません（製品のデモへのボタンは出ません）");

  console.log("③ 本番をデプロイします…");
  await deployByUpload({ token, orgId: project.accountId, projectId: project.id, cwd: siteRoot });
  const url = (await productionUrl(token, project.id, plan.query).catch(() => null)) ?? `https://${plan.projectName}.vercel.app`;
  console.log("");
  console.log(`サイトの URL：${url}`);
  if (input.demoUrl) console.log(`「製品のデモを触る」の行き先：${input.demoUrl.trim().replace(/\/+$/, "")}/demo/start`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
