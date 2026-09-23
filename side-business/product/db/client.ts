import "server-only";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

/**
 * DB への入口。
 * - DATABASE_URL（postgres://…）があれば本番の Postgres（Supabase・Neon など）につなぐ
 * - 無ければ PGlite（同じ Postgres を手元で動かすもの）。開発・テスト・デモで使う
 *   PGLITE_DIR=memory なら終わると消える。既定は .data/pglite
 */
export type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

export const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

type Holder = { db?: Promise<Db> };
const holder = globalThis as unknown as { __shimebiDb?: Holder };
holder.__shimebiDb ??= {};

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL?.trim();
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(url, { max: 5, prepare: false });
    // postgres-js と PGlite は同じ問い合わせの書き方ができる（型だけそろえる）
    return drizzle(client, { schema }) as unknown as Db;
  }
  const dir = process.env.PGLITE_DIR?.trim() || path.join(process.cwd(), ".data", "pglite");
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

export function getDb(): Promise<Db> {
  holder.__shimebiDb!.db ??= connect();
  return holder.__shimebiDb!.db;
}

export { schema };
