/** 本番の Postgres にマイグレーションを当てる：DATABASE_URL=postgres://… npm run db:migrate */
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL がありません");
  process.exit(1);
}
const client = postgres(url, { max: 1 });
await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
await client.end();
console.log("マイグレーションを当てました");
