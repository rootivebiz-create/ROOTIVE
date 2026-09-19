/**
 * PDF 月次の経営レポート（A4 縦・3 ページ）。社内で読む資料（ドライバーへは渡さない）
 * サーバー専用（@react-pdf/renderer の Node 版を使う）
 *
 * 数字はすべて DB ビュー（v_month_pl / v_month_kpi / v_driver_month_summary / v_project_pl）の値をそのまま表示し、
 * ここでは計算しない（差額・率の差など「並べて見せるための引き算」だけ行う）。
 * 経営に詳しくない人が読む前提で、指標には 1 行の日本語の説明を添える。
 */
import { Document, Page, Text, View, StyleSheet, Svg, Rect, Line, Polyline, renderToBuffer } from "@react-pdf/renderer";
import type { ServerSupabase } from "@/lib/supabase/server";
import type { AlertSeverity, Company, MonthKpi } from "@/lib/db/types";
import { ALERT_SEVERITY_LABELS } from "@/lib/db/types";
import { sortAlerts } from "@/lib/alerts/helpers";
import { toProjectRow } from "@/components/projects/helpers";
import { loadMonthKpiRange, loadMonthPl } from "@/lib/db/queries";
import { yen, pct, qty as qtyText } from "@/lib/format";
import { addMonths, dateToMonth, formatDateJa, formatMonthJa, monthToDate } from "@/lib/month";
import { ensurePdfFonts, PDF_FONT_FAMILY } from "./fonts";

// モジュール初期化時に 1 回だけフォントを登録する
ensurePdfFonts();

const GRAY = "#555555";
const LINE_COLOR = "#bbbbbb";
const HEAD_BG = "#eeeeee";
const RED = "#b42318";
const BLUE = "#2f5597";
const BAR_BILL = "#9db8dd";
const BAR_PROFIT = "#6fae9f";
const BAR_LOSS = "#d98b8b";

/** 推移グラフの月数 */
export const TREND_MONTHS = 12;

// ---------------------------------------------------------------------------
// データ
// ---------------------------------------------------------------------------

/** レポートで使う会社 × 月の指標（v_month_kpi の null を 0 に正規化したもの） */
export interface MonthReportKpi {
  /** "YYYY-MM" */
  month: string;
  closed: boolean;
  bill: number;
  pay: number;
  royalty: number;
  mgmtFee: number;
  payout: number;
  payoutIncl: number;
  profit: number;
  expenseTotal: number;
  expenseFixed: number;
  expenseVariable: number;
  operatingProfit: number;
  operatingMargin: number;
  billTarget: number;
  profitTarget: number;
  expenseTarget: number;
  billAchievement: number | null;
  profitAchievement: number | null;
  expenseAchievement: number | null;
  contribution: number;
  contributionRate: number;
  breakEvenBill: number;
  breakEvenRatio: number | null;
  billPerDriver: number;
  profitPerDriver: number;
  billPerWorkDay: number;
  payoutRate: number;
  entryCount: number;
  activeDriverCount: number;
  workDayCount: number;
}

const n = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v) || 0);
const nOrNull = (v: number | string | null | undefined): number | null => (v == null ? null : Number(v) || 0);

/** v_month_kpi の 1 行 → レポート用 */
export function toReportKpi(r: MonthKpi): MonthReportKpi {
  return {
    month: r.month ? dateToMonth(r.month) : "",
    closed: r.status === "closed",
    bill: n(r.bill),
    pay: n(r.pay),
    royalty: n(r.royalty),
    mgmtFee: n(r.mgmt_fee),
    payout: n(r.payout),
    payoutIncl: n(r.payout_incl),
    profit: n(r.profit),
    expenseTotal: n(r.expense_total),
    expenseFixed: n(r.expense_fixed),
    expenseVariable: n(r.expense_variable),
    operatingProfit: n(r.operating_profit),
    operatingMargin: n(r.operating_margin),
    billTarget: n(r.bill_target),
    profitTarget: n(r.profit_target),
    expenseTarget: n(r.expense_target),
    billAchievement: nOrNull(r.bill_achievement),
    profitAchievement: nOrNull(r.profit_achievement),
    expenseAchievement: nOrNull(r.expense_achievement),
    contribution: n(r.contribution),
    contributionRate: n(r.contribution_rate),
    breakEvenBill: n(r.break_even_bill),
    breakEvenRatio: nOrNull(r.break_even_ratio),
    billPerDriver: n(r.bill_per_driver),
    profitPerDriver: n(r.profit_per_driver),
    billPerWorkDay: n(r.bill_per_work_day),
    payoutRate: n(r.payout_rate),
    entryCount: n(r.entry_count),
    activeDriverCount: n(r.active_driver_count),
    workDayCount: n(r.work_day_count),
  };
}

/** データが無い月（推移グラフの 0 埋め） */
export function emptyReportKpi(month: string): MonthReportKpi {
  return {
    month,
    closed: false,
    bill: 0,
    pay: 0,
    royalty: 0,
    mgmtFee: 0,
    payout: 0,
    payoutIncl: 0,
    profit: 0,
    expenseTotal: 0,
    expenseFixed: 0,
    expenseVariable: 0,
    operatingProfit: 0,
    operatingMargin: 0,
    billTarget: 0,
    profitTarget: 0,
    expenseTarget: 0,
    billAchievement: null,
    profitAchievement: null,
    expenseAchievement: null,
    contribution: 0,
    contributionRate: 0,
    breakEvenBill: 0,
    breakEvenRatio: null,
    billPerDriver: 0,
    profitPerDriver: 0,
    billPerWorkDay: 0,
    payoutRate: 0,
    entryCount: 0,
    activeDriverCount: 0,
    workDayCount: 0,
  };
}

export interface MonthReportDriver {
  name: string;
  bill: number;
  payoutIncl: number;
  profit: number;
  entryCount: number;
}

export interface MonthReportProject {
  name: string;
  clientName: string;
  bill: number;
  profit: number;
  margin: number;
  targetMargin: number | null;
  belowTarget: boolean;
}

export interface MonthReportAlert {
  severity: AlertSeverity;
  title: string;
  detail: string;
}

export interface MonthReportData {
  companyName: string;
  /** "YYYY-MM" */
  month: string;
  monthLabel: string;
  /** 作成日 "YYYY-MM-DD" */
  issuedAt: string;
  closed: boolean;
  /** 消費税（v_month_pl。ドライバーへの支払に乗る分） */
  tax: number;
  current: MonthReportKpi;
  prev: MonthReportKpi | null;
  lastYear: MonthReportKpi | null;
  /** 直近 12 か月（古い順・データが無い月は 0 埋め） */
  trend: MonthReportKpi[];
  topDrivers: MonthReportDriver[];
  bottomDrivers: MonthReportDriver[];
  projects: MonthReportProject[];
  alerts: MonthReportAlert[];
}

/** 日本時間の今日 "YYYY-MM-DD" */
function todayJst(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}`;
}

/** 上位・下位（同じドライバーが両方に出ないよう、件数が少ないときは分け合う） */
function splitRanking(rows: MonthReportDriver[], size: number): { top: MonthReportDriver[]; bottom: MonthReportDriver[] } {
  const sorted = [...rows].sort((a, b) => b.profit - a.profit);
  const topCount = Math.min(size, sorted.length);
  const bottomCount = Math.min(size, Math.max(0, sorted.length - topCount));
  return { top: sorted.slice(0, topCount), bottom: bottomCount === 0 ? [] : sorted.slice(-bottomCount).reverse() };
}

/**
 * 月次の経営レポートに必要なデータを読む（DB ビューの値をそのまま使う）。
 * 締め状態は v_month_kpi の status、無ければ month_closings を見る。
 */
export async function loadMonthReportData(supabase: ServerSupabase, company: Pick<Company, "id" | "name">, month: string, now: Date = new Date()): Promise<MonthReportData> {
  const from = addMonths(month, -TREND_MONTHS);
  const [pl, kpis, driversRes, projectsRes, alertsRes, closingRes] = await Promise.all([
    loadMonthPl(supabase, company.id, month),
    loadMonthKpiRange(supabase, company.id, monthToDate(from), monthToDate(month)),
    supabase.from("v_driver_month_summary").select("*").eq("company_id", company.id).eq("month", monthToDate(month)).order("driver_sort_order").order("driver_name"),
    supabase.from("v_project_pl").select("*").eq("company_id", company.id).eq("month", monthToDate(month)).order("project_sort_order").order("project_name"),
    supabase.from("alerts").select("*").eq("company_id", company.id).eq("status", "open").order("detected_at", { ascending: false }).limit(100),
    supabase.from("month_closings").select("status").eq("company_id", company.id).eq("month", monthToDate(month)).maybeSingle(),
  ]);
  if (driversRes.error) throw driversRes.error;
  if (projectsRes.error) throw projectsRes.error;
  if (alertsRes.error) throw alertsRes.error;
  if (closingRes.error) throw closingRes.error;

  const byMonth = new Map(kpis.map((k) => [dateToMonth(k.month ?? ""), toReportKpi(k)]));
  const current = byMonth.get(month) ?? emptyReportKpi(month);
  const trend: MonthReportKpi[] = [];
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const m = addMonths(month, -i);
    trend.push(byMonth.get(m) ?? emptyReportKpi(m));
  }

  const drivers: MonthReportDriver[] = (driversRes.data ?? []).map((d) => ({
    name: d.driver_name ?? "",
    bill: n(d.bill),
    payoutIncl: n(d.payout_incl),
    profit: n(d.driver_profit),
    entryCount: n(d.entry_count),
  }));
  const { top, bottom } = splitRanking(drivers, 5);

  const projects: MonthReportProject[] = (projectsRes.data ?? [])
    .map(toProjectRow)
    .sort((a, b) => b.bill - a.bill)
    .slice(0, 10)
    .map((p) => ({
      name: p.projectName,
      clientName: p.clientName,
      bill: p.bill,
      profit: p.projectProfit,
      margin: p.projectMargin,
      targetMargin: p.targetMargin,
      belowTarget: p.belowTarget,
    }));

  const alerts: MonthReportAlert[] = sortAlerts(alertsRes.data ?? [])
    .slice(0, 10)
    .map((a) => ({ severity: a.severity, title: a.title, detail: a.detail }));

  const closed = current.closed || closingRes.data?.status === "closed";

  return {
    companyName: company.name,
    month,
    monthLabel: formatMonthJa(month),
    issuedAt: todayJst(now),
    closed,
    tax: n(pl.tax),
    current,
    prev: byMonth.get(addMonths(month, -1)) ?? null,
    lastYear: byMonth.get(addMonths(month, -12)) ?? null,
    trend,
    topDrivers: top,
    bottomDrivers: bottom,
    projects,
    alerts,
  };
}

// ---------------------------------------------------------------------------
// 体裁
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // 注意：Page に lineHeight を付けると position:absolute の fixed 要素（フッター）が描画されない（react-pdf 4.9 の挙動）
  page: { padding: 36, paddingBottom: 46, fontFamily: PDF_FONT_FAMILY, fontSize: 9.5, color: "#111111" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  headerLeft: { flexGrow: 1, flexShrink: 1, paddingRight: 12 },
  headerRight: { width: 180, flexShrink: 0, textAlign: "right", fontSize: 9, color: GRAY },
  company: { fontSize: 11, fontWeight: 700, color: "#111111", marginBottom: 2 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 9.5, color: GRAY },
  badge: { alignSelf: "flex-start", marginTop: 6, borderWidth: 1, borderColor: LINE_COLOR, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2, fontSize: 8.5, color: GRAY },
  sectionTitle: { fontSize: 11, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: "#111111", paddingBottom: 3, marginBottom: 4, marginTop: 10 },
  sectionNote: { fontSize: 8.5, color: GRAY, marginBottom: 4, lineHeight: 1.4 },
  table: { marginBottom: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE_COLOR, paddingVertical: 3, alignItems: "flex-start" },
  trHead: { backgroundColor: HEAD_BG, borderBottomWidth: 1, borderBottomColor: "#888888", color: "#333333", fontSize: 8.5 },
  trTotal: { borderBottomWidth: 1, borderBottomColor: "#111111", fontWeight: 700 },
  cell: { paddingHorizontal: 3 },
  num: { textAlign: "right" },
  neg: { color: RED },
  bold: { fontWeight: 700 },
  muted: { color: GRAY, fontSize: 8.5 },
  // 損益サマリー：項目 / 当月 / 前月 / 前月比 / 前年同月 / 前年同月比
  colItem: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  colNow: { width: 86, flexShrink: 0 },
  colPast: { width: 78, flexShrink: 0 },
  colDiff: { width: 72, flexShrink: 0 },
  // 経営指標：指標 / 値 / 説明
  colKpi: { width: 112, flexShrink: 0 },
  colValue: { width: 78, flexShrink: 0 },
  colDesc: { flexGrow: 1, flexShrink: 1, flexBasis: 0, fontSize: 8, color: "#333333" },
  // 目標
  colTarget: { width: 92, flexShrink: 0 },
  bar: { height: 6, borderRadius: 2, backgroundColor: "#e5e7eb", marginTop: 3 },
  barFill: { height: 6, borderRadius: 2, backgroundColor: BLUE },
  // 順位表
  colRank: { width: 18, flexShrink: 0, color: GRAY },
  colName: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  colSmall: { width: 66, flexShrink: 0 },
  colRate: { width: 56, flexShrink: 0 },
  // 気になること
  colSeverity: { width: 36, flexShrink: 0, fontSize: 8.5, color: GRAY },
  colDetail: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  chartLabels: { flexDirection: "row", marginTop: 2 },
  chartLabel: { textAlign: "center", fontSize: 7.5, color: GRAY },
  legend: { flexDirection: "row", gap: 12, marginTop: 4, fontSize: 8, color: GRAY },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  legendSwatch: { width: 8, height: 8, borderRadius: 1 },
  footer: { position: "absolute", left: 36, right: 36, bottom: 24, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: GRAY },
});

/** 長い名前は 1 行に収まるところで切る（PDF の表を崩さないため） */
function clip(text: string, max: number): string {
  const chars = Array.from(text ?? "");
  return chars.length <= max ? (text ?? "") : `${chars.slice(0, max - 1).join("")}…`;
}

function Amount({ value, bold = false }: { value: number; bold?: boolean }) {
  return <Text style={[styles.num, ...(value < 0 ? [styles.neg] : []), ...(bold ? [styles.bold] : [])]}>{yen(value)}</Text>;
}

/** 前月比・前年同月比：金額は差額、率はポイント差。比べる月が無ければ「—」 */
function DiffText({ current, past, rate = false }: { current: number; past: number | null | undefined; rate?: boolean }) {
  if (past == null) return <Text style={[styles.num, styles.muted]}>—</Text>;
  const d = current - past;
  if (Math.abs(d) < (rate ? 0.00005 : 0.5)) return <Text style={[styles.num, styles.muted]}>±0</Text>;
  const sign = d > 0 ? "+" : "-";
  const body = rate ? `${(Math.abs(d) * 100).toFixed(1)}pt` : yen(Math.abs(d));
  return <Text style={[styles.num, ...(d < 0 ? [styles.neg] : [])]}>{`${sign}${body}`}</Text>;
}

/** 損益サマリーの 1 行 */
function PlRow({
  label,
  pick,
  data,
  rate = false,
  total = false,
}: {
  label: string;
  pick: (k: MonthReportKpi) => number;
  data: MonthReportData;
  rate?: boolean;
  total?: boolean;
}) {
  const cur = pick(data.current);
  const prev = data.prev ? pick(data.prev) : null;
  const last = data.lastYear ? pick(data.lastYear) : null;
  const show = (v: number | null) =>
    v == null ? <Text style={[styles.num, styles.muted]}>—</Text> : rate ? <Text style={[styles.num, ...(v < 0 ? [styles.neg] : [])]}>{pct(v)}</Text> : <Amount value={v} bold={total} />;

  return (
    <View style={total ? [styles.tr, styles.trTotal] : styles.tr} wrap={false}>
      <Text style={[styles.cell, styles.colItem, ...(total ? [styles.bold] : [])]}>{label}</Text>
      <View style={[styles.cell, styles.colNow]}>{rate ? <Text style={[styles.num, ...(cur < 0 ? [styles.neg] : []), ...(total ? [styles.bold] : [])]}>{pct(cur)}</Text> : <Amount value={cur} bold={total} />}</View>
      <View style={[styles.cell, styles.colPast]}>{show(prev)}</View>
      <View style={[styles.cell, styles.colDiff]}>
        <DiffText current={cur} past={prev} rate={rate} />
      </View>
      <View style={[styles.cell, styles.colPast]}>{show(last)}</View>
      <View style={[styles.cell, styles.colDiff]}>
        <DiffText current={cur} past={last} rate={rate} />
      </View>
    </View>
  );
}

/** 経営指標の 1 行（値 ＋ 1 行の日本語の説明） */
function KpiRow({ label, value, desc }: { label: string; value: string; desc: string }) {
  return (
    <View style={styles.tr} wrap={false}>
      <Text style={[styles.cell, styles.colKpi, styles.bold]}>{label}</Text>
      <Text style={[styles.cell, styles.colValue, styles.num]}>{value}</Text>
      <Text style={[styles.cell, styles.colDesc]}>{desc}</Text>
    </View>
  );
}

/** 目標に対する進捗の 1 行（達成率のバー付き） */
function TargetRow({ label, target, actual, achievement, note }: { label: string; target: number; actual: number; achievement: number | null; note: string }) {
  const ratio = achievement == null ? null : Math.max(0, Math.min(1.5, achievement));
  return (
    <View style={styles.tr} wrap={false}>
      <View style={[styles.cell, styles.colItem]}>
        <Text>{label}</Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${ratio == null ? 0 : Math.min(100, ratio * 100)}%` }]} />
        </View>
        <Text style={[styles.muted, { marginTop: 2 }]}>{note}</Text>
      </View>
      <View style={[styles.cell, styles.colTarget]}>
        <Amount value={target} />
      </View>
      <View style={[styles.cell, styles.colTarget]}>
        <Amount value={actual} />
      </View>
      <Text style={[styles.cell, styles.colRate, styles.num, ...(achievement != null && achievement < 1 ? [styles.neg] : [])]}>{achievement == null ? "—" : pct(achievement)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 12 か月の推移（矩形と線だけで描く）
// ---------------------------------------------------------------------------

const CHART_WIDTH = 523;
const CHART_HEIGHT = 120;
const CHART_TOP = 6;
const CHART_BODY = 98;

/** 売上・営業利益の棒と、営業利益率の折れ線 */
export function TrendChart({ rows }: { rows: MonthReportKpi[] }) {
  const step = CHART_WIDTH / Math.max(1, rows.length);
  const values = rows.flatMap((r) => [r.bill, r.operatingProfit]);
  const maxV = Math.max(0, ...values);
  const minV = Math.min(0, ...values);
  const span = maxV - minV || 1;
  const y = (v: number) => CHART_TOP + ((maxV - v) / span) * CHART_BODY;
  const zero = y(0);

  const rates = rows.map((r) => r.operatingMargin);
  const rateMax = Math.max(0.1, ...rates);
  const rateMin = Math.min(0, ...rates);
  const rateSpan = rateMax - rateMin || 1;
  const ry = (v: number) => CHART_TOP + ((rateMax - v) / rateSpan) * CHART_BODY;
  const points = rows.map((r, i) => `${(i + 0.5) * step},${ry(r.operatingMargin)}`).join(" ");

  const barW = Math.max(4, step * 0.28);

  return (
    <View>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {/* 0 円の線 */}
        <Line x1={0} y1={zero} x2={CHART_WIDTH} y2={zero} strokeWidth={0.6} stroke={LINE_COLOR} />
        {rows.map((r, i) => {
          const center = (i + 0.5) * step;
          const billH = Math.abs(y(r.bill) - zero);
          return <Rect key={`bill-${r.month}`} x={center - barW - 1} y={Math.min(y(r.bill), zero)} width={barW} height={Math.max(0.5, billH)} fill={BAR_BILL} />;
        })}
        {rows.map((r, i) => {
          const center = (i + 0.5) * step;
          const profitH = Math.abs(y(r.operatingProfit) - zero);
          return (
            <Rect
              key={`profit-${r.month}`}
              x={center + 1}
              y={Math.min(y(r.operatingProfit), zero)}
              width={barW}
              height={Math.max(0.5, profitH)}
              fill={r.operatingProfit < 0 ? BAR_LOSS : BAR_PROFIT}
            />
          );
        })}
        <Polyline points={points} fill="none" stroke={BLUE} strokeWidth={1} />
        {rows.map((r, i) => (
          <Rect key={`dot-${r.month}`} x={(i + 0.5) * step - 1.4} y={ry(r.operatingMargin) - 1.4} width={2.8} height={2.8} fill={BLUE} />
        ))}
      </Svg>
      <View style={styles.chartLabels}>
        {rows.map((r) => (
          <Text key={r.month} style={[styles.chartLabel, { width: step }]}>
            {Number(r.month.slice(5, 7))}月
          </Text>
        ))}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: BAR_BILL }]} />
          <Text>売上</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: BAR_PROFIT }]} />
          <Text>営業利益（マイナスは赤）</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: BLUE }]} />
          <Text>営業利益率（折れ線）</Text>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ドキュメント
// ---------------------------------------------------------------------------

function DriverTable({ rows, empty }: { rows: MonthReportDriver[]; empty: string }) {
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.trHead]}>
        <Text style={[styles.cell, styles.colRank]}>#</Text>
        <Text style={[styles.cell, styles.colName]}>ドライバー</Text>
        <Text style={[styles.cell, styles.colSmall, styles.num]}>売上</Text>
        <Text style={[styles.cell, styles.colSmall, styles.num]}>支払（税込）</Text>
        <Text style={[styles.cell, styles.colSmall, styles.num]}>会社利益</Text>
      </View>
      {rows.length === 0 ? (
        <View style={styles.tr}>
          <Text style={[styles.cell, styles.colName, styles.muted]}>{empty}</Text>
        </View>
      ) : (
        rows.map((d, i) => (
          <View key={`${d.name}-${i}`} style={styles.tr} wrap={false}>
            <Text style={[styles.cell, styles.colRank]}>{i + 1}</Text>
            <Text style={[styles.cell, styles.colName]}>{d.name}</Text>
            <View style={[styles.cell, styles.colSmall]}>
              <Amount value={d.bill} />
            </View>
            <View style={[styles.cell, styles.colSmall]}>
              <Amount value={d.payoutIncl} />
            </View>
            <View style={[styles.cell, styles.colSmall]}>
              <Amount value={d.profit} />
            </View>
          </View>
        ))
      )}
    </View>
  );
}

/** 月次の経営レポート PDF ドキュメント */
export function MonthReportPdf({ data: d }: { data: MonthReportData }) {
  const c = d.current;
  const statusText = d.closed ? "締め済み（確定値）" : "未締め（速報値）";

  return (
    <Document title={`${d.monthLabel} 経営レポート`} author={d.companyName} language="ja">
      {/* ------------------------------------------------------------------ */}
      {/* 1 ページ目：損益サマリーと目標 */}
      {/* ------------------------------------------------------------------ */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.company}>{d.companyName}</Text>
            <Text style={styles.title}>{d.monthLabel} 経営レポート</Text>
            <Text style={styles.subtitle}>稼働 {qtyText(c.entryCount)} 件／稼働中のドライバー {qtyText(c.activeDriverCount)} 名／稼働日数 {qtyText(c.workDayCount)} 日</Text>
            <Text style={styles.badge}>{statusText}</Text>
          </View>
          <View style={styles.headerRight}>
            <Text>作成日 {formatDateJa(d.issuedAt)}</Text>
            <Text>対象月 {d.month}</Text>
          </View>
        </View>

        {!d.closed ? <Text style={styles.sectionNote}>※ この月はまだ締めていません。ここに載せた数字は速報値で、締めるまで変わることがあります。</Text> : null}

        <Text style={styles.sectionTitle}>損益サマリー</Text>
        <Text style={styles.sectionNote}>
          金額は税抜です（「ドライバー支払（税込）」だけ消費税 {yen(d.tax)} を含みます）。営業利益 ＝ 会社利益 − 経費。
        </Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]} fixed>
            <Text style={[styles.cell, styles.colItem]}>項目</Text>
            <Text style={[styles.cell, styles.colNow, styles.num]}>当月</Text>
            <Text style={[styles.cell, styles.colPast, styles.num]}>前月</Text>
            <Text style={[styles.cell, styles.colDiff, styles.num]}>前月比</Text>
            <Text style={[styles.cell, styles.colPast, styles.num]}>前年同月</Text>
            <Text style={[styles.cell, styles.colDiff, styles.num]}>前年同月比</Text>
          </View>
          <PlRow label="会社売上" pick={(k) => k.bill} data={d} />
          <PlRow label="ドライバー支払（税抜）" pick={(k) => k.payout} data={d} />
          <PlRow label="ドライバー支払（税込）" pick={(k) => k.payoutIncl} data={d} />
          <PlRow label="会社利益" pick={(k) => k.profit} data={d} />
          <PlRow label="経費（合計）" pick={(k) => k.expenseTotal} data={d} />
          <PlRow label="　うち固定費" pick={(k) => k.expenseFixed} data={d} />
          <PlRow label="　うち変動費" pick={(k) => k.expenseVariable} data={d} />
          <PlRow label="営業利益" pick={(k) => k.operatingProfit} data={d} total />
          <PlRow label="営業利益率" pick={(k) => k.operatingMargin} data={d} rate />
        </View>

        <Text style={styles.sectionTitle}>目標に対する進捗</Text>
        <Text style={styles.sectionNote}>目標は設定の「月次目標」で決めた金額です。経費は「使いすぎていないか」を見るので、100% を超えると予算オーバーです。</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]} fixed>
            <Text style={[styles.cell, styles.colItem]}>項目</Text>
            <Text style={[styles.cell, styles.colTarget, styles.num]}>目標</Text>
            <Text style={[styles.cell, styles.colTarget, styles.num]}>実績</Text>
            <Text style={[styles.cell, styles.colRate, styles.num]}>達成率</Text>
          </View>
          <TargetRow label="売上" target={c.billTarget} actual={c.bill} achievement={c.billAchievement} note="目標に届いていれば 100% 以上になります。" />
          <TargetRow label="営業利益" target={c.profitTarget} actual={c.operatingProfit} achievement={c.profitAchievement} note="会社に残るお金の目標です。" />
          <TargetRow label="経費" target={c.expenseTarget} actual={c.expenseTotal} achievement={c.expenseAchievement} note="100% を超えると予算オーバーです。" />
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {d.companyName} / {d.monthLabel} 経営レポート / {statusText}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* ------------------------------------------------------------------ */}
      {/* 2 ページ目：経営指標と 12 か月の推移 */}
      {/* ------------------------------------------------------------------ */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>経営指標</Text>
        <Text style={styles.sectionNote}>それぞれの指標が「何を見るための数字か」を右に書いています。</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]} fixed>
            <Text style={[styles.cell, styles.colKpi]}>指標</Text>
            <Text style={[styles.cell, styles.colValue, styles.num]}>当月</Text>
            <Text style={[styles.cell, styles.colDesc]}>読み方</Text>
          </View>
          <KpiRow label="限界利益" value={yen(c.contribution)} desc="売上から、売上に比例して増える費用を引いた残り。固定費を払う元手です。" />
          <KpiRow label="限界利益率" value={pct(c.contributionRate)} desc="売上 100 円のうち手元に残る割合。高いほど売上増が利益になります。" />
          <KpiRow label="損益分岐点売上高" value={yen(c.breakEvenBill)} desc="赤字にならないために最低限必要な売上。これを超えた分が利益になります。" />
          <KpiRow
            label="損益分岐点比率"
            value={c.breakEvenRatio == null ? "—" : pct(c.breakEvenRatio)}
            desc="実際の売上が損益分岐点の何倍か。100% を下回ると赤字です。"
          />
          <KpiRow label="ドライバー 1 人当たり売上" value={yen(c.billPerDriver)} desc="稼働 1 人あたりの平均売上。採用・増車を考えるときの目安です。" />
          <KpiRow label="ドライバー 1 人当たり利益" value={yen(c.profitPerDriver)} desc="稼働 1 人が会社に残した平均利益。採用の採算を見ます。" />
          <KpiRow label="稼働 1 日当たり売上" value={yen(c.billPerWorkDay)} desc="1 日の稼働あたりの平均売上。日別の稼働報告がある月だけ出ます。" />
          <KpiRow label="支払比率" value={pct(c.payoutRate)} desc="売上のうちドライバー支払が占める割合（税抜）。上がりすぎに注意。" />
        </View>

        <Text style={styles.sectionTitle}>12 か月の推移</Text>
        <Text style={styles.sectionNote}>棒＝売上と営業利益、折れ線＝営業利益率。データが無い月は 0 として描いています。</Text>
        <TrendChart rows={d.trend} />

        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]}>
            <Text style={[styles.cell, styles.colName]}>月</Text>
            <Text style={[styles.cell, styles.colSmall, styles.num]}>売上</Text>
            <Text style={[styles.cell, styles.colSmall, styles.num]}>経費</Text>
            <Text style={[styles.cell, styles.colSmall, styles.num]}>営業利益</Text>
            <Text style={[styles.cell, styles.colRate, styles.num]}>営業利益率</Text>
          </View>
          {d.trend.map((t) => (
            <View key={t.month} style={styles.tr} wrap={false}>
              <Text style={[styles.cell, styles.colName]}>{formatMonthJa(t.month)}</Text>
              <View style={[styles.cell, styles.colSmall]}>
                <Amount value={t.bill} />
              </View>
              <View style={[styles.cell, styles.colSmall]}>
                <Amount value={t.expenseTotal} />
              </View>
              <View style={[styles.cell, styles.colSmall]}>
                <Amount value={t.operatingProfit} />
              </View>
              <Text style={[styles.cell, styles.colRate, styles.num, ...(t.operatingMargin < 0 ? [styles.neg] : [])]}>{pct(t.operatingMargin)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {d.companyName} / {d.monthLabel} 経営レポート / {statusText}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* ------------------------------------------------------------------ */}
      {/* 3 ページ目：ドライバー別・案件別・気になること */}
      {/* ------------------------------------------------------------------ */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>ドライバー別の採算（会社利益の多い順）</Text>
        <Text style={styles.sectionNote}>支払（税込）が実際の振込額です。会社利益 ＝ 単価差額利益 ＋ ロイヤリティ ＋ 管理費 ＋ 調整。</Text>
        <DriverTable rows={d.topDrivers} empty="この月の稼働はありません" />

        {d.bottomDrivers.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 6 }]}>ドライバー別の採算（会社利益の少ない順）</Text>
            <Text style={styles.sectionNote}>利益が小さい人は単価・管理費・調整を見直してください（オーナー本人は支払単価 0 が正常です）。</Text>
            <DriverTable rows={d.bottomDrivers} empty="—" />
          </>
        ) : null}

        <Text style={styles.sectionTitle}>案件別の採算（売上の多い順・上位 10 件）</Text>
        <Text style={styles.sectionNote}>案件利益 ＝ 稼働の利益 − 直課経費。★ は目標利益率を下回っている案件です。</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]}>
            <Text style={[styles.cell, styles.colName]}>案件（取引先）</Text>
            <Text style={[styles.cell, styles.colSmall, styles.num]}>売上</Text>
            <Text style={[styles.cell, styles.colSmall, styles.num]}>案件利益</Text>
            <Text style={[styles.cell, styles.colRate, styles.num]}>利益率</Text>
            <Text style={[styles.cell, styles.colRate, styles.num]}>目標</Text>
          </View>
          {d.projects.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.cell, styles.colName, styles.muted]}>この月の案件はありません</Text>
            </View>
          ) : (
            d.projects.map((p, i) => (
              <View key={`${p.name}-${i}`} style={styles.tr} wrap={false}>
                <Text style={[styles.cell, styles.colName]}>{clip(`${p.belowTarget ? "★ " : ""}${p.name}${p.clientName ? `（${p.clientName}）` : ""}`, 30)}</Text>
                <View style={[styles.cell, styles.colSmall]}>
                  <Amount value={p.bill} />
                </View>
                <View style={[styles.cell, styles.colSmall]}>
                  <Amount value={p.profit} />
                </View>
                <Text style={[styles.cell, styles.colRate, styles.num, ...(p.belowTarget || p.margin < 0 ? [styles.neg] : [])]}>{pct(p.margin)}</Text>
                <Text style={[styles.cell, styles.colRate, styles.num, styles.muted]}>{p.targetMargin == null ? "—" : pct(p.targetMargin)}</Text>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>気になること（未対応・重要な順に 10 件まで）</Text>
        <Text style={styles.sectionNote}>システムが自動で見つけた注意点です。対応すると一覧から消えます。</Text>
        <View style={styles.table}>
          {d.alerts.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.cell, styles.colDetail, styles.muted]}>未対応の気になることはありません。</Text>
            </View>
          ) : (
            d.alerts.map((a, i) => (
              <View key={`${a.title}-${i}`} style={styles.tr} wrap={false}>
                <Text style={[styles.cell, styles.colSeverity, ...(a.severity === "high" ? [styles.neg] : [])]}>{ALERT_SEVERITY_LABELS[a.severity]}</Text>
                <View style={[styles.cell, styles.colDetail]}>
                  <Text style={styles.bold}>{clip(a.title, 46)}</Text>
                  {a.detail ? <Text style={styles.muted}>{clip(a.detail, 54)}</Text> : null}
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {d.companyName} / {d.monthLabel} 経営レポート / {statusText}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** PDF ファイル名：経営レポート_2026-12.pdf */
export function monthReportPdfFilename(month: string): string {
  return `経営レポート_${month}.pdf`;
}

/** 月次の経営レポート PDF を生成する */
export async function renderMonthReportPdf(data: MonthReportData): Promise<Buffer> {
  return renderToBuffer(<MonthReportPdf data={data} />);
}
