import { getDb } from "~/db/client";
import { audit } from "~/server/audit";
import { AuthError, requireUser } from "~/server/auth";
import { csvText, fileResponse, utf8WithBom, type CsvCell } from "~/server/download";
import { loadReport, reportRange } from "~/server/features/reconcile";
import { KIND_LABEL, STATUS_LABEL } from "~/server/features/reconcile/labels";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const dynamic = "force-dynamic";

/**
 * 文字の欄が「=」「+」「-」「@」などで始まると、Excel が式として動かしてしまう。
 * 品目の名前は元請のファイルから来るので、先頭に「'」を付けて文字として開かせる（数の欄はそのまま）
 */
function safeText(value: string | null | undefined): string {
  const v = value ?? "";
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

const dateCell = (d: Date | null) => (d ? d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : "");

/** 突合の差の一覧（CSV・UTF-8 BOM 付き）。?from=YYYY-MM&to=YYYY-MM（12 か月まで） */
export async function GET(request: Request): Promise<Response> {
  let user;
  try {
    user = await requireUser("viewer");
  } catch (error) {
    if (error instanceof AuthError) return new Response(error.message, { status: 403 });
    throw error;
  }
  const url = new URL(request.url);
  const { from, to } = reportRange(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined, monthFromParam(undefined));
  const db = await getDb();
  const report = await loadReport(db, user.tenantId, from, to);

  const rows: CsvCell[][] = [
    [
      "元請",
      "月",
      "種類",
      "内容",
      "当社の数量",
      "当社の単価",
      "当社の金額",
      "お支払通知の数量",
      "お支払通知の単価",
      "お支払通知の金額",
      "差（お支払通知−当社）",
      "扱い",
      "問い合わせた日",
      "片付けた日",
      "取り戻せた額",
      "メモ",
    ],
  ];
  let count = 0;
  for (const c of report.cells) {
    if (!c.notice) {
      rows.push([safeText(c.clientName), monthLabelJa(c.month), "お支払通知なし", "", "", "", c.ourTotal, "", "", "", "", "", "", "", "", ""]);
      continue;
    }
    for (const it of c.items) {
      count++;
      rows.push([
        safeText(c.clientName),
        monthLabelJa(c.month),
        KIND_LABEL[it.kind] + (it.split ? "（分けて計算）" : ""),
        safeText(it.label),
        it.ourQty,
        it.ourPrice,
        it.ourAmount,
        it.theirQty,
        it.theirPrice,
        it.theirAmount,
        it.diff,
        STATUS_LABEL[it.status],
        it.status === "open" ? "" : dateCell(it.askedAt),
        it.status === "resolved" || it.status === "accepted" ? dateCell(it.resolvedAt) : "",
        it.status === "resolved" ? it.recoveredAmount : null,
        safeText(it.note),
      ]);
    }
  }
  await audit(db, { tenantId: user.tenantId, userId: user.id, action: "export.reconcile_items", entity: "report", entityId: `${from}..${to}`, detail: { from, to, items: count } });
  const name = from === to ? `突合_${monthParam(from)}.csv` : `突合_${monthParam(from)}_${monthParam(to)}.csv`;
  return fileResponse(utf8WithBom(csvText(rows)), name, "text/csv; charset=utf-8");
}
