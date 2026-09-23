/**
 * 全データの書き出し（/data の ZIP）を、別の置き場所の Postgres へ読み戻す（オーナーの作業。画面からは大きいファイルを送れないため）。
 *
 *   DATABASE_URL='postgres://…（移す先）' npx tsx scripts/restore-tenant.ts ./書き出し.zip [--dry-run]
 *
 * - 同じ会社（tenant の id）がすでにある DB には読み戻さない（二重にしない）
 * - --dry-run は中身の件数を数えるだけで、書き込まない
 * - 読み戻したあと、ログインはこれまでのメールアドレスとパスワードで（パスワードのハッシュは書き出しに入っていないので、
 *   オーナーが /settings/users から招待リンクを作り直して配る）
 */
import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../db/schema";
import type { Db } from "../db/client";

/**
 * 読み戻しの部品（server/features/export-all.ts）は、Next.js の中でだけ読める印（"server-only"）を読み込んでいる。
 * Next.js の外（tsx）から動かすので、その印だけを空のものに差し替えてから読み込む（中身の処理は画面の読み戻しと同じ）
 */
function loadExportAll(): typeof import("../server/features/export-all") {
  const mod = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const original = mod._resolveFilename;
  const empty = path.join(__dirname, "..", "node_modules", "server-only", "empty.js");
  mod._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
    return original.call(this, request === "server-only" ? empty : request, ...rest);
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../server/features/export-all");
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const dry = process.argv.includes("--dry-run");
  const url = process.env.DATABASE_URL?.trim();
  if (!file) throw new Error("読み戻す ZIP のファイルを指定してください（例：npx tsx scripts/restore-tenant.ts ./書き出し.zip）");
  if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error("DATABASE_URL（postgres://…）を環境変数で渡してください");
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(file)));
  const { importTenantData, previewTenantImport } = loadExportAll();
  const client = postgres(url, { max: 1, prepare: false });
  try {
    const db = drizzle(client, { schema }) as unknown as Db;
    await migrate(drizzle(client), { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
    const preview = await previewTenantImport(db, bytes);
    console.log(JSON.stringify(preview, null, 2));
    if (dry) {
      console.log("（試し：書き込みはしていません）");
      return;
    }
    const done = await importTenantData(db, bytes, { restoredBy: null });
    console.log("読み戻しました：", JSON.stringify(done));
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
