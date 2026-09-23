/**
 * お客様 1 社ぶんの置き場所を作る手順（純関数の部分。テストできるように、実際の通信は provision.ts が行う）。
 * Vercel の REST API：プロジェクトの作成（POST /v11/projects）・環境変数（POST /v10/projects/{id}/env?upsert=true）・
 * 本番のデプロイ（POST /v13/deployments、gitSource は作ったプロジェクトの link.repoId を使う）。
 */
import { randomBytes } from "node:crypto";

export type ProvisionInput = {
  /** お客様の名前（画面には出さない。Vercel のプロジェクト名の元） */
  client: string;
  /** お客様の Postgres（Supabase・Neon など）の接続文字列 */
  databaseUrl: string;
  /** GitHub のリポジトリ（owner/name）。製品のコードがあるところ */
  repo: string;
  /** リポジトリの中の製品の場所（会社のリポジトリなら side-business/product、個人のリポジトリへ移したなら product） */
  rootDirectory: string;
  /** Vercel のチーム（個人のアカウントなら空） */
  teamId?: string;
  /** デモの置き場所として作る（来た人ごとに架空の会社。DATABASE_URL は必要） */
  demo?: boolean;
  /** 既定のブランチ */
  ref?: string;
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
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo)) problems.push("--repo は owner/name の形にしてください（例：my-account/shimebi）");
  if (!input.rootDirectory.trim() || input.rootDirectory.startsWith("/")) problems.push("--root は リポジトリの中の相対パスにしてください（例：product）");
  return problems;
}

export function buildPlan(input: ProvisionInput, random: (n: number) => string = (n) => randomBytes(n).toString("base64url")): ProvisionPlan {
  const projectName = projectNameFor(input.client, input.demo);
  const appSecret = random(48);
  const setupToken = random(24);
  const prodPreview: EnvVar["target"] = ["production", "preview"];
  const env: EnvVar[] = [
    { key: "DATABASE_URL", value: input.databaseUrl, type: "encrypted", target: prodPreview },
    { key: "APP_SECRET", value: appSecret, type: "encrypted", target: prodPreview },
  ];
  if (input.demo) env.push({ key: "DEMO_MODE", value: "1", type: "plain", target: prodPreview });
  else env.push({ key: "SETUP_TOKEN", value: setupToken, type: "encrypted", target: prodPreview });
  return {
    projectName,
    env,
    secrets: { appSecret, setupToken },
    createProjectBody: {
      name: projectName,
      framework: "nextjs",
      rootDirectory: input.rootDirectory,
      gitRepository: { type: "github", repo: input.repo },
    },
    query: input.teamId ? `?teamId=${encodeURIComponent(input.teamId)}` : "",
  };
}

/** 最後に表示する案内（お客様に渡すもの・オーナーが控えるもの） */
export function summaryLines(plan: ProvisionPlan, url: string, demo: boolean): string[] {
  const lines = [`本番の URL：${url}`];
  if (demo) {
    lines.push(`デモの入口：${url}/demo/start（来た人ごとに架空の会社ができ、24 時間で消えます）`);
  } else {
    lines.push(`最初のオーナーの登録：${url}/setup?token=${plan.secrets.setupToken}`);
    lines.push("↑ このリンクは、お客様の社長（最初のオーナー）にだけ渡してください。登録が済むと二度と使えません。");
  }
  lines.push("APP_SECRET と SETUP_TOKEN は Vercel の環境変数に入っています。この画面の控えは安全な場所に移し、チャットやメールに貼らないでください。");
  return lines;
}
