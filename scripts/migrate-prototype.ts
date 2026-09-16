#!/usr/bin/env tsx
/**
 * 試作アプリ JSON → 本システムのバックアップ JSON へ変換（CLI 版）
 *
 * 使い方:
 *   npx tsx scripts/migrate-prototype.ts <input.json> [--company-id <uuid>] [--out <backup.json>]
 *   npx tsx scripts/migrate-prototype.ts <input.json> --apply --db-url <postgres url> --as <owner email>
 *
 * --apply を付けると DB に直接接続し、指定したオーナー（メール）として import_backup() を実行します。
 * DB URL は Supabase の「Project Settings → Database → Connection string（URI）」から取得できます。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildPreview } from "../lib/migrate";
import { yen } from "../lib/format";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const input = process.argv[2];
  if (!input || input.startsWith("--")) {
    console.error("使い方: npx tsx scripts/migrate-prototype.ts <input.json> [--company-id <uuid>] [--out <backup.json>] [--apply --db-url <url> --as <owner email>]");
    process.exit(1);
  }
  const apply = process.argv.includes("--apply");
  const dbUrl = arg("--db-url") ?? process.env.DATABASE_URL;
  const asEmail = arg("--as");
  let companyId = arg("--company-id");

  // --apply のときは会社 ID をオーナーのプロフィールから取得
  let pgClient: import("pg").Client | null = null;
  let ownerId: string | null = null;
  if (apply) {
    if (!dbUrl || !asEmail) {
      console.error("--apply には --db-url と --as <owner email> が必要です");
      process.exit(1);
    }
    const { Client } = await import("pg");
    pgClient = new Client({ connectionString: dbUrl, ssl: dbUrl.includes("localhost") || dbUrl.includes("127.0.0.1") ? undefined : { rejectUnauthorized: false } });
    await pgClient.connect();
    const r = await pgClient.query("select id, company_id, role from public.profiles where lower(email) = lower($1) and is_active limit 1", [asEmail]);
    if (r.rowCount === 0) throw new Error(`プロフィールが見つかりません: ${asEmail}`);
    if (r.rows[0].role !== "owner") throw new Error(`オーナーではありません: ${asEmail}（role=${r.rows[0].role}）`);
    ownerId = r.rows[0].id;
    companyId = companyId ?? r.rows[0].company_id;
  }
  if (!companyId) companyId = "00000000-0000-0000-0000-000000000000";

  const json = JSON.parse(readFileSync(input, "utf8"));
  const { backup, preview } = buildPreview(json, companyId);

  console.log(`形式: ${preview.format === "prototype" ? "試作アプリ JSON" : "本システムのバックアップ"}`);
  console.log(`会社名: ${preview.companyName ?? "（なし）"}`);
  console.log("件数:", preview.counts);
  console.log("月別集計:");
  for (const m of preview.months) {
    console.log(`  ${m.month}  稼働 ${m.entryCount} 件 / ${m.driverCount} 名  売上 ${yen(m.bill)}  利益 ${yen(m.profit)}  支払 ${yen(m.payout)}  [${m.status === "closed" ? "締め済み" : "未締め"}]`);
  }
  console.log(`合計: 売上 ${yen(preview.totals.bill)} / 利益 ${yen(preview.totals.profit)} / 支払 ${yen(preview.totals.payout)}`);
  if (preview.warnings.length) {
    console.log("警告:");
    for (const w of preview.warnings) console.log(`  - ${w}`);
  }

  const out = arg("--out");
  if (out) {
    writeFileSync(out, JSON.stringify(backup, null, 2));
    console.log(`バックアップ JSON を書き出しました: ${out}`);
  }

  if (apply && pgClient && ownerId) {
    console.log(`DB へ取り込みます（オーナー: ${asEmail}）…`);
    await pgClient.query("begin");
    try {
      await pgClient.query("set local role authenticated");
      await pgClient.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ownerId, role: "authenticated", email: asEmail })]);
      await pgClient.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
      await pgClient.query("select set_config('request.jwt.claim.role', 'authenticated', true)");
      const r = await pgClient.query("select public.import_backup($1::jsonb) as counts", [JSON.stringify(backup)]);
      await pgClient.query("commit");
      console.log("取り込み完了:", r.rows[0].counts);
    } catch (e) {
      await pgClient.query("rollback");
      throw e;
    } finally {
      await pgClient.end();
    }
  } else if (pgClient) {
    await pgClient.end();
  }
}

main().catch((e) => {
  console.error("エラー:", e instanceof Error ? e.message : e);
  process.exit(1);
});
