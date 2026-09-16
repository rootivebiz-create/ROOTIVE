import { FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Money, Pct } from "@/components/ui/money";
import { yen, qty as qtyText, formatDateTimeJa } from "@/lib/format";
import { formatDateJa, formatMonthJa } from "@/lib/month";
import { resolvePayoutDate } from "@/lib/statement";
import { ROUNDING_MODES, taxRateLabel, type RoundingMode, type TaxMode } from "@/lib/calc";
import { exportUrls } from "@/lib/exports/urls";
import { cn } from "@/lib/utils";

/** rpc driver_portal_statement の JSON（0005_portal_seed.sql、0008 で税・ロゴ・支払日を追加） */
export interface PortalStatement {
  month: string;
  status: "open" | "closed";
  driver: {
    id: string;
    name: string;
    /** 適格請求書登録番号（空文字 = 未設定） */
    invoice_reg_no: string;
    tax_mode: TaxMode;
    /** 支払日の個別設定（null = 会社設定に従う） */
    payout_month_offset: number | null;
    payout_day: number | null;
  } | null;
  company: {
    name: string;
    address: string;
    tel: string;
    invoice_reg_no: string;
    statement_note: string;
    payout_month_offset: number;
    payout_day: number;
    show_royalty: boolean;
    has_logo: boolean;
    has_seal: boolean;
  } | null;
  entries: {
    id: string;
    project_name: string;
    item_name: string;
    unit: "day" | "piece";
    qty: number;
    pay_rate: number;
    pay: number;
    royalty: number;
    royalty_rate: number | null;
    memo: string;
  }[];
  summary: {
    pay: number;
    royalty: number;
    mgmt_fee: number;
    adj_pay: number;
    /** 税抜の支払額 */
    payout: number;
    royalty_visible: boolean;
    tax_mode: TaxMode;
    tax_rate: number;
    tax_rounding: RoundingMode;
    /** 税抜小計（消費税の対象額） */
    tax_base: number;
    tax: number;
    /** 税込の支払額（お支払額） */
    payout_incl: number;
  } | null;
  adjustments: { id: string; label: string; amount: number }[];
  closed_at: string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v == null || v === "" ? null : num(v));
const taxModeOf = (v: unknown): TaxMode => (v === "exempt" ? "exempt" : "taxable");
const roundingOf = (v: unknown): RoundingMode => (typeof v === "string" && (ROUNDING_MODES as string[]).includes(v) ? (v as RoundingMode) : "floor");

/** RPC の JSON を安全に型へ変換する（null や欠損に耐える） */
export function parsePortalStatement(json: unknown): PortalStatement | null {
  if (!isObj(json)) return null;
  const status = json.status === "closed" ? "closed" : "open";
  const d = isObj(json.driver) ? json.driver : null;
  const driver = d
    ? {
        id: str(d.id),
        name: str(d.name),
        invoice_reg_no: str(d.invoice_reg_no),
        tax_mode: taxModeOf(d.tax_mode),
        payout_month_offset: numOrNull(d.payout_month_offset),
        payout_day: numOrNull(d.payout_day),
      }
    : null;
  const c = isObj(json.company) ? json.company : null;
  const company = c
    ? {
        name: str(c.name),
        address: str(c.address),
        tel: str(c.tel),
        invoice_reg_no: str(c.invoice_reg_no),
        statement_note: str(c.statement_note),
        payout_month_offset: num(c.payout_month_offset),
        payout_day: num(c.payout_day),
        show_royalty: c.show_royalty === true,
        has_logo: c.has_logo === true,
        has_seal: c.has_seal === true,
      }
    : null;
  const entries = Array.isArray(json.entries)
    ? json.entries.filter(isObj).map((e) => ({
        id: str(e.id),
        project_name: str(e.project_name),
        item_name: str(e.item_name),
        unit: e.unit === "piece" ? ("piece" as const) : ("day" as const),
        qty: num(e.qty),
        pay_rate: num(e.pay_rate),
        pay: num(e.pay),
        royalty: num(e.royalty),
        royalty_rate: e.royalty_rate == null ? null : num(e.royalty_rate),
        memo: str(e.memo),
      }))
    : [];
  const s = isObj(json.summary) ? json.summary : null;
  const summary = s
    ? {
        pay: num(s.pay),
        royalty: num(s.royalty),
        mgmt_fee: num(s.mgmt_fee),
        adj_pay: num(s.adj_pay),
        payout: num(s.payout),
        royalty_visible: s.royalty_visible === true,
        tax_mode: taxModeOf(s.tax_mode),
        tax_rate: num(s.tax_rate),
        tax_rounding: roundingOf(s.tax_rounding),
        tax_base: num(s.tax_base),
        tax: num(s.tax),
        // 旧 RPC（payout_incl 無し）からの応答には税抜の支払額を使う
        payout_incl: s.payout_incl == null ? num(s.payout) : num(s.payout_incl),
      }
    : null;
  const adjustments = Array.isArray(json.adjustments) ? json.adjustments.filter(isObj).map((a) => ({ id: str(a.id), label: str(a.label), amount: num(a.amount) })) : [];
  return { month: str(json.month), status, driver, company, entries, summary, adjustments, closed_at: json.closed_at == null ? null : str(json.closed_at) };
}

function entryTitle(e: { project_name: string; item_name: string }) {
  return e.item_name && e.item_name !== "標準" ? `${e.project_name}（${e.item_name}）` : e.project_name;
}

/**
 * ドライバーポータルの明細表示（会社売上・会社利益は含めない）
 * 構成は PDF・印刷ページと同じ：お支払額（税込）→ 稼働 → 控除 → 小計（税抜）→ 消費税 → 調整（税込）→ お支払額（税込）
 * 金額はすべて RPC（集計ビュー）の値をそのまま表示する
 */
export function PortalStatementView({
  st,
  month,
  driverId,
  fallback,
}: {
  st: PortalStatement;
  month: string;
  driverId: string;
  fallback: { payout_month_offset: number; payout_day: number; statement_note: string; companyName: string };
}) {
  const summary: NonNullable<PortalStatement["summary"]> = st.summary ?? {
    pay: 0,
    royalty: 0,
    mgmt_fee: 0,
    adj_pay: 0,
    payout: 0,
    royalty_visible: false,
    tax_mode: st.driver?.tax_mode ?? "taxable",
    tax_rate: 0,
    tax_rounding: "floor",
    tax_base: 0,
    tax: 0,
    payout_incl: 0,
  };
  const taxable = summary.tax_mode === "taxable";
  const payoutLabel = taxable ? "お支払額（税込）" : "お支払額";
  const taxLabel = `消費税（${taxRateLabel(summary.tax_rate)}）`;
  const showRoyalty = st.company?.show_royalty ?? summary.royalty_visible;
  const rates = new Set(st.entries.map((e) => e.royalty_rate).filter((r): r is number => r != null));
  const royaltyRate = showRoyalty && rates.size === 1 ? [...rates][0] : null;
  // 振込予定日：ドライバー個別の設定（月・日の両方）があればそれ、無ければ会社設定
  const companyPayout = { payout_month_offset: st.company?.payout_month_offset ?? fallback.payout_month_offset, payout_day: st.company?.payout_day ?? fallback.payout_day };
  const pd = resolvePayoutDate(month, companyPayout, st.driver);
  const note = st.company?.statement_note || fallback.statement_note;
  const companyName = st.company?.name || fallback.companyName;
  const hasAdjustments = st.adjustments.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          {st.company?.has_logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/company-asset/logo" alt="" className="mb-1 max-h-10 w-auto self-start" />
          )}
          <CardTitle className="flex flex-wrap items-center gap-2">
            {formatMonthJa(month)} 支払明細
            <Badge variant="secondary">締め済み</Badge>
          </CardTitle>
          <CardDescription>
            {st.driver?.name ?? ""} 様 ／ {companyName}
            {st.closed_at && <span className="ml-2">（締め日：{formatDateTimeJa(st.closed_at)}）</span>}
          </CardDescription>
          {st.driver?.invoice_reg_no && <p className="text-xs text-muted-foreground">登録番号 {st.driver.invoice_reg_no}</p>}
        </CardHeader>
        <CardContent className="space-y-5">
          {/* お支払額（最上部に強調） */}
          <section className="rounded-lg bg-accent p-4 text-accent-foreground">
            <div className="flex items-center justify-between gap-3">
              <span className="text-base font-semibold">{payoutLabel}</span>
              <Money value={summary.payout_incl} className="text-2xl font-bold md:text-3xl" />
            </div>
            <p className="mt-1 text-sm">
              振込予定日：<span className="num">{formatDateJa(pd.date)}</span>
            </p>
          </section>

          {/* 稼働 */}
          <section>
            <h4 className="mb-1 text-sm font-semibold text-muted-foreground">稼働明細</h4>
            {st.entries.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">この月の稼働はありません。</p>
            ) : (
              <ul className="divide-y">
                {st.entries.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium">{entryTitle(e)}</p>
                      <p className="text-sm text-muted-foreground">
                        <span className="num">
                          {qtyText(e.qty)}
                          {e.unit === "day" ? "日" : "個"}
                        </span>
                        {" × "}
                        <span className="num">{yen(e.pay_rate)}</span>
                      </p>
                      {e.memo && <p className="text-xs text-muted-foreground">{e.memo}</p>}
                    </div>
                    <Money value={e.pay} className="shrink-0 font-medium" />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center justify-between border-t pt-2 font-semibold">
              <span>稼働小計</span>
              <Money value={summary.pay} />
            </div>
          </section>

          {/* 控除 → 小計（税抜）→ 消費税 */}
          <section>
            <h4 className="mb-1 text-sm font-semibold text-muted-foreground">控除</h4>
            <ul className="divide-y">
              <li className="flex items-center justify-between gap-3 py-2">
                <span>
                  ロイヤリティ
                  {royaltyRate != null && (
                    <span className="ml-1 text-sm text-muted-foreground">
                      （<Pct value={royaltyRate} />）
                    </span>
                  )}
                </span>
                <Money value={-summary.royalty} />
              </li>
              {summary.mgmt_fee !== 0 && (
                <li className="flex items-center justify-between gap-3 py-2">
                  <span>管理費</span>
                  <Money value={-summary.mgmt_fee} />
                </li>
              )}
            </ul>
            <dl className="mt-2 space-y-1 border-t pt-2">
              <div className="flex items-center justify-between gap-3 font-semibold">
                <dt>小計（税抜）</dt>
                <dd>
                  <Money value={summary.tax_base} />
                </dd>
              </div>
              {taxable && (
                <div className="flex items-center justify-between gap-3">
                  <dt>{taxLabel}</dt>
                  <dd>
                    <Money value={summary.tax} />
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* 調整（税込） */}
          {hasAdjustments && (
            <section>
              <h4 className="mb-1 text-sm font-semibold text-muted-foreground">調整（税込）</h4>
              <ul className="divide-y">
                {st.adjustments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 break-words">{a.label}</span>
                    <Money value={a.amount} className="shrink-0" />
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between gap-3 border-t pt-2 font-semibold">
                <span>調整 合計</span>
                <Money value={summary.adj_pay} />
              </div>
            </section>
          )}

          {/* お支払額（再掲） */}
          <section>
            <dl className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">小計（税抜）</dt>
                <dd>
                  <Money value={summary.tax_base} />
                </dd>
              </div>
              {taxable && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{taxLabel}</dt>
                  <dd>
                    <Money value={summary.tax} />
                  </dd>
                </div>
              )}
              {hasAdjustments && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">調整（税込）</dt>
                  <dd>
                    <Money value={summary.adj_pay} />
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-3 border-t pt-2 text-base font-semibold">
                <dt>{payoutLabel}</dt>
                <dd>
                  <Money value={summary.payout_incl} />
                </dd>
              </div>
            </dl>
          </section>

          {taxable && <p className="text-xs text-muted-foreground">※ 単価は税抜です。</p>}
          {note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{note}</p>}

          <div className="flex flex-wrap gap-2">
            <a href={exportUrls.statementPdf(month, driverId)} download className={cn(buttonVariants({ variant: "outline" }))}>
              <FileText className="h-4 w-4" />
              PDF をダウンロード
            </a>
          </div>
        </CardContent>
      </Card>

      {/* 発行者（会社情報・認印） */}
      {st.company && (
        <div className="flex items-start gap-3 text-xs text-muted-foreground">
          <div className="min-w-0">
            <p className="flex items-center gap-1 font-medium text-foreground">
              {st.company.name}
              {st.company.has_seal && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/api/company-asset/seal" alt="" className="-ml-0.5 h-8 w-8 shrink-0" />
              )}
            </p>
            {st.company.address && <p>{st.company.address}</p>}
            {st.company.tel && <p>TEL {st.company.tel}</p>}
            {st.company.invoice_reg_no && <p>登録番号 {st.company.invoice_reg_no}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
