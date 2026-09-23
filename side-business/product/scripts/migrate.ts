/**
 * 本番の Postgres にマイグレーションを当てる：DATABASE_URL=postgres://… npm run db:migrate
 * --if-configured：DATABASE_URL が無ければ何もしない（Vercel のビルドの前に毎回呼ぶ。PGlite のデモは起動時に当てる）
 */
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    if (process.argv.includes("--if-configured")) {
      console.log("DATABASE_URL が無いので、マイグレーションは飛ばします（PGlite は起動時に当てます）");
      return;
    }
    throw new Error("DATABASE_URL（postgres://…）がありません");
  }
  const client = postgres(url, { max: 1 });
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
