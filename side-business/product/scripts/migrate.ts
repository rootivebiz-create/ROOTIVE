/**
 * 本番の Postgres にマイグレーションを当てる：DATABASE_URL=postgres://… npm run db:migrate
 * --if-configured：DATABASE_URL が無ければ何もしない（Vercel のビルドの前に毎回呼ぶ。PGlite のデモは起動時に当てる）。
 *   Vercel のプレビュー（VERCEL_ENV が production 以外）のビルドでも何もしない（本番の DB を確かめる前のブランチで変えない）
 */
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { migrationDecision } from "./migrate-guard";

async function main() {
  const decision = migrationDecision({
    ifConfigured: process.argv.includes("--if-configured"),
    databaseUrl: process.env.DATABASE_URL,
    vercelEnv: process.env.VERCEL_ENV,
  });
  if (!decision.run) {
    if (decision.fail) throw new Error(decision.reason);
    console.log(decision.reason);
    return;
  }
  const client = postgres(decision.url, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
  } finally {
    await client.end();
  }
  console.log("マイグレーションを当てました");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
