/**
 * 出力系 Route Handler の共通処理（認証・ロール確認・月パラメータ・エラー応答）
 * `_lib` は Next.js のプライベートフォルダ（ルーティング対象外）
 */
import "server-only";
import type { NextRequest } from "next/server";
import { STAFF_ROLES, getSessionContext, type SessionContext } from "@/lib/auth/session";
import type { Role } from "@/lib/db/types";
import { translateError } from "@/lib/actions/result";
import { isMonthKey } from "@/lib/month";
import { uuidSchema } from "@/lib/schemas/common";
import { errorResponse } from "@/lib/exports/download";

/** HTTP ステータス付きの例外（handleExport が日本語のエラー応答へ変換する） */
export class ExportError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ExportError";
  }
}

type Handler = (req: NextRequest) => Promise<Response>;

/** 例外を日本語のエラー応答に変換するラッパー */
export function handleExport(fn: Handler): Handler {
  return async (req) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof ExportError) return errorResponse(e.status, e.message);
      console.error("[api/export]", e);
      return errorResponse(500, `出力に失敗しました: ${translateError(e)}`);
    }
  };
}

/** 代表が出力を止めた人に返す文（0029） */
export const EXPORT_STOPPED_MESSAGE = "あなたのアカウントでは出力（ダウンロード）が止められています。必要なときは代表に頼んでください。";

/**
 * ログイン＋ロール確認（不足時は 401 / 403）。
 * - スタッフは、代表がその人の出力を止めていれば（access_overrides.export = deny。0029）ここで断る（ドライバー本人の明細には効かない）
 * - management を付けた出力（経営の数字）は、経営の数字を見せない人を断る（ロールではなくその人の設定で決める）
 */
export async function requireExportRole(roles: Role[], opts: { management?: boolean } = {}): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw new ExportError(401, "ログインが必要です。");
  if (!roles.includes(ctx.profile.role)) throw new ExportError(403, "この出力を行う権限がありません。");
  if (ctx.profile.role !== "driver" && !ctx.access.export) throw new ExportError(403, EXPORT_STOPPED_MESSAGE);
  if (opts.management && !ctx.access.management) throw new ExportError(403, "この出力を行う権限がありません。");
  return ctx;
}

/** 経営の数字の出力（レポート・資金繰り・案件別・ドライバー別の採算・支払の一覧）。経営の数字を見せる人だけ */
export const requireManagementExport = () => requireExportRole(STAFF_ROLES, { management: true });

/** ?m=YYYY-MM（allowAll なら "all" も可）。不正は 400 */
export function monthParam(req: NextRequest, opts: { allowAll?: boolean } = {}): string {
  const raw = req.nextUrl.searchParams.get("m") ?? "";
  if (opts.allowAll && raw === "all") return "all";
  if (isMonthKey(raw)) return raw;
  throw new ExportError(400, opts.allowAll ? "稼動月は ?m=YYYY-MM または ?m=all で指定してください。" : "稼動月は ?m=YYYY-MM で指定してください。");
}

/** ?driver=<uuid>。不正は 400 */
export function driverParam(req: NextRequest): string {
  const raw = req.nextUrl.searchParams.get("driver") ?? "";
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) throw new ExportError(400, "ドライバーは ?driver=<ID> で指定してください。");
  return parsed.data;
}

/** PostgREST の最大行数（Supabase 既定 1000）を超えるデータをページングで全件取得する */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
