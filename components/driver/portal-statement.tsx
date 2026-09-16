import { FileText } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Money, Pct } from "@/components/ui/money";
import { yen, qty as qtyText, formatDateTimeJa } from "@/lib/format";
import { formatDateJa, formatMonthJa, payoutDate } from "@/lib/month";
import { exportUrls } from "@/lib/exports/urls";
import { cn } from "@/lib/utils";

/** rpc driver_portal_statement の JSON（0005_portal_seed.sql） */
export interface PortalStatement {
  month: string;
  status: "open" | "closed";
  driver: { id: string; name: string } | null;
  company: {
    name: string;
    address: string;
    tel: string;
    invoice_reg_no: string;
    statement_note: string;
    payout_month_offset: number;
    payout_day: number;
    show_royalty: boolean;
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
  summary: { pay: number; royalty: number; mgmt_fee: number; adj_pay: number; payout: number; royalty_visible: boolean } | null;
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

/** RPC の JSON を安全に型へ変換する（null や欠損に耐える） */
export function parsePortalStatement(json: unknown): PortalStatement | null {
  if (!isObj(json)) return null;
  const status = json.status === "closed" ? "closed" : "open";
  const driver = isObj(json.driver) ? { id: str(json.driver.id), name: str(json.driver.name) } : null;
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
    ? { pay: num(s.pay), royalty: num(s.royalty), mgmt_fee: num(s.mgmt_fee), adj_pay: num(s.adj_pay), payout: num(s.payout), royalty_visible: s.royalty_visible === true }
    : null;
  const adjustments = Array.isArray(json.adjustments) ? json.adjustments.filter(isObj).map((a) => ({ id: str(a.id), label: str(a.label), amount: num(a.amount) })) : [];
  return { month: str(json.month), status, driver, company, entries, summary, adjustments, closed_at: json.closed_at == null ? null : str(json.closed_at) };
}

function entryTitle(e: { project_name: string; item_name: string }) {
  return e.item_name && e.item_name !== "標準" ? `${e.project_name}（${e.item_name}）` : e.project_name;
}

/** ドライバーポータルの明細表示（会社売上・会社利益は含めない） */
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
  const summary = st.summary ?? { pay: 0, royalty: 0, mgmt_fee: 0, adj_pay: 0, payout: 0, royalty_visible: false };
  const showRoyalty = st.company?.show_royalty ?? summary.royalty_visible;
  const rates = new Set(st.entries.map((e) => e.royalty_rate).filter((r): r is number => r != null));
  const royaltyRate = showRoyalty && rates.size === 1 ? [...rates][0] : null;
  const offset = st.company?.payout_month_offset ?? fallback.payout_month_offset;
  const day = st.company?.payout_day ?? fallback.payout_day;
  const pd = payoutDate(month, offset, day);
  const note = st.company?.statement_note || fallback.statement_note;
  const companyName = st.company?.name || fallback.companyName;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {formatMonthJa(month)} 支払明細
            <Badge variant="secondary">締め済み</Badge>
          </CardTitle>
          <CardDescription>
            {st.driver?.name ?? ""} 様 ／ {companyName}
            {st.closed_at && <span className="ml-2">（締め日：{formatDateTimeJa(st.closed_at)}）</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* お支払額（最上部に強調） */}
          <section className="rounded-lg bg-accent p-4 text-accent-foreground">
            <div className="flex items-center justify-between gap-3">
              <span className="text-base font-semibold">お支払額</span>
              <Money value={summary.payout} className="text-2xl font-bold md:text-3xl" />
            </div>
            <p className="mt-1 text-sm">
              振込予定日：<span className="num">{formatDateJa(pd)}</span>
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

          {/* 控除・調整 */}
          <section>
            <h4 className="mb-1 text-sm font-semibold text-muted-foreground">控除・調整</h4>
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
              {st.adjustments.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 break-words">{a.label}</span>
                  <Money value={a.amount} className="shrink-0" />
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between border-t pt-2 font-semibold">
              <span>お支払額</span>
              <Money value={summary.payout} />
            </div>
          </section>

          {note && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{note}</p>}

          <div className="flex flex-wrap gap-2">
            <a href={exportUrls.statementPdf(month, driverId)} download className={cn(buttonVariants({ variant: "outline" }))}>
              <FileText className="h-4 w-4" />
              PDF をダウンロード
            </a>
          </div>
        </CardContent>
      </Card>

      {st.company && (st.company.address || st.company.tel || st.company.invoice_reg_no) && (
        <p className="text-xs text-muted-foreground">
          {st.company.name}
          {st.company.address && ` ／ ${st.company.address}`}
          {st.company.tel && ` ／ TEL ${st.company.tel}`}
          {st.company.invoice_reg_no && ` ／ 登録番号 ${st.company.invoice_reg_no}`}
        </p>
      )}
    </div>
  );
}
