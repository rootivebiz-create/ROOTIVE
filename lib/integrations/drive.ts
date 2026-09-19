/**
 * Google ドライブへの保存（サーバー専用）。
 * サービスアカウントではなく、本人の Google アカウントの OAuth（リフレッシュトークン方式）を使う。
 * 機密（クライアント ID・シークレット・リフレッシュトークン・フォルダ ID）は integration_secrets に保管する。
 */
import "server-only";
import { ActionError } from "@/lib/actions/result";
import { loadSecrets } from "./secrets";
import { buildDriveMultipart, driveMultipartContentType, DRIVE_BOUNDARY, withTimestamp } from "./multipart";
import { DRIVE_SECRET_LABELS, INTEGRATION_TIMEOUT_MS, type DriveSecretKey } from "./types";

export { withTimestamp } from "./multipart";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

export interface DriveSecrets {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string;
}

/** 取得したアクセストークンの短時間キャッシュ（サーバーのメモリのみ） */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function cacheKey(secrets: DriveSecrets): string {
  return `${secrets.clientId}:${secrets.refreshToken.slice(-16)}`;
}

/** 保存済みの Google ドライブの機密（未設定なら空文字） */
export async function loadDriveSecrets(companyId: string): Promise<DriveSecrets> {
  const s = await loadSecrets(companyId, "google_drive");
  return {
    clientId: s.clientId ?? "",
    clientSecret: s.clientSecret ?? "",
    refreshToken: s.refreshToken ?? "",
    folderId: s.folderId ?? "",
  };
}

/** 4 つそろっていなければ日本語のエラー */
export function assertDriveSecrets(secrets: DriveSecrets): void {
  const missing = (Object.keys(DRIVE_SECRET_LABELS) as DriveSecretKey[]).filter((k) => !secrets[k]);
  if (missing.length > 0) {
    throw new ActionError(`Google ドライブの${missing.map((k) => DRIVE_SECRET_LABELS[k]).join("・")}が未設定です。設定 → 外部連携 で登録してください。`);
  }
}

/** タイムアウト付きの fetch（失敗は日本語の ActionError） */
async function request(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(INTEGRATION_TIMEOUT_MS), cache: "no-store" });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new ActionError(`Google ドライブから応答がありませんでした（${what}・時間切れ）。`);
    throw new ActionError(`Google ドライブに接続できませんでした（${what}）。ネットワークの状態を確認してください。`);
  }
}

/** OAuth のエラーを日本語にする */
function tokenErrorMessage(status: number, body: string): string {
  let code = "";
  let description = "";
  try {
    const json = JSON.parse(body) as { error?: string; error_description?: string };
    code = json.error ?? "";
    description = json.error_description ?? "";
  } catch {
    description = body.slice(0, 200);
  }
  switch (code) {
    case "invalid_grant":
      return "リフレッシュトークンが失効しています。取り直してください。";
    case "invalid_client":
      return "クライアント ID またはクライアントシークレットが正しくありません。";
    case "invalid_request":
      return `Google が入力を受け付けませんでした（${description || "設定内容を確認してください"}）。`;
    case "unauthorized_client":
      return "この OAuth クライアントでは許可されていません。クライアントの種類（デスクトップ）を確認してください。";
    default:
      return `Google の認証に失敗しました（${status}${description ? `: ${description}` : ""}）。`;
  }
}

/** Drive API のエラーを日本語にする */
function driveErrorMessage(status: number, body: string): string {
  let message = "";
  try {
    const json = JSON.parse(body) as { error?: { message?: string } };
    message = json.error?.message ?? "";
  } catch {
    message = body.slice(0, 200);
  }
  switch (status) {
    case 401:
      return "Google の認証が切れています。リフレッシュトークンを取り直してください。";
    case 403:
      return `Google ドライブの権限がありません（${message || "Drive API が有効か確認してください"}）。`;
    case 404:
      return "フォルダが見つかりません。フォルダ ID を確認してください（Drive の URL の末尾）。";
    case 429:
      return "Google ドライブの利用制限に達しました。しばらく待ってから試してください。";
    default:
      if (status >= 500) return `Google ドライブ側でエラーが発生しました（${status}）。しばらく待ってから試してください。`;
      return `Google ドライブでエラーが発生しました（${status}${message ? `: ${message}` : ""}）。`;
  }
}

/** リフレッシュトークンからアクセストークンを取る（取得したトークンは期限まで短時間だけメモリに置く） */
export async function getAccessToken(secrets: DriveSecrets): Promise<string> {
  assertDriveSecrets(secrets);
  const key = cacheKey(secrets);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const form = new URLSearchParams({
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    refresh_token: secrets.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await request(
    TOKEN_URL,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() },
    "認証",
  );
  const raw = await res.text();
  if (!res.ok) {
    tokenCache.delete(key);
    throw new ActionError(tokenErrorMessage(res.status, raw));
  }
  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(raw) as { access_token?: string; expires_in?: number };
  } catch {
    throw new ActionError("Google の応答を読み取れませんでした。");
  }
  const token = json.access_token ?? "";
  if (!token) throw new ActionError("Google からアクセストークンを取得できませんでした。");
  const ttl = Math.max(60, Number(json.expires_in ?? 3600)) * 1000;
  tokenCache.set(key, { token, expiresAt: Date.now() + ttl });
  return token;
}

export interface DriveFile {
  id: string;
  name: string;
  webViewLink: string;
}

/**
 * JSON をアップロードする（multipart）。
 * 同名ファイルがあっても上書きせず、ファイル名に日時を足して別名で保存する。
 */
export async function uploadToDrive(companyId: string, fileName: string, json: unknown): Promise<DriveFile> {
  const secrets = await loadDriveSecrets(companyId);
  const token = await getAccessToken(secrets);
  const name = withTimestamp(fileName);
  const text = typeof json === "string" ? json : JSON.stringify(json);
  const body = buildDriveMultipart({ name, parents: [secrets.folderId], mimeType: "application/json" }, text, DRIVE_BOUNDARY);

  const res = await request(
    UPLOAD_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": driveMultipartContentType(DRIVE_BOUNDARY) },
      body,
    },
    "保存",
  );
  const raw = await res.text();
  if (!res.ok) throw new ActionError(driveErrorMessage(res.status, raw));
  let file: { id?: string; name?: string; webViewLink?: string } = {};
  try {
    file = JSON.parse(raw) as typeof file;
  } catch {
    // 応答が読めなくても保存自体は成功しているので、名前だけ返す
  }
  return { id: file.id ?? "", name: file.name ?? name, webViewLink: file.webViewLink ?? "" };
}

/** 接続テスト：保存先フォルダの名前を取る */
export async function testDrive(companyId: string): Promise<{ id: string; name: string }> {
  const secrets = await loadDriveSecrets(companyId);
  const token = await getAccessToken(secrets);
  const url = `${FILES_URL}/${encodeURIComponent(secrets.folderId)}?fields=id%2Cname%2CmimeType&supportsAllDrives=true`;
  const res = await request(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, "フォルダの確認");
  const raw = await res.text();
  if (!res.ok) throw new ActionError(driveErrorMessage(res.status, raw));
  let meta: { id?: string; name?: string; mimeType?: string } = {};
  try {
    meta = JSON.parse(raw) as typeof meta;
  } catch {
    throw new ActionError("Google ドライブの応答を読み取れませんでした。");
  }
  if (meta.mimeType && meta.mimeType !== "application/vnd.google-apps.folder") {
    throw new ActionError("フォルダ ID がフォルダを指していません。Drive でフォルダを開き、URL の末尾を入れてください。");
  }
  return { id: meta.id ?? secrets.folderId, name: meta.name ?? "" };
}
