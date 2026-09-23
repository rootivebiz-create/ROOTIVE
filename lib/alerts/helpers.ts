/**
 * 異常の検知（アラート）の純関数（React・DB に依存しない。画面・CSV 出力・テストから使う）
 *
 * - 並び順は「重さ（重要 → 注意 → 参考）→ 検知日時の新しい順」で統一する
 * - 種類（code）ごとの表示名・説明・アイコンは ALERT_CODE_INFO だけを正とする
 *   （アイコンは lucide-react の名前。実際の部品への対応付けは components/alerts/icons.tsx）
 */
import type { Alert, AlertSeverity } from "@/lib/db/types";

// ---------------------------------------------------------------------------
// 種類（code）の表示情報
// ---------------------------------------------------------------------------

export interface AlertCodeInfo {
  /** 一覧のバッジに出す短い名前 */
  label: string;
  /** 「どうすればよいか」の一言（説明が空のときの代わりにもなる） */
  hint: string;
  /** lucide-react のアイコン名 */
  icon: string;
}

/** RPC detect_anomalies が作る 25 種類の code（24 ルール。契約だけ更新時期と期限切れで 2 種類。表示の並び順もこの順） */
export const ALERT_CODE_INFO: Record<string, AlertCodeInfo> = {
  qty_zero: {
    label: "数量 0 の稼働",
    hint: "数量を入れ忘れている行があります。稼働の画面で数量を入れてください。",
    icon: "ClipboardList",
  },
  rate_diff: {
    label: "マスタと違う単価",
    hint: "単価表を変えたあとに稼働へ反映していない可能性があります。稼働の画面で「マスタの値に更新」できます。",
    icon: "Tags",
  },
  mgmt_fee_mismatch: {
    label: "管理費が既定と違う",
    hint: "この月だけ管理費が変わっています。意図した変更か確認してください。",
    icon: "Wallet",
  },
  no_entry: {
    label: "稼働が無い",
    hint: "稼働中のドライバーに、この月の稼働が 1 件もありません。入力漏れか、稼働状態の見直しが必要です。",
    icon: "UserX",
  },
  margin_drop: {
    label: "営業利益率の低下",
    hint: "営業利益率が前月より 5 ポイント以上下がりました。単価と経費を見直してください。",
    icon: "TrendingDown",
  },
  driver_loss: {
    label: "ドライバーの利益がマイナス",
    hint: "そのドライバーの会社利益がマイナスです。単価と調整を確認してください。",
    icon: "UserMinus",
  },
  target_miss: {
    label: "目標未達",
    hint: "売上が目標の 8 割に届きませんでした。目標の見直しか、稼働の積み増しを検討してください。",
    icon: "Target",
  },
  invoice_overdue: {
    label: "入金の遅れ",
    hint: "支払期日を過ぎた未入金の請求書があります。取引先に確認してください。",
    icon: "Clock",
  },
  invoice_missing: {
    label: "請求書が未作成",
    hint: "売上があるのに請求書がありません。請求の画面で稼働から作成してください。",
    icon: "Receipt",
  },
  expense_missing: {
    label: "経費が未入力",
    hint: "経費を入れると営業利益（会社利益 − 経費）が正しく出ます。",
    icon: "Coins",
  },
  cash_short: {
    label: "資金不足の見込み",
    hint: "30 日以内に残高が不足する見込みです。入金予定と支払予定を確認してください。",
    icon: "Landmark",
  },
  // 0012：運行管理と法令対応
  document_expired: {
    label: "書類の期限切れ",
    hint: "車検・保険・免許などの期限が切れています。更新して登録し直してください。",
    icon: "FileWarning",
  },
  document_expiring: {
    label: "書類の期限が近い",
    hint: "まもなく期限が来る書類があります。早めに更新してください。",
    icon: "FileClock",
  },
  roll_call_missing: {
    label: "点呼の未実施",
    hint: "稼働した日は業務前・業務後の点呼を記録し、1 年間保存する必要があります。",
    icon: "ClipboardCheck",
  },
  safety_manager_missing: {
    label: "安全管理者の未選任",
    hint: "貨物軽自動車安全管理者を営業所ごとに 1 名以上選任する必要があります。",
    icon: "ShieldAlert",
  },
  day_entry_pending: {
    label: "承認待ちの稼働報告",
    hint: "ドライバーからの報告を承認すると、月次の稼働に反映されます。",
    icon: "ClipboardCheck",
  },
  // 0014：法人の経営管理
  tax_due: {
    label: "税務の期限が近い",
    hint: "申告・納付の期限が近づいています。納税資金の準備も確認してください。",
    icon: "CalendarClock",
  },
  tax_overdue: {
    label: "税務の期限切れ",
    hint: "期限を過ぎています。対応が済んでいれば「対応済み」にしてください。",
    icon: "CalendarClock",
  },
  contract_renewal: {
    label: "契約の更新時期",
    hint: "契約の満了が近づいています。続けるかどうかを確認してください。",
    icon: "ScrollText",
  },
  contract_expired: {
    label: "契約の期限切れ",
    hint: "契約期間が終わっています。更新した契約書を登録してください。",
    icon: "ScrollText",
  },
  bank_account_missing: {
    label: "口座が未登録",
    hint: "振込データを作るには、銀行・支店・口座番号・カナ名義が必要です。",
    icon: "Banknote",
  },
  // 0018：労務と支払通知
  duty_long: {
    label: "拘束時間が長い",
    hint: "開始から終了までが目安を超えた日があります。配車を見直してください。",
    icon: "Timer",
  },
  rest_short: {
    label: "休息が足りない",
    hint: "前の稼働の終了から次の開始までが目安を下回っています。事故につながるため、間隔を空けてください。",
    icon: "Timer",
  },
  consecutive_days: {
    label: "連続勤務が長い",
    hint: "休みを入れられないか確認してください。",
    icon: "Timer",
  },
  notice_diff: {
    label: "支払通知との差",
    hint: "元請の支払通知と自社の売上に差があります。明細を突き合わせてください。",
    icon: "FileCheck2",
  },
  // 0019・0020：代表
  approval_pending: {
    label: "決裁待ちが止まっている",
    hint: "代表の決裁を待っている申請があります。代表の画面で承認か却下をしてください。",
    icon: "Stamp",
  },
  export_burst: {
    label: "出力が急に増えた",
    hint: "口座・明細・振込データ・バックアップの持ち出しが普段より多くなっています。誰が出したか確認してください。",
    icon: "ShieldAlert",
  },
};

/** 表示・CSV の並び順に使う code の一覧 */
export const ALERT_CODES: string[] = Object.keys(ALERT_CODE_INFO);

/**
 * 経営のためのアラート（事務員には見せない。0028）。DB の is_management_alert と同じ一覧で、
 * 画面は RLS が絞るので、ここを使うのは RLS が効かないサービスロールの経路（LINE の返事など）だけ
 */
export const MANAGEMENT_ALERT_CODES: readonly string[] = ["margin_drop", "driver_loss", "target_miss", "cash_short", "tax_due", "tax_overdue", "approval_pending", "export_burst"];

export function isManagementAlert(code: string | null | undefined): boolean {
  return MANAGEMENT_ALERT_CODES.includes(code ?? "");
}

/** 未知の code でも表示できるようにする（DB 側で種類が増えても画面が壊れない） */
export const UNKNOWN_ALERT_CODE_INFO: AlertCodeInfo = {
  label: "その他",
  hint: "内容を確認してください。",
  icon: "AlertTriangle",
};

export function alertCodeInfo(code: string | null | undefined): AlertCodeInfo {
  return (code && ALERT_CODE_INFO[code]) || UNKNOWN_ALERT_CODE_INFO;
}

// ---------------------------------------------------------------------------
// 並べ替え・集計
// ---------------------------------------------------------------------------

/** 重さの並び順（小さいほど先に出る） */
const SEVERITY_ORDER: Record<AlertSeverity, number> = { high: 0, medium: 1, low: 2 };

export function severityRank(severity: AlertSeverity): number {
  return SEVERITY_ORDER[severity] ?? SEVERITY_ORDER.low;
}

/** 並べ替えに必要な最小限の形（テスト・カード用の部分型でも使える） */
export type SortableAlert = Pick<Alert, "severity" | "detected_at">;

/**
 * 重さ（重要 → 注意 → 参考）→ 検知日時の新しい順。
 * 元の配列は変更しない。同じ重さ・同じ日時なら元の並びを保つ（安定ソート）。
 */
export function sortAlerts<T extends SortableAlert>(alerts: readonly T[]): T[] {
  return [...alerts].sort((a, b) => {
    const s = severityRank(a.severity) - severityRank(b.severity);
    if (s !== 0) return s;
    const da = a.detected_at ?? "";
    const db = b.detected_at ?? "";
    if (da === db) return 0;
    return da < db ? 1 : -1;
  });
}

export interface SeverityGroups<T> {
  high: T[];
  medium: T[];
  low: T[];
}

/** 重さで 3 つに分ける（各グループは渡された順のまま。並べ替えたいときは先に sortAlerts） */
export function groupBySeverity<T extends Pick<Alert, "severity">>(alerts: readonly T[]): SeverityGroups<T> {
  const groups: SeverityGroups<T> = { high: [], medium: [], low: [] };
  for (const a of alerts) {
    const key: AlertSeverity = a.severity === "high" || a.severity === "medium" ? a.severity : "low";
    groups[key].push(a);
  }
  return groups;
}

export interface SeverityCounts {
  high: number;
  medium: number;
  low: number;
}

export const ZERO_COUNTS: SeverityCounts = { high: 0, medium: 0, low: 0 };

/** 重さごとの件数を数える */
export function countsOf(alerts: readonly Pick<Alert, "severity">[]): SeverityCounts {
  const g = groupBySeverity(alerts);
  return { high: g.high.length, medium: g.medium.length, low: g.low.length };
}

export function totalCount(counts: SeverityCounts): number {
  return counts.high + counts.medium + counts.low;
}

/** 重さの表示名（ALERT_SEVERITY_LABELS と同じ並び） */
const SUMMARY_ORDER: { key: keyof SeverityCounts; label: string }[] = [
  { key: "high", label: "重要" },
  { key: "medium", label: "注意" },
  { key: "low", label: "参考" },
];

/**
 * 「重要 2 件・注意 5 件」。0 件の区分は出さない。全部 0 なら「問題なし」。
 * マイナスや小数は 0 として扱う（DB の count は整数だが、念のため）。
 */
export function alertSummaryText(counts: SeverityCounts): string {
  const parts = SUMMARY_ORDER.map(({ key, label }) => ({ label, n: Math.max(0, Math.floor(counts[key] || 0)) }))
    .filter((p) => p.n > 0)
    .map((p) => `${p.label} ${p.n} 件`);
  return parts.length === 0 ? "問題なし" : parts.join("・");
}

// ---------------------------------------------------------------------------
// 最終検査からの経過
// ---------------------------------------------------------------------------

/** 1 回の自動検査の間隔（分）。画面を開いたときの自動検査で使う */
export const STALE_MINUTES = 60;

/**
 * 最終検査が minutes より古い（＝もう一度検査したほうがよい）か。
 * 一度も検査していない（null・空・不正な日時）は true。未来の日時は false。
 */
export function isStale(lastDetectedAt: string | null | undefined, now: Date = new Date(), minutes: number = STALE_MINUTES): boolean {
  if (!lastDetectedAt) return true;
  const t = Date.parse(lastDetectedAt);
  if (Number.isNaN(t)) return true;
  const elapsed = now.getTime() - t;
  if (elapsed < 0) return false;
  return elapsed > Math.max(0, minutes) * 60_000;
}

// ---------------------------------------------------------------------------
// 検査（RPC detect_anomalies）の結果
// ---------------------------------------------------------------------------

/** RPC detect_anomalies の戻り値 */
export interface DetectAnomaliesResult {
  /** この検査で見つかった件数（対象外にしたものも含む） */
  detected: number;
  /** 検査後に残っている未対応の件数 */
  open: number;
  /** 直っていたので自動で対応済みにした件数 */
  auto_resolved: number;
}

/** 自動検査の戻り値（実行したかどうかつき） */
export interface DetectIfStaleResult extends DetectAnomaliesResult {
  /** 実際に検査したか（最終検査が新しければ false） */
  ran: boolean;
  /** 検査前の最終検査時刻（一度も検査していなければ null） */
  last_detected_at: string | null;
}

/** 「7 件の注意点が見つかりました」／「気になる点はありませんでした」 */
export function detectMessage(result: DetectAnomaliesResult): string {
  const resolved = result.auto_resolved > 0 ? `（${result.auto_resolved} 件は解消していました）` : "";
  return result.open === 0 ? `気になる点はありませんでした${resolved}` : `${result.open} 件の注意点が見つかりました${resolved}`;
}
