import "server-only";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { Company } from "@/lib/db/types";
import { ActionError, ensureNoError, unwrap } from "@/lib/actions/result";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/env";
import { formatMonthJa, monthToDate } from "@/lib/month";
import { resolvePayoutDate } from "@/lib/statement";
import { pushLineMessages } from "@/lib/integrations/line";
import { logIntegration } from "@/lib/integrations/logs";
import { statementReadyMessage } from "@/lib/integrations/messages";
import { canSendPush } from "@/lib/push/config";
import { loadSubscriptions, sendPush } from "@/lib/push/send";
import { planStatementSend, statementPushPayload, type DeliveryChannel, type SendStatementsResult, type StatementTarget } from "./delivery";

/**
 * 支払明細の送付（サーバー専用。0028）。
 *
 * - 宛先・金額・送った記録は本人の権限（RLS）で読む。締めた月でなければ送らない
 * - 会社の LINE 連携の有無と端末の購読は、事務員（外部連携の設定を読めない）でも判定できるようにサービスロールで読む。
 *   **サービスロールで読むものは必ず company_id で絞る**
 * - 送れた人だけ `record_statement_deliveries` で記録する（LINE が届いた人は line、通知だけ届いた人は push）
 */

export interface StatementTargetsData {
  month: string;
  closed: boolean;
  /** 会社の LINE 連携が有効 */
  lineEnabled: boolean;
  /** 端末への通知が使える（鍵がそろっている） */
  pushEnabled: boolean;
  targets: StatementTarget[];
}

interface Loaded extends StatementTargetsData {
  driverById: Map<string, { name: string; lineUserId: string; payoutMonthOffset: number | null; payoutDay: number | null }>;
  profileByDriver: Map<string, string>;
}

/** 会社の LINE 連携が有効か（事務員は integrations を読めないので、サービスロールがあればそちらで読む） */
async function isLineEnabled(supabase: ServerSupabase, companyId: string): Promise<boolean> {
  const client = hasServiceRoleKey() ? createAdminClient() : supabase;
  const { data } = await client.from("integrations").select("is_enabled").eq("company_id", companyId).eq("kind", "line").maybeSingle();
  return data?.is_enabled === true;
}

async function load(supabase: ServerSupabase, companyId: string, month: string): Promise<Loaded> {
  const m = monthToDate(month);
  const [summaries, deliveries, drivers, lineEnabled] = await Promise.all([
    supabase.from("v_driver_month_summary").select("driver_id, driver_name, driver_sort_order, active_entry_count, payout_incl, is_closed").eq("company_id", companyId).eq("month", m),
    supabase.from("statement_deliveries").select("driver_id, channel, sent_at, sent_by_name, payout_incl").eq("company_id", companyId).eq("month", m),
    supabase.from("drivers").select("id, name, line_user_id, payout_month_offset, payout_day").eq("company_id", companyId),
    isLineEnabled(supabase, companyId),
  ]);
  const rows = unwrap(summaries, "この月の集計を読み込めませんでした。");
  const sent = new Map((unwrap(deliveries, "送った記録を読み込めませんでした。") ?? []).map((d) => [d.driver_id, d]));
  const driverById = new Map(
    unwrap(drivers, "ドライバーを読み込めませんでした。").map((d) => [
      d.id,
      { name: d.name, lineUserId: (d.line_user_id ?? "").trim(), payoutMonthOffset: d.payout_month_offset, payoutDay: d.payout_day },
    ]),
  );

  // 端末への通知：ドライバーのログインと購読（本人しか読めないのでサービスロールで読む）
  const pushEnabled = canSendPush();
  const profileByDriver = new Map<string, string>();
  const pushReady = new Set<string>();
  if (pushEnabled) {
    const admin = createAdminClient();
    const { data: profiles } = await admin.from("profiles").select("id, driver_id, is_active").eq("company_id", companyId).eq("is_active", true);
    for (const p of profiles ?? []) if (p.driver_id) profileByDriver.set(p.driver_id, p.id);
    const subs = await loadSubscriptions(admin, companyId, Array.from(profileByDriver.values())).catch(() => new Map());
    for (const [driverId, profileId] of profileByDriver) if ((subs.get(profileId) ?? []).length > 0) pushReady.add(driverId);
  }

  const targets: StatementTarget[] = rows
    .filter((r) => r.driver_id && Number(r.active_entry_count ?? 0) > 0)
    .sort((a, b) => Number(a.driver_sort_order ?? 0) - Number(b.driver_sort_order ?? 0) || String(a.driver_name ?? "").localeCompare(String(b.driver_name ?? ""), "ja"))
    .map((r) => {
      const id = r.driver_id as string;
      const d = sent.get(id);
      return {
        driverId: id,
        driverName: r.driver_name ?? "",
        payoutIncl: Number(r.payout_incl ?? 0),
        lineReady: lineEnabled && (driverById.get(id)?.lineUserId ?? "") !== "",
        pushReady: pushReady.has(id),
        sentAt: d?.sent_at ?? null,
        sentChannel: (d?.channel === "push" ? "push" : d ? "line" : null) as DeliveryChannel | null,
        sentByName: d?.sent_by_name ?? "",
        sentPayoutIncl: d?.payout_incl == null ? null : Number(d.payout_incl),
      };
    });

  return {
    month,
    closed: rows.length > 0 && rows.every((r) => r.is_closed === true),
    lineEnabled,
    pushEnabled,
    targets,
    driverById,
    profileByDriver,
  };
}

/** 支払の画面・送付のダイアログに出す一覧 */
export async function loadStatementTargets(supabase: ServerSupabase, companyId: string, month: string): Promise<StatementTargetsData> {
  const { driverById: _d, profileByDriver: _p, ...data } = await load(supabase, companyId, month);
  return data;
}

/**
 * 送る。1 人の失敗で全体を止めない（届かなかった人は failed に数え、記録しない）
 * @param opts.driverIds 指定した人だけ（省略で全員）
 * @param opts.resend 送信済みの人にも送り直す（金額が変わった人は指定しなくても送る）
 */
export async function sendStatements(
  supabase: ServerSupabase,
  company: Company,
  month: string,
  opts: { driverIds?: string[] | null; resend?: boolean; lineOnly?: boolean } = {},
): Promise<SendStatementsResult> {
  const data = await load(supabase, company.id, month);
  if (!data.closed) throw new ActionError(`${formatMonthJa(month)} はまだ締めていないため、支払明細を送れません。先に月を締めてください。`);

  // 月締めの自動送信は LINE だけ（今までどおり）。手で送るときは通知も使う
  const targets = opts.lineOnly ? data.targets.map((t) => ({ ...t, pushReady: false })) : data.targets;
  const plan = planStatementSend(targets, { driverIds: opts.driverIds, resend: opts.resend });
  const result: SendStatementsResult = { sent: 0, line: 0, push: 0, failed: 0, alreadySent: plan.alreadySent, noContact: plan.noContact };
  if (plan.send.length === 0) return result;

  const monthLabel = formatMonthJa(month);
  const url = `${appUrl()}/driver/statements/${month}`;

  // ---- LINE ----
  const lineOk = new Set<string>();
  const lineTargets = plan.send.filter((t) => t.lineReady);
  if (lineTargets.length > 0) {
    try {
      const items = lineTargets.map((t) => {
        const d = data.driverById.get(t.driverId);
        const { date } = resolvePayoutDate(month, company, { payout_month_offset: d?.payoutMonthOffset ?? null, payout_day: d?.payoutDay ?? null });
        return {
          to: d?.lineUserId ?? "",
          label: t.driverId,
          text: statementReadyMessage({ companyName: company.name, driverName: t.driverName, monthLabel, payoutIncl: t.payoutIncl, payoutDate: date, url }),
        };
      });
      const results = await pushLineMessages(company.id, items);
      for (const r of results) if (r.ok) lineOk.add(r.label);
      const failed = results.filter((r) => !r.ok);
      await logIntegration(
        company.id,
        "line",
        "notify_statement",
        failed.length > 0 ? "error" : "ok",
        `${monthLabel} の支払明細を ${lineOk.size} 件送信しました${failed.length > 0 ? `（失敗 ${failed.length} 件：${failed[0].error}）` : ""}`,
        { month, sent: lineOk.size, failed: failed.length },
      );
    } catch (e) {
      await logIntegration(company.id, "line", "notify_statement", "error", e instanceof Error ? e.message : String(e), { month });
    }
  }

  // ---- 端末への通知 ----
  const pushOk = new Set<string>();
  const pushTargets = plan.send.filter((t) => t.pushReady);
  if (pushTargets.length > 0 && canSendPush()) {
    try {
      const admin = createAdminClient();
      const profileIds = pushTargets.map((t) => data.profileByDriver.get(t.driverId)).filter((id): id is string => Boolean(id));
      const subs = await loadSubscriptions(admin, company.id, profileIds);
      for (const t of pushTargets) {
        const profileId = data.profileByDriver.get(t.driverId);
        const list = profileId ? (subs.get(profileId) ?? []) : [];
        if (list.length === 0) continue;
        const r = await sendPush(admin, company.id, list, statementPushPayload({ month, monthLabel, payoutIncl: t.payoutIncl }));
        if (r.sent > 0) pushOk.add(t.driverId);
      }
    } catch {
      /* 通知が飛ばなくても LINE で届いた人の記録は残す */
    }
  }

  // ---- 記録（届いた人だけ） ----
  const lineIds = Array.from(lineOk);
  const pushOnlyIds = Array.from(pushOk).filter((id) => !lineOk.has(id));
  if (lineIds.length > 0) ensureNoError(await supabase.rpc("record_statement_deliveries", { p_month: monthToDate(month), p_driver_ids: lineIds, p_channel: "line" }));
  if (pushOnlyIds.length > 0) ensureNoError(await supabase.rpc("record_statement_deliveries", { p_month: monthToDate(month), p_driver_ids: pushOnlyIds, p_channel: "push" }));

  result.line = lineOk.size;
  result.push = pushOk.size;
  result.sent = lineIds.length + pushOnlyIds.length;
  result.failed = plan.send.length - result.sent;
  return result;
}
