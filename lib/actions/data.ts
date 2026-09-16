"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction, requireOwnerAction } from "@/lib/auth/session";
import { ActionError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { importJsonTextSchema, resetCompanyDataSchema, seedInitialDataSchema } from "@/lib/schemas/data";
import { buildPreview, type MigratePreview } from "@/lib/migrate";
import type { Json } from "@/lib/db/database.types";

/** RPC が返す件数（テーブル名 → 件数） */
export type DataCounts = Record<string, number>;

/** JSON テキストを検証して解析する（BOM 付きも可）。失敗は日本語エラー */
function parseJsonText(jsonText: string): unknown {
  const text = importJsonTextSchema.parse(jsonText);
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new ActionError("JSON として読み取れませんでした。ファイルの内容を確認してください。");
  }
}

function toCounts(json: Json): DataCounts {
  const out: DataCounts = {};
  if (json && typeof json === "object" && !Array.isArray(json)) {
    for (const [k, v] of Object.entries(json)) if (typeof v === "number") out[k] = v;
  }
  return out;
}

/** 取り込み・削除は全画面の集計に影響するため、レイアウトごと再検証する */
function revalidateAll() {
  revalidatePath("/", "layout");
}

/**
 * 取り込み前のプレビュー（owner）。試作アプリ JSON／本システムのバックアップ JSON を判定して件数と月別集計を返す。
 * バックアップ本体は返さない（サイズ対策）。
 */
export async function previewImportAction(jsonText: string): Promise<ActionResult<{ preview: MigratePreview }>> {
  return runAction(async () => {
    const { company } = await requireOwnerAction();
    const json = parseJsonText(jsonText);
    const { preview } = buildPreview(json, company.id);
    return { preview };
  });
}

/** 取り込み・復元（owner）。ID が一致するデータは上書き。RPC import_backup（他社 ID と衝突すれば拒否） */
export async function importBackupAction(jsonText: string): Promise<ActionResult<{ counts: DataCounts; preview: MigratePreview }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const json = parseJsonText(jsonText);
    const { backup, preview } = buildPreview(json, company.id);
    const counts = toCounts(unwrap(await supabase.rpc("import_backup", { p_data: backup as unknown as Json })));
    revalidateAll();
    return { counts, preview };
  }, "取り込みが完了しました。");
}

/** サンプル初期データの投入（admin+、ドライバーが 0 件のときのみ。§8.6） */
export async function seedInitialDataAction(withEntries: boolean): Promise<ActionResult<DataCounts>> {
  return runAction(async () => {
    const { supabase } = await requireAdminAction();
    const parsed = seedInitialDataSchema.parse({ withEntries });
    const counts = toCounts(unwrap(await supabase.rpc("seed_initial_data", { p_with_entries: parsed.withEntries })));
    revalidateAll();
    return counts;
  }, "サンプル初期データを投入しました。");
}

/** データ全削除（owner。会社名の一致で確認）。ユーザー・招待・会社設定は残る */
export async function resetCompanyDataAction(companyName: string): Promise<ActionResult<DataCounts>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const parsed = resetCompanyDataSchema.parse({ companyName });
    if (parsed.companyName !== company.name) throw new ActionError("会社名が一致しません。");
    const counts = toCounts(unwrap(await supabase.rpc("reset_company_data", { p_company_name: parsed.companyName })));
    revalidateAll();
    return counts;
  }, "会社のデータをすべて削除しました。");
}
