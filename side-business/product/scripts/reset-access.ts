/**
 * オーナーが入れなくなったときの入り直し（導入を担当した者の作業。README の「入れなくなったとき」）。
 *
 *   DATABASE_URL='postgres://…（お客様の DB）' npx tsx scripts/reset-access.ts --list
 *   DATABASE_URL='postgres://…（お客様の DB）' npx tsx scripts/reset-access.ts --email shacho@example.jp --url https://お客様のURL
 *
 * - その人の招待リンクを作り直す（開いて新しいパスワードを決めると入れる。前のパスワードは使えなくなる）
 * - --make-owner：オーナーがやめてしまったとき、ほかの利用者をオーナーにする
 * - --sign-out：その人のいまのログインをすべて切る
 * - 表（マイグレーション）は変えない。操作の記録に残す
 * - 秘密の値（接続文字列）は引数に書かず、環境変数で渡す（履歴に残さない）
 */
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/client";
import * as schema from "../db/schema";
import {
  formatAccessList,
  formatResetResult,
  listAccessUsers,
  parseResetArgs,
  RESET_USAGE,
  ResetAccessError,
  resetAccess,
} from "../server/features/settings/reset-access";

async function open(): Promise<{ db: Db; close: () => Promise<void>; where: string }> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    if (!/^postgres(ql)?:\/\//.test(url)) throw new ResetAccessError("DATABASE_URL は postgres://… の形にしてください");
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(url, { max: 1, prepare: false });
    return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.end(), where: "DATABASE_URL の Postgres" };
  }
  // 手元（開発）：PGlite。同じ置き場所を 2 つから同時に開けないので、開発サーバーを止めてから
  const dir = process.env.PGLITE_DIR?.trim() || path.join(process.cwd(), ".data", "pglite");
  if (dir === "memory" || !fs.existsSync(dir)) {
    throw new ResetAccessError("DATABASE_URL（postgres://…）を環境変数で渡してください（手元の PGlite も見つかりません）");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(dir);
  return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.close(), where: `手元の PGlite（${dir}）` };
}

async function main() {
  const { args, problems } = parseResetArgs(process.argv.slice(2));
  if (args.help) {
    console.log(RESET_USAGE);
    return;
  }
  if (problems.length) throw new ResetAccessError(`${problems.join("\n")}\n\n${RESET_USAGE}`);
  const { db, close, where } = await open();
  try {
    console.log(`つなぎ先：${where}\n`);
    if (args.list) {
      console.log(formatAccessList(await listAccessUsers(db)));
      return;
    }
    const result = await resetAccess(db, {
      email: args.email!,
      tenantId: args.tenantId,
      hours: args.hours,
      makeOwner: args.makeOwner,
      signOut: args.signOut,
      dryRun: args.dryRun,
    });
    console.log(formatResetResult(result, args.url));
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
