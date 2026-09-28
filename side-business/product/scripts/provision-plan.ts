/**
 * お客様 1 社ぶんの置き場所を作る手順（純関数の部分。テストできるように、実際の通信は provision.ts が行う）。
 * Vercel の REST API：プロジェクトの作成（POST /v11/projects）・環境変数（POST /v10/projects/{id}/env?upsert=true）・
 * 本番のデプロイ（POST /v13/deployments、gitSource は作ったプロジェクトの link.repoId を使う）。
 * --upload のときは GitHub とつながず、Vercel CLI で手元のファイルをそのまま送る（会社のリポジトリを Vercel につながないとき・デモ）。
 */
import { randomBytes } from "node:crypto";

export type ProvisionInput = {
  /** お客様の名前（画面には出さない。Vercel のプロジェクト名の元） */
  client: string;
  /** お客様の Postgres（Supabase・Neon など）の接続文字列 */
  databaseUrl: string;
  /** GitHub のリポジトリ（owner/name）。製品のコードがあるところ（--upload のときは要らない） */
  repo: string;
  /** GitHub とつながず、Vercel CLI で手元のファイルを直接送る */
  upload?: boolean;
  /** サーバーを置く地域（Vercel の地域 ID。例 hnd1＝東京・sin1＝シンガポール）。DB と同じ地域の近くにすると速い */
  region?: string;
  /** リポジトリの中の製品の場所（会社のリポジトリなら side-business/product、個人のリポジトリへ移したなら product） */
  rootDirectory: string;
  /** Vercel のチーム（個人のアカウントなら空） */
  teamId?: string;
  /** デモの置き場所として作る（来た人ごとに架空の会社。DATABASE_URL は必要） */
  demo?: boolean;
  /** 既定のブランチ */
  ref?: string;
  /** ヘルプの画面に出す問い合わせ先（メール）。無ければ「導入を担当した者に」と出る */
  supportEmail?: string;
  /** ヘルプの画面に出す問い合わせ先（LINE の友だち追加などの https:// のリンク） */
  supportLineUrl?: string;
};

export type EnvVar = { key: string; value: string; type: "encrypted" | "plain"; target: ("production" | "preview" | "development")[] };

export type ProvisionPlan = {
  projectName: string;
  env: EnvVar[];
  secrets: { appSecret: string; setupToken: string };
  createProjectBody: Record<string, unknown>;
  query: string;
};

/** Vercel のプロジェクト名：英小文字・数字・ハイフン、100 文字まで。日本語の名前なら英数字の目印を足す */
export function projectNameFor(client: string, demo = false): string {
  const ascii = client
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = ascii.length >= 3 ? ascii : `client-${hashShort(client)}`;
  return `shimebi-${demo ? "demo" : base}`.slice(0, 100).replace(/-+$/, "");
}

function hashShort(value: string): string {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h.toString(36).slice(0, 6);
}

export function validateInput(input: ProvisionInput): string[] {
  const problems: string[] = [];
  if (!input.client.trim()) problems.push("お客様の名前（--client）がありません");
  if (!/^postgres(ql)?:\/\/.+/.test(input.databaseUrl)) problems.push("DATABASE_URL は postgres:// で始まる接続文字列にしてください");
  if (!input.upload && !/^[\w.-]+\/[\w.-]+$/.test(input.repo)) problems.push("--repo は owner/name の形にしてください（例：my-account/shimebi）");
  if (!input.rootDirectory.trim() || input.rootDirectory.startsWith("/")) problems.push("--root は リポジトリの中の相対パスにしてください（例：product）");
  if (input.region !== undefined && !/^[a-z]{3}\d$/.test(input.region)) problems.push("--region は Vercel の地域 ID にしてください（例：hnd1＝東京・sin1＝シンガポール）");
  if (input.supportEmail && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(input.supportEmail.trim())) {
    problems.push("--support-email はメールアドレスの形にしてください（例：support@example.com）");
  }
  if (input.supportLineUrl && !/^https:\/\/\S+$/.test(input.supportLineUrl.trim())) {
    problems.push("--support-line は https:// で始まるリンクにしてください（LINE の友だち追加のリンクなど）");
  }
  return problems;
}

/**
 * 環境変数は「本番（production）」と「プレビュー（preview）」で分ける。
 * - 本番だけ：DATABASE_URL・APP_SECRET・SETUP_TOKEN（デモは DEMO_MODE）。お客様の DB と、ドライバーのリンクの署名の鍵
 * - プレビューだけ：PGLITE_DIR=memory・DEMO_MODE=1・別に作った APP_SECRET。
 *   Vercel は本番のブランチ以外への push ごとにプレビューを作る。そこに本番の値があると、確かめる前のコードが
 *   お客様の本番の DB を読み書きし（ビルドの前のマイグレーションも当たる）、本物の鍵で明細のリンクを作れてしまう。
 *   プレビューは、揮発する DB の架空の会社（デモ）として開けるだけにする
 */
export function buildPlan(input: ProvisionInput, random: (n: number) => string = (n) => randomBytes(n).toString("base64url")): ProvisionPlan {
  const projectName = projectNameFor(input.client, input.demo);
  const appSecret = random(48);
  const setupToken = random(24);
  const previewSecret = random(48);
  const production: EnvVar["target"] = ["production"];
  const preview: EnvVar["target"] = ["preview"];
  const prodPreview: EnvVar["target"] = ["production", "preview"];
  const env: EnvVar[] = [
    { key: "DATABASE_URL", value: input.databaseUrl, type: "encrypted", target: production },
    { key: "APP_SECRET", value: appSecret, type: "encrypted", target: production },
  ];
  if (input.demo) env.push({ key: "DEMO_MODE", value: "1", type: "plain", target: production });
  else env.push({ key: "SETUP_TOKEN", value: setupToken, type: "encrypted", target: production });
  // プレビュー：本番の DB・鍵を持たせない。揮発する PGlite のデモとして開ける
  env.push(
    { key: "APP_SECRET", value: previewSecret, type: "encrypted", target: preview },
    { key: "PGLITE_DIR", value: "memory", type: "plain", target: preview },
    { key: "DEMO_MODE", value: "1", type: "plain", target: preview },
  );
  // ヘルプの画面の問い合わせ先（画面に出す値なので plain。ビルドのときに読まれる NEXT_PUBLIC_）
  if (input.supportEmail?.trim()) env.push({ key: "NEXT_PUBLIC_SUPPORT_EMAIL", value: input.supportEmail.trim(), type: "plain", target: prodPreview });
  if (input.supportLineUrl?.trim()) env.push({ key: "NEXT_PUBLIC_SUPPORT_LINE_URL", value: input.supportLineUrl.trim(), type: "plain", target: prodPreview });
  return {
    projectName,
    env,
    secrets: { appSecret, setupToken },
    createProjectBody: {
      name: projectName,
      framework: "nextjs",
      rootDirectory: input.rootDirectory,
      ...(input.upload ? {} : { gitRepository: { type: "github", repo: input.repo } }),
    },
    query: teamQuery(input.teamId),
  };
}

export function teamQuery(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

/** パスに ?teamId=… と、ほかの問い合わせの項目をつなぐ */
export function withQuery(pathname: string, query: string, extra?: string): string {
  if (!extra) return `${pathname}${query}`;
  return `${pathname}${query}${query ? "&" : "?"}${extra}`;
}

/**
 * すでにあるプロジェクトに足りない環境変数だけを返す（作り直しのときに APP_SECRET を変えない。
 * 変えると発行済みのリンクが使えなくなる）。キーと対象（本番・プレビュー）の組で見る
 */
export function missingEnv(existing: { key: string; target?: string | string[] }[], planned: EnvVar[]): EnvVar[] {
  const has = new Set<string>();
  for (const e of existing) {
    const targets = Array.isArray(e.target) ? e.target : e.target ? [e.target] : [];
    for (const t of targets) has.add(`${e.key}@${t}`);
  }
  return planned
    .map((e) => ({ ...e, target: e.target.filter((t) => !has.has(`${e.key}@${t}`)) }))
    .filter((e) => e.target.length > 0);
}

/**
 * 本番の URL：プロジェクトのドメインのうち、*.vercel.app で転送でもブランチ用でもないもの（短いものを優先）。
 * プロジェクト名がほかの人に使われていると `名前-xxxx.vercel.app` になるので、名前から決めつけない
 */
export function pickProductionDomain(domains: { name: string; redirect?: string | null; gitBranch?: string | null }[]): string | null {
  const candidates = domains
    .filter((d) => !d.redirect && !d.gitBranch)
    .map((d) => d.name)
    .sort((a, b) => Number(b.endsWith(".vercel.app")) - Number(a.endsWith(".vercel.app")) || a.length - b.length);
  return candidates[0] ? `https://${candidates[0]}` : null;
}

/**
 * Vercel CLI でファイルを送って本番にする引数（npx で使う）。プロジェクトは環境変数 VERCEL_ORG_ID・VERCEL_PROJECT_ID で指す。
 * 送る元は製品のひとつ上（side-business/）。製品はサイトの計算の部品（../lib）を読むので、そこも送る必要がある。
 * 送らないものは side-business/.vercelignore に書く
 */
export const VERCEL_CLI = "vercel@60";
export function uploadDeployArgs(token: string): string[] {
  return ["--yes", VERCEL_CLI, "deploy", "--prod", "--yes", "--archive=tgz", "--token", token];
}

/** 売るためのサイト（side-business/ の直下）を置くときの手順 */
export type SitePlan = { projectName: string; createProjectBody: Record<string, unknown>; env: EnvVar[]; query: string };

export function sitePlanProblems(input: { demoUrl?: string; name?: string }): string[] {
  const problems: string[] = [];
  if (input.demoUrl !== undefined && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(input.demoUrl.trim())) {
    problems.push("--demo-url は https:// で始まる、製品のデモの URL にしてください（例：https://shimebi-demo.vercel.app）");
  }
  if (input.name !== undefined && !/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(input.name)) {
    problems.push("--name は英小文字・数字・ハイフンにしてください（例：shimebi-lab）");
  }
  return problems;
}

export function buildSitePlan(input: { demoUrl?: string; name?: string; teamId?: string }): SitePlan {
  const projectName = input.name ?? "shimebi-lab";
  const env: EnvVar[] = [];
  // 製品のデモの入口（<URL>/demo/start）。画面に出す値なので plain。ビルドのときに読まれる
  if (input.demoUrl?.trim()) {
    env.push({ key: "NEXT_PUBLIC_PRODUCT_DEMO_URL", value: input.demoUrl.trim().replace(/\/+$/, ""), type: "plain", target: ["production", "preview"] });
  }
  return {
    projectName,
    createProjectBody: { name: projectName, framework: "nextjs" },
    env,
    query: teamQuery(input.teamId),
  };
}

/** 最後に表示する案内（お客様に渡すもの・オーナーが控えるもの） */
export function summaryLines(plan: ProvisionPlan, url: string, demo: boolean, setupTokenIsNew = true): string[] {
  const lines = [`本番の URL：${url}`];
  if (demo) {
    lines.push(`デモの入口：${url}/demo/start（来た人ごとに架空の会社ができ、24 時間で消えます）`);
  } else if (!setupTokenIsNew) {
    lines.push("最初のオーナーの登録の合言葉は、前に入れたもの（Vercel の環境変数 SETUP_TOKEN）をそのまま使っています。登録のリンクは <本番の URL>/setup?token=<SETUP_TOKEN> です。");
  } else {
    lines.push(`最初のオーナーの登録：${url}/setup?token=${plan.secrets.setupToken}`);
    lines.push("↑ このリンクは、お客様の社長（最初のオーナー）にだけ渡してください。登録が済むと二度と使えません。");
  }
  lines.push("APP_SECRET と SETUP_TOKEN は Vercel の環境変数に入っています。この画面の控えは安全な場所に移し、チャットやメールに貼らないでください。");
  lines.push("本番のブランチ以外への push で作られるプレビューは、揮発する架空の会社（デモ）として開きます。お客様の DB と本番の鍵は本番のデプロイにだけ入っています。");
  if (!plan.env.some((e) => e.key === "NEXT_PUBLIC_SUPPORT_EMAIL" || e.key === "NEXT_PUBLIC_SUPPORT_LINE_URL")) {
    lines.push(
      "問い合わせ先（--support-email・--support-line）が入っていません。ヘルプの画面には「導入を担当した者にご連絡ください」と出ます。入れるときは Vercel の環境変数に足して、デプロイし直してください。",
    );
  }
  return lines;
}
