/** 手元の PGlite（.data/pglite）にデモのデータを入れる：npm run seed:demo */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../db/schema";
import { seedDemo } from "../server/seed-demo";

const dir = process.env.PGLITE_DIR?.trim() || path.join(process.cwd(), ".data", "pglite");
const client = new PGlite(dir);
const db = drizzle(client, { schema });
await migrate(db, { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
const { tenantId } = await seedDemo(db as never);
console.log(`デモのデータを入れました（tenant ${tenantId}）`);
await client.close();
