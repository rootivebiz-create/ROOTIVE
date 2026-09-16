/**
 * PDF 支払明細（§8.3、A4 縦）。会社利益・単価差額は載せない（ドライバー本人に渡せる内容）
 * サーバー専用（@react-pdf/renderer の Node 版を使う）
 */
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { StatementData } from "@/lib/statement";
import { yen, pct, qty as qtyText } from "@/lib/format";
import { formatDateJa } from "@/lib/month";
import { ensurePdfFonts, PDF_FONT_FAMILY } from "./fonts";

// モジュール初期化時に 1 回だけフォントを登録する
ensurePdfFonts();

const GRAY = "#555555";
const LINE = "#bbbbbb";
const HEAD_BG = "#eeeeee";
const RED = "#b42318";

const styles = StyleSheet.create({
  // 注意：Page に lineHeight を付けると position:absolute の fixed 要素（フッター）が描画されない（react-pdf 4.9 の挙動）
  page: { padding: 36, paddingBottom: 54, fontFamily: PDF_FONT_FAMILY, fontSize: 10, color: "#111111" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  headerLeft: { flexGrow: 1, flexShrink: 1, paddingRight: 12 },
  headerRight: { width: 220, flexShrink: 0, textAlign: "right", fontSize: 9, color: GRAY },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 6 },
  addressee: { fontSize: 13, marginBottom: 2 },
  companyName: { fontSize: 11, fontWeight: 700, color: "#111111", marginBottom: 2 },
  payoutBox: { borderWidth: 1, borderColor: "#111111", borderRadius: 4, padding: 10, marginBottom: 16 },
  payoutRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  payoutLabel: { fontSize: 12, fontWeight: 700 },
  payoutAmount: { fontSize: 22, fontWeight: 700 },
  payoutDate: { fontSize: 9, color: GRAY, marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: "#111111", paddingBottom: 3, marginBottom: 4, marginTop: 4 },
  table: { marginBottom: 14 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4, alignItems: "flex-start" },
  trHead: { backgroundColor: HEAD_BG, borderBottomWidth: 1, borderBottomColor: "#888888", color: "#333333", fontSize: 9 },
  trTotal: { borderBottomWidth: 1, borderBottomColor: "#111111", fontWeight: 700 },
  cell: { paddingHorizontal: 4 },
  num: { textAlign: "right" },
  neg: { color: RED },
  colName: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  colQty: { width: 68, flexShrink: 0 },
  colRate: { width: 78, flexShrink: 0 },
  colAmount: { width: 88, flexShrink: 0 },
  colMemo: { width: 120, flexShrink: 0, fontSize: 8.5, color: GRAY },
  colItem: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  muted: { color: GRAY, fontSize: 9 },
  summaryBox: { marginTop: 2, marginBottom: 14, alignSelf: "flex-end", width: 260 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: LINE },
  summaryTotal: { borderTopWidth: 1, borderTopColor: "#111111", borderBottomWidth: 0, marginTop: 2, paddingTop: 5, fontWeight: 700, fontSize: 12 },
  note: { fontSize: 9, color: "#333333", lineHeight: 1.5 },
  footer: { position: "absolute", left: 36, right: 36, bottom: 24, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: GRAY },
});

export interface StatementPdfProps {
  data: StatementData;
  /** ロイヤリティ率を表示するか（ドライバー本人向けは会社設定 driver_portal_show_royalty に従う） */
  showRoyaltyRate?: boolean;
}

function Amount({ value, bold = false }: { value: number; bold?: boolean }) {
  return <Text style={[styles.num, ...(value < 0 ? [styles.neg] : []), ...(bold ? [{ fontWeight: 700 }] : [])]}>{yen(value)}</Text>;
}

function entryName(e: StatementData["entries"][number]): string {
  return e.itemName && e.itemName !== "標準" ? `${e.projectName}（${e.itemName}）` : e.projectName;
}

/** 支払明細 PDF ドキュメント */
export function StatementPdf({ data: s, showRoyaltyRate = true }: StatementPdfProps) {
  const deductionTotal = -s.royalty - s.mgmtFee + s.adjPay;
  return (
    <Document title={`${s.monthLabel} 支払明細書 ${s.driverName}`} author={s.company.name} language="ja">
      <Page size="A4" style={styles.page}>
        {/* ヘッダー：宛名・タイトル／会社情報 */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>{s.monthLabel} 支払明細書</Text>
            <Text style={styles.addressee}>{s.driverName} 様</Text>
            <Text style={styles.muted}>下記のとおりお支払いいたします。</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.companyName}>{s.company.name}</Text>
            {s.company.address ? <Text>{s.company.address}</Text> : null}
            {s.company.tel ? <Text>TEL {s.company.tel}</Text> : null}
            {s.company.invoice_reg_no ? <Text>登録番号 {s.company.invoice_reg_no}</Text> : null}
            <Text>発行日 {formatDateJa(s.issuedAt)}</Text>
          </View>
        </View>

        {/* お支払額 */}
        <View style={styles.payoutBox}>
          <View style={styles.payoutRow}>
            <Text style={styles.payoutLabel}>お支払額</Text>
            <Text style={[styles.payoutAmount, ...(s.payout < 0 ? [styles.neg] : [])]}>{yen(s.payout)}</Text>
          </View>
          <Text style={styles.payoutDate}>振込予定日：{s.payoutDateLabel}</Text>
        </View>

        {/* 稼働明細 */}
        <Text style={styles.sectionTitle}>稼働明細</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]} fixed>
            <Text style={[styles.cell, styles.colName]}>案件（内容）</Text>
            <Text style={[styles.cell, styles.colQty, styles.num]}>数量</Text>
            <Text style={[styles.cell, styles.colRate, styles.num]}>単価</Text>
            <Text style={[styles.cell, styles.colAmount, styles.num]}>金額</Text>
            <Text style={[styles.cell, styles.colMemo]}>備考</Text>
          </View>
          {s.entries.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.cell, styles.colName, styles.muted]}>稼働はありません</Text>
            </View>
          ) : (
            s.entries.map((e) => (
              <View key={e.id} style={styles.tr} wrap={false}>
                <Text style={[styles.cell, styles.colName]}>{entryName(e)}</Text>
                <Text style={[styles.cell, styles.colQty, styles.num]}>
                  {qtyText(e.qty)} {e.unit === "day" ? "日" : "個"}
                </Text>
                <Text style={[styles.cell, styles.colRate, styles.num]}>{yen(e.payRate)}</Text>
                <View style={[styles.cell, styles.colAmount]}>
                  <Amount value={e.pay} />
                </View>
                <Text style={[styles.cell, styles.colMemo]}>{e.memo}</Text>
              </View>
            ))
          )}
          <View style={[styles.tr, styles.trTotal]} wrap={false}>
            <Text style={[styles.cell, styles.colName]}>稼働小計</Text>
            <Text style={[styles.cell, styles.colQty]} />
            <Text style={[styles.cell, styles.colRate]} />
            <View style={[styles.cell, styles.colAmount]}>
              <Amount value={s.pay} bold />
            </View>
            <Text style={[styles.cell, styles.colMemo]} />
          </View>
        </View>

        {/* 控除・調整 */}
        <Text style={styles.sectionTitle}>控除・調整</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]} fixed>
            <Text style={[styles.cell, styles.colItem]}>項目</Text>
            <Text style={[styles.cell, styles.colAmount, styles.num]}>金額</Text>
          </View>
          <View style={styles.tr} wrap={false}>
            <Text style={[styles.cell, styles.colItem]}>ロイヤリティ{showRoyaltyRate && s.royaltyRate != null ? `（${pct(s.royaltyRate)}）` : ""}</Text>
            <View style={[styles.cell, styles.colAmount]}>
              <Amount value={-s.royalty} />
            </View>
          </View>
          {s.mgmtFee !== 0 ? (
            <View style={styles.tr} wrap={false}>
              <Text style={[styles.cell, styles.colItem]}>管理費</Text>
              <View style={[styles.cell, styles.colAmount]}>
                <Amount value={-s.mgmtFee} />
              </View>
            </View>
          ) : null}
          {s.adjustments.map((a) => (
            <View key={a.id} style={styles.tr} wrap={false}>
              <Text style={[styles.cell, styles.colItem]}>{a.label}</Text>
              <View style={[styles.cell, styles.colAmount]}>
                <Amount value={a.amount} />
              </View>
            </View>
          ))}
          <View style={[styles.tr, styles.trTotal]} wrap={false}>
            <Text style={[styles.cell, styles.colItem]}>控除・調整 合計</Text>
            <View style={[styles.cell, styles.colAmount]}>
              <Amount value={deductionTotal} bold />
            </View>
          </View>
        </View>

        {/* お支払額（再掲） */}
        <View style={styles.summaryBox} wrap={false}>
          <View style={styles.summaryRow}>
            <Text>稼働小計</Text>
            <Amount value={s.pay} />
          </View>
          <View style={styles.summaryRow}>
            <Text>控除・調整</Text>
            <Amount value={deductionTotal} />
          </View>
          <View style={[styles.summaryRow, styles.summaryTotal]}>
            <Text>お支払額</Text>
            <Amount value={s.payout} bold />
          </View>
        </View>

        {/* 備考 */}
        {s.company.statement_note ? (
          <View wrap={false}>
            <Text style={styles.sectionTitle}>備考</Text>
            <Text style={styles.note}>{s.company.statement_note}</Text>
          </View>
        ) : null}

        {/* フッター：会社名・ページ番号 */}
        <View style={styles.footer} fixed>
          <Text>
            {s.company.name} / {s.monthLabel} 支払明細書 / {s.driverName} 様
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** PDF ファイル名：支払明細_2026-09_{ドライバー名}.pdf */
export function statementPdfFilename(s: Pick<StatementData, "month" | "driverName">): string {
  return `支払明細_${s.month}_${s.driverName}.pdf`;
}

/** 明細データから PDF を生成する */
export async function renderStatementPdf(data: StatementData, opts: { showRoyaltyRate?: boolean } = {}): Promise<Buffer> {
  return renderToBuffer(<StatementPdf data={data} showRoyaltyRate={opts.showRoyaltyRate} />);
}
