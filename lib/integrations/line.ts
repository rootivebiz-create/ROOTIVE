/**
 * LINE 公式アカウント（Messaging API）との通信（サーバー専用）。
 * SDK は使わず fetch で直接叩く。機密（チャネルアクセストークン・チャネルシークレット）は
 * integration_secrets にサービスロールで保管し、この層の外へは出さない。
 */
import "server-only";
import { ActionError } from "@/lib/actions/result";
import { loadSecrets } from "./secrets";
import { INTEGRATION_TIMEOUT_MS, LINE_MAX_TEXT, LINE_MULTICAST_CHUNK } from "./types";

export { lineSignature, verifyLineSignature } from "./line-signature";

/** Messaging API の入口。E2E ではテストサーバーのモックへ向ける（本番では設定しない） */
const LINE_API = (process.env.LINE_API_BASE || "https://api.line.me").replace(/\/+$/, "");

export interface LineSecrets {
  channelAccessToken: string;
  channelSecret: string;
}

/** 保存済みの LINE の機密（未設定なら空文字） */
export async function loadLineSecrets(companyId: string): Promise<LineSecrets> {
  const s = await loadSecrets(companyId, "line");
  return { channelAccessToken: s.channelAccessToken ?? "", channelSecret: s.channelSecret ?? "" };
}

/** 送信に使うトークン（未設定なら日本語のエラー） */
async function requireAccessToken(companyId: string): Promise<string> {
  const { channelAccessToken } = await loadLineSecrets(companyId);
  if (!channelAccessToken) throw new ActionError("LINE のチャネルアクセストークンが未設定です。設定 → 外部連携 で登録してください。");
  return channelAccessToken;
}

/** LINE のテキストメッセージ（上限で切り詰める） */
function textMessage(text: string) {
  const body = (text ?? "").trim();
  return { type: "text" as const, text: body.length > LINE_MAX_TEXT ? `${body.slice(0, LINE_MAX_TEXT - 1)}…` : body };
}

/** LINE が返したエラー本文から日本語のメッセージを作る */
export function lineErrorMessage(status: number, body: string): string {
  const detail = (body ?? "").trim().slice(0, 200);
  switch (status) {
    case 400:
      return `LINE がリクエストを受け付けませんでした（${detail || "入力内容を確認してください"}）。`;
    case 401:
      return "チャネルアクセストークンが正しくありません。";
    case 403:
      return "この LINE 公式アカウントでは実行できません（プランや権限を確認してください）。";
    case 404:
      return "送信先が見つかりません（連携をやり直してください）。";
    case 429:
      return "LINE の送信制限に達しました。しばらく待ってから試してください。";
    default:
      if (status >= 500) return `LINE 側でエラーが発生しました（${status}）。しばらく待ってから試してください。`;
      return `LINE との通信でエラーが発生しました（${status}${detail ? `: ${detail}` : ""}）。`;
  }
}

/** Messaging API を呼ぶ（タイムアウト付き）。失敗は日本語の ActionError */
async function callLine<T>(path: string, token: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${LINE_API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(INTEGRATION_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new ActionError("LINE から応答がありませんでした（時間切れ）。しばらく待ってから試してください。");
    throw new ActionError("LINE に接続できませんでした。ネットワークの状態を確認してください。");
  }
  const raw = await res.text();
  if (!res.ok) {
    let message = raw;
    try {
      const json = JSON.parse(raw) as { message?: string };
      if (json?.message) message = json.message;
    } catch {
      // JSON でなければ本文をそのまま使う
    }
    throw new ActionError(lineErrorMessage(res.status, message));
  }
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

/** 1 人へ送る（push） */
export async function pushLineMessage(companyId: string, toUserId: string, text: string): Promise<void> {
  const token = await requireAccessToken(companyId);
  await callLine("/v2/bot/message/push", token, { method: "POST", body: { to: toUserId, messages: [textMessage(text)] } });
}

export interface LinePushItem {
  to: string;
  text: string;
  /** 記録用の名前（LINE へは送らない） */
  label?: string;
}

export interface LinePushResult {
  to: string;
  label: string;
  ok: boolean;
  error: string;
}

/** 宛先ごとに本文が違うときの送信（トークンの読み出しは 1 回だけ）。1 件失敗しても続ける */
export async function pushLineMessages(companyId: string, items: LinePushItem[]): Promise<LinePushResult[]> {
  if (items.length === 0) return [];
  const token = await requireAccessToken(companyId);
  const results: LinePushResult[] = [];
  for (const item of items) {
    try {
      await callLine("/v2/bot/message/push", token, { method: "POST", body: { to: item.to, messages: [textMessage(item.text)] } });
      results.push({ to: item.to, label: item.label ?? "", ok: true, error: "" });
    } catch (e) {
      results.push({ to: item.to, label: item.label ?? "", ok: false, error: e instanceof Error ? e.message : "送信に失敗しました。" });
    }
  }
  return results;
}

/** 同じ本文を複数人へ（multicast。500 件ずつに分ける） */
export async function multicastLineMessage(companyId: string, toUserIds: string[], text: string): Promise<{ sent: number }> {
  const targets = Array.from(new Set(toUserIds.filter((id) => id.trim().length > 0)));
  if (targets.length === 0) return { sent: 0 };
  const token = await requireAccessToken(companyId);
  const message = textMessage(text);
  let sent = 0;
  for (let i = 0; i < targets.length; i += LINE_MULTICAST_CHUNK) {
    const chunk = targets.slice(i, i + LINE_MULTICAST_CHUNK);
    await callLine("/v2/bot/message/multicast", token, { method: "POST", body: { to: chunk, messages: [message] } });
    sent += chunk.length;
  }
  return { sent };
}

export interface LineBotInfo {
  displayName: string;
  basicId: string;
  userId: string;
}

/** 接続テスト：Bot の情報を取る */
export async function getLineBotInfo(companyId: string): Promise<LineBotInfo> {
  const token = await requireAccessToken(companyId);
  const info = await callLine<{ displayName?: string; basicId?: string; userId?: string }>("/v2/bot/info", token, { method: "GET" });
  return { displayName: info.displayName ?? "", basicId: info.basicId ?? "", userId: info.userId ?? "" };
}

/** Webhook への返信（replyToken は 1 回だけ・約 1 分で無効。トークンは呼び出し側が渡す） */
export async function replyLineMessage(replyToken: string, text: string, channelAccessToken: string): Promise<void> {
  if (!replyToken || !channelAccessToken) return;
  await callLine("/v2/bot/message/reply", channelAccessToken, { method: "POST", body: { replyToken, messages: [textMessage(text)] } });
}
