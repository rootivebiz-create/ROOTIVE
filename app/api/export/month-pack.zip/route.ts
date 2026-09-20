/**
 * GET /api/export/month-pack.zip?m=YYYY-MM&parts=statements,invoices,csv,report — その月の「一式」を 1 つの ZIP に
 * owner / admin のみ（ドライバーの支払額・口座情報を含むため）
 *
 * parts を省略すると振込データ以外をすべて含める（振込データは口座情報を含むので明示したときだけ）。
 * ファイルの生成は逐次（ドライバーが多くてもメモリが膨らまないように）。
 * 途中で失敗したファイルは README.txt にエラーとして記録し、残りの処理は続ける。
 */
import type { NextRequest } from "next/server";
import { ADMIN_ROLES } from "@/lib/auth/session";
import type { BankAccountType, DriverMonthSummary, InvoiceListRow } from "@/lib/db/types";
import { monthToDate } from "@/lib/month";
import { translateError } from "@/lib/actions/result";
import { loadStatementData, resolvePayoutDate } from "@/lib/statement";
import { loadInvoiceData } from "@/lib/invoice";
import { loadStatementAssets, type StatementAssets } from "@/lib/company-assets";
import { renderStatementPdf } from "@/lib/pdf/statement";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { loadMonthReportData, renderMonthReportPdf } from "@/lib/pdf/month-report";
import { entriesToCsv, payoutsToCsv } from "@/lib/exports/csv";
import { toExpensesCsv } from "@/lib/exports/expenses-csv";
import { invoicesToCsv } from "@/lib/exports/invoices-csv";
import { toProjectsCsv } from "@/lib/exports/projects-csv";
import { toProjectRow } from "@/components/projects/helpers";
import { buildZenginBytes, missingBankFields, pickTransferDate, toTransferTarget, transferRows, type TransferTarget } from "@/lib/exports/zengin";
import { buildZip, type ZipEntry } from "@/lib/exports/zip";
import { binaryResponse } from "@/lib/exports/download";
import {
  isEmptyParts,
  monthPackEntries,
  monthPackFilename,
  monthPackReadme,
  parseMonthPackParts,
  type MonthPackEntry,
  type MonthPackError,
} from "@/lib/exports/month-pack";
import { canSeeBankAccount } from "@/lib/schemas/drivers";
import { ExportError, fetchAllRows, handleExport, monthParam, requireExportRole } from "../_lib/guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** PDF を何十件も作るため長めに取る（statements.zip と同じ 60 秒。足りなければ vercel.json で延ばす） */
export const maxDuration = 60;

const encoder = new TextEncoder();

/**
 * 振込データ（全銀）に使う列。支払日はドライバーに残り、口座は v_driver_bank（0020）にある。
 * 埋め込みリソースは使えないので別々に読んで JS 側で突き合わせる。
 */
const TRANSFER_DRIVER_COLUMNS = "id, name, payout_month_offset, payout_day";
const TRANSFER_BANK_COLUMNS = "driver_id, bank_code, bank_name, branch_code, branch_name, account_type, account_number, account_holder_kana";
type TransferDriverRow = {
  id: string;
  name: string;
  payout_month_offset: number | null;
  payout_day: number | null;
};
type TransferBankRow = {
  driver_id: string;
  bank_code: string;
  bank_name: string;
  branch_code: string;
  branch_name: string;
  account_type: BankAccountType | null;
  account_number: string;
  account_holder_kana: string;
};

export const GET = handleExport(async (req: NextRequest) => {
  const { supabase, company, profile } = await requireExportRole(ADMIN_ROLES);
  const month = monthParam(req);
  const parts = parseMonthPackParts(req.nextUrl.searchParams.get("parts"));
  if (isEmptyParts(parts)) throw new ExportError(400, "含める出力を 1 つ以上選んでください。");
  if (parts.transfer && !canSeeBankAccount(company.confidential_scope, profile.role)) {
    throw new ExportError(403, "振込先の口座を見る権限がありません。");
  }

  // ---- ZIP に入れるファイルの一覧を先に決める --------------------------------
  const [summaries, invoiceRows, closingRes] = await Promise.all([
    parts.statements || parts.csv || parts.transfer
      ? fetchAllRows<DriverMonthSummary>((from, to) =>
          supabase
            .from("v_driver_month_summary")
            .select("*")
            .eq("company_id", company.id)
            .eq("month", monthToDate(month))
            .order("driver_sort_order")
            .order("driver_name")
            .range(from, to),
        )
      : Promise.resolve([] as DriverMonthSummary[]),
    parts.invoices
      ? fetchAllRows<InvoiceListRow>((from, to) =>
          supabase
            .from("v_invoice_list")
            .select("*")
            .eq("company_id", company.id)
            .eq("month", monthToDate(month))
            .order("client_sort_order")
            .order("invoice_no")
            .range(from, to),
        )
      : Promise.resolve([] as InvoiceListRow[]),
    supabase.from("month_closings").select("status").eq("company_id", company.id).eq("month", monthToDate(month)).maybeSingle(),
  ]);
  if (closingRes.error) throw closingRes.error;

  const drivers = summaries
    .filter((s): s is DriverMonthSummary & { driver_id: string } => Boolean(s.driver_id))
    .map((s) => ({ id: s.driver_id, name: s.driver_name ?? "" }));
  const invoices = invoiceRows
    .filter((r): r is InvoiceListRow & { id: string } => Boolean(r.id))
    .map((r) => ({ id: r.id, invoiceNo: r.invoice_no, clientName: r.client_name }));

  // 振込データを含めるときだけ口座情報を読む
  const driverPayout = new Map<string, TransferDriverRow>();
  const driverBank = new Map<string, TransferBankRow>();
  if (parts.transfer) {
    const [driverRes, bankRes] = await Promise.all([
      supabase.from("drivers").select(TRANSFER_DRIVER_COLUMNS).eq("company_id", company.id),
      supabase.from("v_driver_bank").select(TRANSFER_BANK_COLUMNS).eq("company_id", company.id),
    ]);
    if (driverRes.error) throw driverRes.error;
    if (bankRes.error) throw bankRes.error;
    for (const d of (driverRes.data ?? []) as TransferDriverRow[]) driverPayout.set(d.id, d);
    for (const b of (bankRes.data ?? []) as TransferBankRow[]) driverBank.set(b.driver_id, b);
  }

  const planned = monthPackEntries({ month, parts, drivers, invoices });

  // ---- 1 件ずつ作る（失敗しても README に残して続ける） ----------------------
  const zipEntries: ZipEntry[] = [];
  const done: MonthPackEntry[] = [];
  const errors: MonthPackError[] = [];
  const mtime = new Date();
  let assets: StatementAssets | null = null;

  for (const entry of planned) {
    if (entry.kind === "readme") continue; // README は最後に作る
    try {
      const data = await buildFile(entry);
      if (data == null) continue;
      zipEntries.push({ name: entry.name, data, mtime });
      done.push(entry);
    } catch (e) {
      errors.push({ name: entry.name, message: translateError(e) });
    }
  }

  const readme = planned[planned.length - 1];
  const readmeText = monthPackReadme({
    companyName: company.name,
    month,
    closed: closingRes.data?.status === "closed",
    entries: [...done, readme],
    errors,
    generatedAt: mtime,
  });
  zipEntries.push({ name: readme.name, data: encoder.encode(readmeText), mtime });

  return binaryResponse(monthPackFilename(month), buildZip(zipEntries, { now: mtime }), "application/zip");

  // -------------------------------------------------------------------------
  // 種類ごとのファイル生成
  // -------------------------------------------------------------------------
  async function buildFile(entry: MonthPackEntry): Promise<Uint8Array | null> {
    switch (entry.kind) {
      case "statement": {
        if (!entry.id) return null;
        if (!assets) assets = await loadStatementAssets(company);
        const data = await loadStatementData(supabase, company, month, entry.id);
        if (!data) throw new ExportError(404, "ドライバーが見つかりません。");
        return await renderStatementPdf(data, { showRoyaltyRate: true, assets });
      }
      case "invoice": {
        if (!entry.id) return null;
        if (!assets) assets = await loadStatementAssets(company);
        const data = await loadInvoiceData(supabase, company.id, entry.id);
        if (!data) throw new ExportError(404, "請求書が見つかりません。");
        return await renderInvoicePdf(data, { assets });
      }
      case "csv":
        return encoder.encode(await buildCsv(entry.label));
      case "transfer":
        return buildTransferBytes();
      case "report": {
        const data = await loadMonthReportData(supabase, company, month, mtime);
        return await renderMonthReportPdf(data);
      }
      default:
        return null;
    }
  }

  /** CSV は既存の出力と同じ関数で作る（見出し・並び・数値の書き方をそろえる） */
  async function buildCsv(name: string): Promise<string> {
    switch (name) {
      case "稼働明細": {
        const rows = await fetchAllRows((from, to) =>
          supabase
            .from("v_work_entry_calc")
            .select("*")
            .eq("company_id", company.id)
            .eq("month", monthToDate(month))
            .order("driver_sort_order")
            .order("driver_name")
            .order("created_at")
            .order("id")
            .range(from, to),
        );
        return entriesToCsv(rows);
      }
      case "支払一覧":
        return payoutsToCsv(summaries);
      case "経費": {
        const rows = await fetchAllRows((from, to) =>
          supabase
            .from("v_expense_list")
            .select("*")
            .eq("company_id", company.id)
            .eq("month", monthToDate(month))
            .order("category_sort_order")
            .order("created_at")
            .order("id")
            .range(from, to),
        );
        return toExpensesCsv(rows);
      }
      case "請求書一覧": {
        const rows = await fetchAllRows((from, to) =>
          supabase
            .from("v_invoice_list")
            .select("*")
            .eq("company_id", company.id)
            .eq("month", monthToDate(month))
            .order("client_sort_order")
            .order("invoice_no")
            .range(from, to),
        );
        return invoicesToCsv(rows);
      }
      case "案件別採算": {
        const rows = await fetchAllRows((from, to) =>
          supabase
            .from("v_project_pl")
            .select("*")
            .eq("company_id", company.id)
            .eq("month", monthToDate(month))
            .order("project_sort_order")
            .order("project_name")
            .range(from, to),
        );
        return toProjectsCsv(rows.map(toProjectRow));
      }
      default:
        throw new ExportError(400, `${name} の CSV は作れません。`);
    }
  }

  /**
   * 振込データ（全銀フォーマット・Shift_JIS・120 バイト固定長）。
   * 会社の振込元情報や口座が足りないときは日本語の例外を投げ、README にエラーとして残す。
   */
  function buildTransferBytes(): Uint8Array {
    const targets: TransferTarget[] = summaries
      .filter((s) => s.driver_id && Number(s.payout_incl ?? 0) > 0)
      .map((s) => {
        const d = driverPayout.get(s.driver_id ?? "");
        const b = driverBank.get(s.driver_id ?? "");
        const { date } = resolvePayoutDate(month, company, d ? { payout_month_offset: d.payout_month_offset, payout_day: d.payout_day } : null);
        return toTransferTarget(
          {
            driverId: s.driver_id ?? "",
            driverName: s.driver_name ?? d?.name ?? "",
            bankCode: b?.bank_code ?? null,
            bankName: b?.bank_name ?? null,
            branchCode: b?.branch_code ?? null,
            branchName: b?.branch_name ?? null,
            accountType: b?.account_type ?? null,
            accountNumber: b?.account_number ?? null,
            holderKana: b?.account_holder_kana ?? null,
          },
          Number(s.payout_incl ?? 0),
          date,
        );
      });

    const companyMissing = [
      ...((company.fb_consignor_code ?? "").trim() ? [] : ["委託者コード"]),
      ...((company.fb_consignor_kana ?? "").trim() ? [] : ["委託者名（カナ）"]),
      ...missingBankFields({
        bankCode: company.fb_bank_code ?? null,
        bankName: company.fb_bank_name ?? null,
        branchCode: company.fb_branch_code ?? null,
        branchName: company.fb_branch_name ?? null,
        accountType: company.fb_account_type ?? null,
        accountNumber: company.fb_account_number ?? null,
        holderKana: company.fb_consignor_kana ?? null,
      }).filter((m) => m !== "口座名義（カナ）"),
    ];
    if (companyMissing.length > 0) {
      throw new ExportError(400, `振込元の情報が足りません（${companyMissing.join("・")}）。会社設定の「振込元口座」を登録してください。`);
    }

    const rows = transferRows(targets);
    if (rows.length === 0) {
      throw new ExportError(
        400,
        targets.length === 0 ? "この月に振込対象のドライバーがいません。" : "口座情報が登録されているドライバーがいません。ドライバー設定で口座を登録してください。",
      );
    }
    const transferDate = pickTransferDate(targets);
    if (!transferDate) throw new ExportError(400, "取組日を決められませんでした。");

    return buildZenginBytes({
      consignorCode: company.fb_consignor_code ?? "",
      consignorKana: company.fb_consignor_kana ?? "",
      bank: {
        bankCode: company.fb_bank_code ?? "",
        bankName: company.fb_bank_name ?? "",
        branchCode: company.fb_branch_code ?? "",
        branchName: company.fb_branch_name ?? "",
        accountType: company.fb_account_type ?? null,
        accountNumber: company.fb_account_number ?? "",
      },
      transferDate,
      rows,
    });
  }
});
