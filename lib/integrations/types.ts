/**
 * 外部連携（LINE 公式アカウント・Google ドライブ）で共用する型と純関数。
 * クライアント側からも読み込むため、サービスロールや fetch などサーバー専用の処理は入れない。
 */
import type { Json } from "@/lib/db/database.types";
import type { Integration, IntegrationKind } from "@/lib/db/types";

/** LINE の Webhook を受け取るパス（設定画面に表示する URL の末尾） */
export const LINE_WEBHOOK_PATH = "/api/line/webhook";

/** 連携の合言葉（6 桁の数字） */
export const LINE_LINK_CODE_RE = /^\d{6}$/;

/** LINE のテキストメッセージの上限（5000 文字。余裕をみて切り詰める） */
export const LINE_MAX_TEXT = 4900;

/** マルチキャストの 1 回あたりの宛先数 */
export const LINE_MULTICAST_CHUNK = 500;

/** 外部への fetch のタイムアウト（ミリ秒） */
export const INTEGRATION_TIMEOUT_MS = 10_000;

/** LINE の設定（機密でないもの。integrations.config） */
export interface LineConfig {
  /** 支払明細ができたときに知らせる */
  notifyStatement: boolean;
  /** 重要なアラートを知らせる */
  notifyAlerts: boolean;
  /** 接続テストで取得した Bot の表示名 */
  botName: string;
}

/** Google ドライブの設定（機密でないもの。integrations.config） */
export interface DriveConfig {
  /** 月締めのときに自動保存する */
  autoBackup: boolean;
  /** 接続テストで取得したフォルダ名 */
  folderName: string;
}

export const DEFAULT_LINE_CONFIG: LineConfig = { notifyStatement: true, notifyAlerts: false, botName: "" };
export const DEFAULT_DRIVE_CONFIG: DriveConfig = { autoBackup: true, folderName: "" };

/** integration_secrets に入れる鍵の名前（画面にはマスクした値だけを渡す） */
export const LINE_SECRET_KEYS = ["channelAccessToken", "channelSecret"] as const;
export const DRIVE_SECRET_KEYS = ["clientId", "clientSecret", "refreshToken", "folderId"] as const;

export type LineSecretKey = (typeof LINE_SECRET_KEYS)[number];
export type DriveSecretKey = (typeof DRIVE_SECRET_KEYS)[number];

/** 画面に出す入力欄のラベル */
export const LINE_SECRET_LABELS: Record<LineSecretKey, string> = {
  channelAccessToken: "チャネルアクセストークン（長期）",
  channelSecret: "チャネルシークレット",
};
export const DRIVE_SECRET_LABELS: Record<DriveSecretKey, string> = {
  clientId: "クライアント ID",
  clientSecret: "クライアントシークレット",
  refreshToken: "リフレッシュトークン",
  folderId: "フォルダ ID",
};

/** マスクした機密（画面へはこの形でしか渡さない） */
export type LineSecretsMask = Record<LineSecretKey, string>;
export type DriveSecretsMask = Record<DriveSecretKey, string>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function record(json: Json | null | undefined): Record<string, unknown> {
  return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
}

export function parseLineConfig(config: Json | null | undefined): LineConfig {
  const o = record(config);
  return {
    notifyStatement: bool(o.notifyStatement, DEFAULT_LINE_CONFIG.notifyStatement),
    notifyAlerts: bool(o.notifyAlerts, DEFAULT_LINE_CONFIG.notifyAlerts),
    botName: str(o.botName),
  };
}

export function parseDriveConfig(config: Json | null | undefined): DriveConfig {
  const o = record(config);
  return {
    autoBackup: bool(o.autoBackup, DEFAULT_DRIVE_CONFIG.autoBackup),
    folderName: str(o.folderName),
  };
}

/**
 * 機密の値をマスクする（"sk-0123456789abcd" → "sk-…abcd"）。
 * 短い値は手がかりを残さず全部隠す。未設定は空文字（画面では「未設定」と出す）。
 */
export function maskSecret(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  const head = 3;
  const tail = 4;
  if (v.length <= head + tail) return "…";
  return `${v.slice(0, head)}…${v.slice(-tail)}`;
}

/** 連携の状態（画面に渡す安全な形。機密は含めない） */
export interface IntegrationView {
  kind: IntegrationKind;
  isEnabled: boolean;
  status: string;
  lastOkAt: string | null;
  lastError: string;
}

export function toIntegrationView(kind: IntegrationKind, row: Integration | null | undefined): IntegrationView {
  return {
    kind,
    isEnabled: Boolean(row?.is_enabled),
    status: row?.status ?? "",
    lastOkAt: row?.last_ok_at ?? null,
    lastError: row?.last_error ?? "",
  };
}

export function findIntegration(rows: Integration[], kind: IntegrationKind): Integration | null {
  return rows.find((r) => r.kind === kind) ?? null;
}

/** LINE と連携している人（設定画面の一覧に使う。LINE のユーザー ID は渡さない） */
export interface LinkedPerson {
  /** ドライバーなら drivers.id、スタッフなら profiles.id */
  id: string;
  kind: "driver" | "staff";
  name: string;
  linkedAt: string | null;
  /** 解除ボタンを出すか（ドライバーは admin 以上、スタッフは本人のみ） */
  canUnlink: boolean;
}

/** 実行記録の action の日本語ラベル */
export const INTEGRATION_ACTION_LABELS: Record<string, string> = {
  save: "設定の保存",
  test: "接続テスト",
  push: "メッセージ送信",
  multicast: "一斉送信",
  reply: "自動応答",
  webhook: "Webhook 受信",
  link: "連携",
  unlink: "連携の解除",
  notify_statement: "支払明細の通知",
  backup: "バックアップの保存",
};

export function integrationActionLabel(action: string): string {
  return INTEGRATION_ACTION_LABELS[action] ?? action;
}
