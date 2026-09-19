"use server";

import { revalidatePath } from "next/cache";
import { requireActionRole, requireAdminAction, requireOwnerAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, translateError, unwrap, type ActionResult } from "@/lib/actions/result";
import { loadIntegrations } from "@/lib/db/queries";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Json } from "@/lib/db/database.types";
import type { IntegrationKind, Role } from "@/lib/db/types";
import { appUrl } from "@/lib/env";
import { formatMonthJa, monthToDate } from "@/lib/month";
import { resolvePayoutDate } from "@/lib/statement";
import {
  driveSettingsSchema,
  lineLinkCodeSchema,
  lineSettingsSchema,
  notifyStatementsSchema,
  unlinkLineSchema,
  type DriveSettingsFormInput,
  type LineSettingsFormInput,
} from "@/lib/schemas/integrations";
import { findIntegration, parseDriveConfig, parseLineConfig, type DriveConfig, type LineConfig } from "@/lib/integrations/types";
import { clearSecrets, loadSecrets, mergeSecrets, saveSecrets } from "@/lib/integrations/secrets";
import { logIntegration } from "@/lib/integrations/logs";
import { getLineBotInfo, pushLineMessage, pushLineMessages } from "@/lib/integrations/line";
import { testDrive, uploadToDrive } from "@/lib/integrations/drive";
import { statementReadyMessage, testMessage } from "@/lib/integrations/messages";

/** ログインしていれば誰でも（ドライバーを含む） */
const ANY_ROLES: Role[] = ["owner", "admin", "viewer", "driver"];

function revalidateIntegrations() {
  revalidatePath("/settings/integrations");
  revalidatePath("/driver/account");
}

/** integrations（機密でない設定）の更新。書き込みは RLS で owner のみ */
async function upsertIntegration(
  supabase: ServerSupabase,
  companyId: string,
  kind: IntegrationKind,
  patch: { is_enabled?: boolean; config?: Json; status?: string; last_ok_at?: string | null; last_error?: string },
): Promise<void> {
  ensureNoError(
    await supabase
      .from("integrations")
      .upsert({ company_id: companyId, kind, ...patch, updated_at: new Date().toISOString() }, { onConflict: "company_id,kind" }),
  );
}

async function currentLineConfig(supabase: ServerSupabase, companyId: string): Promise<LineConfig> {
  return parseLineConfig(findIntegration(await loadIntegrations(supabase, companyId), "line")?.config);
}

async function currentDriveConfig(supabase: ServerSupabase, companyId: string): Promise<DriveConfig> {
  return parseDriveConfig(findIntegration(await loadIntegrations(supabase, companyId), "google_drive")?.config);
}

/** 失敗を integrations.last_error と実行記録に残してから、そのまま投げ直す */
async function recordFailure(
  supabase: ServerSupabase,
  companyId: string,
  kind: IntegrationKind,
  action: string,
  e: unknown,
  opts: { updateIntegration?: boolean } = {},
): Promise<never> {
  const message = translateError(e);
  if (opts.updateIntegration !== false) {
    try {
      await upsertIntegration(supabase, companyId, kind, { status: "エラー", last_error: message });
    } catch {
      // 状態を書けなくても元のエラーを優先する
    }
  }
  await logIntegration(companyId, kind, action, "error", message);
  revalidateIntegrations();
  throw new ActionError(message);
}

// =============================================================================
// LINE 公式アカウント
// =============================================================================

/**
 * LINE の設定を保存する（owner）。
 * トークン類は integration_secrets（サービスロール）へ、通知のオン・オフは integrations.config へ。
 * 入力が空文字なら保存済みの値をそのまま残す（マスク表示から変更しないケース）。
 */
export async function saveLineSettingsAction(input: LineSettingsFormInput): Promise<ActionResult<{ enabled: boolean }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const parsed = lineSettingsSchema.parse(input);

    const stored = await loadSecrets(company.id, "line");
    const merged = mergeSecrets(stored, { channelAccessToken: parsed.channelAccessToken, channelSecret: parsed.channelSecret });
    const hasToken = Boolean(merged.channelAccessToken);
    const hasSecret = Boolean(merged.channelSecret);
    if (hasToken !== hasSecret) {
      throw new ActionError(`${hasToken ? "チャネルシークレット" : "チャネルアクセストークン"}を入力してください。`);
    }
    if (hasToken) {
      await saveSecrets(company.id, "line", merged);
    } else {
      await clearSecrets(company.id, "line");
    }

    const config = await currentLineConfig(supabase, company.id);
    await upsertIntegration(supabase, company.id, "line", {
      is_enabled: hasToken,
      config: { ...config, notifyStatement: parsed.notifyStatement, notifyAlerts: parsed.notifyAlerts, botName: hasToken ? config.botName : "" } as unknown as Json,
      status: hasToken ? "設定済み" : "未設定",
      last_error: "",
    });
    await logIntegration(company.id, "line", "save", "ok", hasToken ? "LINE の設定を保存しました" : "LINE の設定を解除しました");
    revalidateIntegrations();
    return { enabled: hasToken };
  }, "LINE の設定を保存しました。");
}

/** 接続テスト（owner）：Bot の情報を取得して状態を更新する */
export async function testLineAction(): Promise<ActionResult<{ displayName: string; basicId: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    try {
      const info = await getLineBotInfo(company.id);
      const config = await currentLineConfig(supabase, company.id);
      await upsertIntegration(supabase, company.id, "line", {
        is_enabled: true,
        config: { ...config, botName: info.displayName } as unknown as Json,
        status: info.displayName ? `接続済み: ${info.displayName}` : "接続済み",
        last_ok_at: new Date().toISOString(),
        last_error: "",
      });
      await logIntegration(company.id, "line", "test", "ok", `接続テストに成功しました（${info.displayName || info.basicId}）`);
      revalidateIntegrations();
      return { displayName: info.displayName, basicId: info.basicId };
    } catch (e) {
      return recordFailure(supabase, company.id, "line", "test", e);
    }
  }, "LINE に接続できました。");
}

/** 自分（スタッフ本人）へテスト送信（owner）。未連携ならその旨を返す */
export async function sendLineTestAction(): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company, profile } = await requireOwnerAction();
    const to = (profile.line_user_id ?? "").trim();
    if (!to) {
      throw new ActionError("あなたの LINE がまだ連携されていません。合言葉を出して、LINE 公式アカウントに送ってください。");
    }
    try {
      await pushLineMessage(company.id, to, testMessage(company.name));
      await logIntegration(company.id, "line", "push", "ok", "テスト送信しました");
      revalidateIntegrations();
      return null;
    } catch (e) {
      return recordFailure(supabase, company.id, "line", "push", e);
    }
  }, "テスト送信しました。LINE を確認してください。");
}

/** 連携用の合言葉（6 桁）を発行する（ログイン中の本人。ドライバーも可） */
export async function issueLineCodeAction(): Promise<ActionResult<{ code: string; expiresInMinutes: number }>> {
  return runAction(async () => {
    const { supabase } = await requireActionRole(ANY_ROLES);
    const code = lineLinkCodeSchema.parse(unwrap(await supabase.rpc("line_issue_code"), "合言葉を発行できませんでした。"));
    return { code, expiresInMinutes: 30 };
  });
}

/** LINE の連携を解除する（ドライバー本人・スタッフ本人、またはドライバーに対しては admin 以上） */
export async function unlinkLineAction(driverId?: string | null): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase } = await requireActionRole(ANY_ROLES);
    const parsed = unlinkLineSchema.parse({ driverId: driverId ?? null });
    ensureNoError(await supabase.rpc("line_unlink", parsed.driverId ? { p_driver_id: parsed.driverId } : {}));
    revalidateIntegrations();
    return null;
  }, "LINE の連携を解除しました。");
}

export interface NotifyStatementsResult {
  /** 送信できた件数 */
  sent: number;
  /** 送信に失敗した件数 */
  failed: number;
  /** LINE 未連携などで送らなかった件数 */
  skipped: number;
}

/**
 * 締め済みの月の支払明細ができたことを LINE で知らせる（admin 以上）。
 * 対象は「その月が締め済み」かつ「LINE と連携済み」のドライバー。結果は integration_logs に残す。
 * 月締めの直後に呼ぶこともできる（未設定・通知オフならエラーを返すので、呼び出し側で握りつぶしてよい）。
 */
export async function notifyStatementsAction(month: string): Promise<ActionResult<NotifyStatementsResult>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const { month: m } = notifyStatementsSchema.parse({ month });

    const integration = findIntegration(await loadIntegrations(supabase, company.id), "line");
    if (!integration?.is_enabled) throw new ActionError("LINE 連携が未設定です。設定 → 外部連携 で登録してください。");
    const config = parseLineConfig(integration.config);
    if (!config.notifyStatement) throw new ActionError("支払明細の通知がオフになっています。設定 → 外部連携 で有効にしてください。");

    const summaries = unwrap(
      await supabase
        .from("v_driver_month_summary")
        .select("driver_id, driver_name, payout_incl, is_closed")
        .eq("company_id", company.id)
        .eq("month", monthToDate(m)),
      "この月の集計が見つかりません。",
    );
    const closed = summaries.filter((s) => s.is_closed === true);
    if (closed.length === 0) throw new ActionError(`${formatMonthJa(m)} はまだ締めていないため通知できません。`);

    const drivers = unwrap(await supabase.from("drivers").select("*").eq("company_id", company.id), "ドライバーを読み込めませんでした。");
    const byId = new Map(drivers.map((d) => [d.id, d]));
    const url = `${appUrl()}/driver/statements/${m}`;

    const items: { to: string; text: string; label: string }[] = [];
    let skipped = 0;
    for (const row of closed) {
      const driver = row.driver_id ? byId.get(row.driver_id) : undefined;
      const to = (driver?.line_user_id ?? "").trim();
      if (!driver || !to) {
        skipped += 1;
        continue;
      }
      const { date } = resolvePayoutDate(m, company, { payout_month_offset: driver.payout_month_offset, payout_day: driver.payout_day });
      items.push({
        to,
        label: driver.name,
        text: statementReadyMessage({
          companyName: company.name,
          driverName: driver.name,
          monthLabel: formatMonthJa(m),
          payoutIncl: Number(row.payout_incl ?? 0),
          payoutDate: date,
          url,
        }),
      });
    }
    if (items.length === 0) throw new ActionError("LINE と連携しているドライバーがいません。ドライバーに合言葉での連携をお願いしてください。");

    const results = await pushLineMessages(company.id, items);
    const sent = results.filter((r) => r.ok).length;
    const failed = results.length - sent;
    await logIntegration(
      company.id,
      "line",
      "notify_statement",
      failed > 0 ? "error" : "ok",
      `${formatMonthJa(m)} の支払明細を ${sent} 件送信しました（失敗 ${failed} 件・未連携 ${skipped} 件）`,
      { month: m, sent, failed, skipped, errors: results.filter((r) => !r.ok).map((r) => ({ name: r.label, error: r.error })) },
    );
    revalidateIntegrations();
    return { sent, failed, skipped };
  });
}

// =============================================================================
// Google ドライブ
// =============================================================================

/** Google ドライブの設定を保存する（owner）。空文字の欄は保存済みの値を残す */
export async function saveDriveSettingsAction(input: DriveSettingsFormInput): Promise<ActionResult<{ enabled: boolean }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    const parsed = driveSettingsSchema.parse(input);

    const stored = await loadSecrets(company.id, "google_drive");
    const merged = mergeSecrets(stored, {
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      refreshToken: parsed.refreshToken,
      folderId: parsed.folderId,
    });
    const labels: Record<string, string> = {
      clientId: "クライアント ID",
      clientSecret: "クライアントシークレット",
      refreshToken: "リフレッシュトークン",
      folderId: "フォルダ ID",
    };
    const keys = Object.keys(labels);
    const filled = keys.filter((k) => Boolean(merged[k]));
    if (filled.length > 0 && filled.length < keys.length) {
      const missing = keys.filter((k) => !merged[k]).map((k) => labels[k]);
      throw new ActionError(`${missing.join("・")}を入力してください。`);
    }
    const enabled = filled.length === keys.length;
    if (enabled) {
      await saveSecrets(company.id, "google_drive", merged);
    } else {
      await clearSecrets(company.id, "google_drive");
    }

    const config = await currentDriveConfig(supabase, company.id);
    await upsertIntegration(supabase, company.id, "google_drive", {
      is_enabled: enabled,
      config: { ...config, autoBackup: parsed.autoBackup, folderName: enabled ? config.folderName : "" } as unknown as Json,
      status: enabled ? "設定済み" : "未設定",
      last_error: "",
    });
    await logIntegration(company.id, "google_drive", "save", "ok", enabled ? "Google ドライブの設定を保存しました" : "Google ドライブの設定を解除しました");
    revalidateIntegrations();
    return { enabled };
  }, "Google ドライブの設定を保存しました。");
}

/** 接続テスト（owner）：保存先フォルダの名前を取得する */
export async function testDriveAction(): Promise<ActionResult<{ folderName: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    try {
      const folder = await testDrive(company.id);
      const config = await currentDriveConfig(supabase, company.id);
      await upsertIntegration(supabase, company.id, "google_drive", {
        is_enabled: true,
        config: { ...config, folderName: folder.name } as unknown as Json,
        status: folder.name ? `接続済み: ${folder.name}` : "接続済み",
        last_ok_at: new Date().toISOString(),
        last_error: "",
      });
      await logIntegration(company.id, "google_drive", "test", "ok", `接続テストに成功しました（${folder.name || folder.id}）`);
      revalidateIntegrations();
      return { folderName: folder.name };
    } catch (e) {
      return recordFailure(supabase, company.id, "google_drive", "test", e);
    }
  }, "Google ドライブに接続できました。");
}

/** バックアップ JSON を作って Google ドライブへ保存する（owner。手動実行） */
export async function backupToDriveAction(): Promise<ActionResult<{ fileName: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireOwnerAction();
    try {
      const backup = unwrap(await supabase.rpc("export_backup"), "バックアップを作成できませんでした。");
      const file = await uploadToDrive(company.id, "rootive-backup.json", backup);
      await upsertIntegration(supabase, company.id, "google_drive", { last_ok_at: new Date().toISOString(), last_error: "" });
      await logIntegration(company.id, "google_drive", "backup", "ok", `バックアップを保存しました（${file.name}）`, { fileName: file.name, fileId: file.id });
      revalidateIntegrations();
      return { fileName: file.name };
    } catch (e) {
      return recordFailure(supabase, company.id, "google_drive", "backup", e);
    }
  }, "Google ドライブにバックアップを保存しました。");
}

/**
 * 月締めのときの自動保存（admin 以上）。
 * 設定が無い・自動保存がオフのときは何もせず skipped を返す（締めの処理を止めない）。
 */
export async function autoBackupToDriveAction(month: string): Promise<ActionResult<{ saved: boolean; fileName: string }>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const { month: m } = notifyStatementsSchema.parse({ month });
    const integration = findIntegration(await loadIntegrations(supabase, company.id), "google_drive");
    if (!integration?.is_enabled) return { saved: false, fileName: "" };
    if (!parseDriveConfig(integration.config).autoBackup) return { saved: false, fileName: "" };
    try {
      const backup = unwrap(await supabase.rpc("export_backup"), "バックアップを作成できませんでした。");
      const file = await uploadToDrive(company.id, `rootive-backup-${m}.json`, backup);
      await logIntegration(company.id, "google_drive", "backup", "ok", `${formatMonthJa(m)} の締めのバックアップを保存しました（${file.name}）`, {
        month: m,
        fileName: file.name,
      });
      revalidateIntegrations();
      return { saved: true, fileName: file.name };
    } catch (e) {
      // 締めを止めないよう、記録だけ残して結果で伝える（integrations は owner しか書けないので更新しない）
      const message = translateError(e);
      await logIntegration(company.id, "google_drive", "backup", "error", message, { month: m });
      revalidateIntegrations();
      throw new ActionError(message);
    }
  });
}
