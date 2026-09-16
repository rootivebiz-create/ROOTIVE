#!/usr/bin/env node
/**
 * supabase/migrations/*.sql を 1 ファイルに結合し、supabase/setup_all.sql を生成する
 * Supabase の SQL Editor に貼り付けて 1 回実行するだけでスキーマが完成する
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
let out = `-- =============================================================================
-- ROOTIVE 利益管理システム  全マイグレーション結合ファイル（自動生成：npm run build:sql）
-- Supabase の SQL Editor に貼り付けて実行してください（何度実行しても安全です）
-- 生成元: ${files.join(", ")}
-- =============================================================================

`;
for (const f of files) {
  out += `\n-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ${f} >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\n`;
  out += readFileSync(join(dir, f), "utf8");
  out += `\n-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<< ${f} <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<\n`;
}
out += `
-- =============================================================================
-- 次のステップ：supabase/seed/bootstrap_owner.sql を実行して会社とオーナー招待を作成してください
-- =============================================================================
`;
writeFileSync(join(process.cwd(), "supabase", "setup_all.sql"), out);
console.log(`supabase/setup_all.sql を生成しました（${files.length} ファイル、${out.length.toLocaleString()} 文字）`);
