import "server-only";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { clientIp, clientUserAgent, type HeaderSource } from "@/lib/auth/login-events";
import { isMonthKey, monthToDate } from "@/lib/month";
import { EXPORT_KIND_LABELS } from "@/lib/db/types";

/**
 * 持ち出し（出力）の記録（0020 の export_logs）。
 *
 * - RPC `record_export` は security definer の **サービスロール専用**なので admin クライアントから呼ぶ。
 * - 個人情報を含む種別（transfer / backup / statements / statement / drivers / month-pack / records）は
 *   DB 側で is_sensitive が立つ。アプリ側で判定を書かない。
 * - **記録に失敗しても出力は絶対に止めない**（握りつぶして console.warn だけ残す）。
 * - 古い記録は DB 側で 1 年経つと消える。
 */

/** 種別は lib/db/types.ts の EXPORT_KIND_LABELS のキー（当てはまらないものは "other"） */
export type ExportKind = keyof typeof EXPORT_KIND_LABELS;

export interface RecordExportInput {
  /** 出力した人（profiles.id） */
  profileId: string | null | undefined;
  kind: ExportKind;
  /** 画面に出す名前（例「稼働明細 CSV」）。空なら種別のラベルを使う */
  label?: string;
  /** 稼動月 "YYYY-MM"（"all" や未指定は null） */
  month?: string | null;
  /** 出力した行数（分からないときは 0） */
  rows?: number;
  req?: HeaderSource | null;
}

/** "YYYY-MM" は月初日へ。"all" ・不正・未指定は null */
export function exportMonthValue(month: string | null | undefined): string | null {
  if (!month || month === "all") return null;
  return isMonthKey(month) ? monthToDate(month) : null;
}

/**
 * 出力を 1 件記録する。失敗しても例外は投げない。
 * 出力が成功した直後（レスポンスを返す直前）に呼ぶこと。
 */
export async function recordExport(input: RecordExportInput): Promise<void> {
  const { profileId, kind, label, month, rows, req } = input;
  if (!profileId) return;
  if (!hasServiceRoleKey()) return; // サービスロールが無い環境（開発・テスト）では記録しない
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("record_export", {
      p_profile_id: profileId,
      p_kind: kind,
      p_label: label ?? EXPORT_KIND_LABELS[kind] ?? "",
      p_month: exportMonthValue(month) ?? undefined,
      p_rows: Math.max(0, Math.trunc(rows ?? 0)),
      p_ip: clientIp(req),
      p_user_agent: clientUserAgent(req),
    });
    if (error) console.warn("[export-log] 記録に失敗しました:", error.message);
  } catch (e) {
    console.warn("[export-log] 記録に失敗しました:", e instanceof Error ? e.message : e);
  }
}
