/**
 * POST /api/line/webhook — LINE 公式アカウントからの Webhook
 * - 生のボディ文字列で x-line-signature を検証する（会社ごとにチャネルシークレットが違うため、
 *   保存済みの機密を順に試して一致したものを採用する。会社数は少ない前提）
 * - 6 桁の合言葉を受け取ったら RPC line_consume_code（サービスロール専用）で連携する
 * - 署名が合わなければ 401。それ以外は LINE の仕様に合わせて必ず早く 200 を返す
 */
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { loadAllSecrets, type SecretRecord } from "@/lib/integrations/secrets";
import { logIntegration } from "@/lib/integrations/logs";
import { replyLineMessage, verifyLineSignature } from "@/lib/integrations/line";
import { guideMessage, linkFailedMessage, linkedMessage, welcomeMessage } from "@/lib/integrations/messages";
import { LINE_LINK_CODE_RE } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Webhook の疎通確認で送られてくるダミーのトークン（返信すると 400 になるので返さない） */
const VERIFY_TOKEN_RE = /^0+$/;

interface LineEvent {
  type?: string;
  replyToken?: string;
  source?: { userId?: string; type?: string };
  message?: { type?: string; text?: string };
}

interface ConsumeResult {
  ok?: boolean;
  kind?: string;
  company_id?: string;
  name?: string;
  reason?: string;
}

/** 署名が一致した会社を探す */
async function matchCompany(body: string, signature: string | null): Promise<{ companyId: string; secrets: SecretRecord } | null> {
  const rows = await loadAllSecrets("line");
  for (const row of rows) {
    if (verifyLineSignature(body, signature, row.secrets.channelSecret)) return row;
  }
  return null;
}

async function companyName(companyId: string): Promise<string> {
  try {
    const { data } = await createAdminClient().from("companies").select("name").eq("id", companyId).maybeSingle();
    return data?.name ?? "";
  } catch {
    return "";
  }
}

/** 返信（失敗しても Webhook 自体は 200 で返す） */
async function reply(replyToken: string | undefined, text: string, token: string, companyId: string): Promise<void> {
  if (!replyToken || VERIFY_TOKEN_RE.test(replyToken)) return;
  try {
    await replyLineMessage(replyToken, text, token);
  } catch (e) {
    await logIntegration(companyId, "line", "reply", "error", e instanceof Error ? e.message : "返信できませんでした");
  }
}

/** 合言葉で連携する */
async function consumeCode(code: string, lineUserId: string): Promise<ConsumeResult> {
  const { data, error } = await createAdminClient().rpc("line_consume_code", { p_code: code, p_line_user_id: lineUserId });
  if (error) throw error;
  return (data ?? {}) as ConsumeResult;
}

async function handleEvent(event: LineEvent, ctx: { companyId: string; token: string; name: string }): Promise<void> {
  const { companyId, token, name } = ctx;
  const lineUserId = (event.source?.userId ?? "").trim();

  if (event.type === "follow") {
    await reply(event.replyToken, welcomeMessage(name), token, companyId);
    await logIntegration(companyId, "line", "webhook", "ok", "友だち追加がありました");
    return;
  }

  if (event.type !== "message" || event.message?.type !== "text") return;

  const text = (event.message?.text ?? "").trim();
  if (!LINE_LINK_CODE_RE.test(text)) {
    await reply(event.replyToken, guideMessage(), token, companyId);
    return;
  }
  if (!lineUserId) {
    await reply(event.replyToken, linkFailedMessage(), token, companyId);
    return;
  }

  const result = await consumeCode(text, lineUserId);
  if (!result.ok) {
    await reply(event.replyToken, linkFailedMessage(), token, companyId);
    await logIntegration(companyId, "line", "link", "error", "合言葉が見つかりませんでした（期限切れか使用済み）");
    return;
  }
  const linkedName = result.name ?? "";
  await reply(event.replyToken, linkedMessage({ companyName: name, name: linkedName }), token, companyId);
  if (result.company_id && result.company_id !== companyId) {
    await logIntegration(companyId, "line", "link", "error", `他の会社の合言葉で連携されました（${linkedName}）`, { kind: result.kind ?? "" });
    return;
  }
  await logIntegration(companyId, "line", "link", "ok", `${linkedName} さんと連携しました`, { kind: result.kind ?? "" });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-line-signature");

  if (!hasServiceRoleKey()) {
    return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY が未設定" }, { status: 503 });
  }

  let matched: { companyId: string; secrets: SecretRecord } | null = null;
  try {
    matched = await matchCompany(body, signature);
  } catch {
    return NextResponse.json({ ok: false, error: "設定を読み出せませんでした" }, { status: 500 });
  }
  if (!matched) return new NextResponse("invalid signature", { status: 401 });

  const companyId = matched.companyId;
  const token = matched.secrets.channelAccessToken ?? "";
  try {
    const payload = JSON.parse(body || "{}") as { events?: LineEvent[] };
    const events = Array.isArray(payload.events) ? payload.events : [];
    const name = events.length > 0 ? await companyName(companyId) : "";
    for (const event of events) {
      try {
        await handleEvent(event, { companyId, token, name });
      } catch (e) {
        await logIntegration(companyId, "line", "webhook", "error", e instanceof Error ? e.message : "イベントの処理に失敗しました", {
          type: event.type ?? "",
        });
      }
    }
  } catch (e) {
    // 例外は握りつぶして記録に残す（LINE には 200 を返す）
    await logIntegration(companyId, "line", "webhook", "error", e instanceof Error ? e.message : "Webhook の処理に失敗しました");
  }
  return NextResponse.json({ ok: true });
}
