/**
 * 取り込み画面の純関数ヘルパー（React に依存しない。テストからも使う）
 */
import type { ImportProfileRow, ImportRun } from "@/lib/db/types";
import { dateToMonth } from "@/lib/month";
import { normalizeMapping, type SheetMapping } from "@/lib/intake/mapping";

/** 画面で扱う取り込み定義の 1 行 */
export interface ProfileRow {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
  mapping: SheetMapping;
  headerRow: number;
  memo: string;
  isActive: boolean;
  runCount: number;
  lastUsedAt: string;
}

export function toProfileRow(p: ImportProfileRow): ProfileRow {
  return {
    id: p.id ?? "",
    name: p.name ?? "",
    clientId: p.client_id ?? "",
    clientName: p.client_name ?? "",
    projectId: p.project_id ?? "",
    projectName: p.project_name ?? "",
    mapping: normalizeMapping(p.mapping),
    headerRow: Number(p.header_row ?? 0),
    memo: p.memo ?? "",
    isActive: p.is_active !== false,
    runCount: Number(p.run_count ?? 0),
    lastUsedAt: p.last_used_at ?? "",
  };
}

/** 画面で扱う取り込み履歴の 1 行 */
export interface RunRow {
  id: string;
  profileId: string;
  fileName: string;
  month: string;
  rowCount: number;
  appliedCount: number;
  skippedCount: number;
  unmatched: string[];
  createdAt: string;
}

export function toRunRow(r: ImportRun): RunRow {
  return {
    id: r.id,
    profileId: r.profile_id ?? "",
    fileName: r.file_name ?? "",
    month: r.month ? dateToMonth(r.month) : "",
    rowCount: Number(r.row_count ?? 0),
    appliedCount: Number(r.applied_count ?? 0),
    skippedCount: Number(r.skipped_count ?? 0),
    unmatched: Array.isArray(r.unmatched) ? (r.unmatched as unknown[]).map((v) => String(v)).slice(0, 50) : [],
    createdAt: r.created_at ?? "",
  };
}

/** レシート画像の表示 URL（/api/receipt/<path>） */
export function receiptImageUrl(path: string): string {
  return `/api/receipt/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** 読み取りの自信の表示 */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "読み取りの自信：高い";
  if (confidence >= 0.5) return "読み取りの自信：ふつう（金額と日付を確認してください）";
  return "読み取りの自信：低い（内容を必ず確認してください）";
}

/** プレビューの要約（件数） */
export function previewSummaryText(counts: { total: number; ok: number; ng: number }): string {
  if (counts.total === 0) return "取り込める行がありませんでした。";
  if (counts.ng === 0) return `${counts.total} 行すべて取り込めます。`;
  return `${counts.total} 行のうち ${counts.ok} 行を取り込みます（${counts.ng} 行は対応が付いていません）。`;
}

/** 取り込み結果の要約 */
export function runResultText(result: { applied: number; skipped: number }): string {
  const skipped = result.skipped > 0 ? `（${result.skipped} 行は取り込みませんでした）` : "";
  return `${result.applied} 件の日別の稼働を登録・承認しました${skipped}。月次の稼働に反映されています。`;
}

/** 日付の短縮表示（"2026-09-18" → "9/18"） */
export function shortDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

/**
 * 対応表（元請の表記 → uuid）を保存できる形に整える。
 * 空のキー・長すぎるキー・値の無い項目を落とす（列の対応を間違えたときに壊れた値を覚えないため）。
 */
export function sanitizeMatchMap(map: Record<string, string>, maxKeyLength = 200): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    const k = (key ?? "").trim();
    if (!k || k.length > maxKeyLength || !value) continue;
    out[k] = value;
  }
  return out;
}

/** ファイルサイズの表示 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
