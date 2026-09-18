/**
 * PDF 請求書（A4 縦）。取引先へ渡す内容（支払単価・会社利益は載せない）
 * サーバー専用（@react-pdf/renderer の Node 版を使う）
 * 金額はすべて InvoiceData（DB が計算した値）をそのまま表示し、ここでは計算しない。
 * ロゴ・認印は assets（loadStatementAssets の結果）を data URI で Image に渡す（PDF 支払明細と同じやり方）。
 */
// Image は PdfImage として読み込む（jsx-a11y/alt-text が Image を <img> と見なして alt を要求するため）
import { Document, Page, Text, View, Image as PdfImage, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { itemUnitLabel, type InvoiceData } from "@/lib/invoice";
import { toDataUri, type StatementAssets } from "@/lib/company-assets";
import { yen, qty as qtyText } from "@/lib/format";
import { ensurePdfFonts, PDF_FONT_FAMILY } from "./fonts";

// モジュール初期化時に 1 回だけフォントを登録する
ensurePdfFonts();

const GRAY = "#555555";
const LINE = "#bbbbbb";
const HEAD_BG = "#eeeeee";
const RED = "#b42318";

const styles = StyleSheet.create({
  // 注意：Page に lineHeight を付けると position:absolute の fixed 要素（フッター）が描画されない（react-pdf 4.9 の挙動）
  page: { padding: 36, paddingBottom: 46, fontFamily: PDF_FONT_FAMILY, fontSize: 10, color: "#111111" },
  topRight: { alignItems: "flex-end", fontSize: 9, color: GRAY },
  title: { fontSize: 20, fontWeight: 700, textAlign: "center", letterSpacing: 4, marginTop: 4, marginBottom: 14 },
  addressee: { fontSize: 15, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: "#111111", paddingBottom: 3, alignSelf: "flex-start", minWidth: 200 },
  addresseeSub: { fontSize: 9, color: GRAY, marginTop: 3 },
  lead: { fontSize: 9.5, color: "#333333", marginTop: 8 },
  totalBox: { borderWidth: 1, borderColor: "#111111", borderRadius: 4, padding: 10, marginTop: 10, marginBottom: 10 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  totalLabel: { fontSize: 12, fontWeight: 700 },
  totalAmount: { fontSize: 22, fontWeight: 700 },
  metaRow: { flexDirection: "row", justifyContent: "flex-start", gap: 16, marginBottom: 12, fontSize: 9, color: GRAY },
  sectionTitle: { fontSize: 11, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: "#111111", paddingBottom: 3, marginBottom: 4, marginTop: 4 },
  table: { marginBottom: 8 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4, alignItems: "flex-start" },
  trHead: { backgroundColor: HEAD_BG, borderBottomWidth: 1, borderBottomColor: "#888888", color: "#333333", fontSize: 9 },
  trTotal: { borderBottomWidth: 1, borderBottomColor: "#111111", fontWeight: 700 },
  cell: { paddingHorizontal: 4 },
  num: { textAlign: "right" },
  neg: { color: RED },
  colName: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  colQty: { width: 54, flexShrink: 0 },
  colUnit: { width: 30, flexShrink: 0, textAlign: "center" },
  colRate: { width: 78, flexShrink: 0 },
  colAmount: { width: 88, flexShrink: 0 },
  sumBox: { alignSelf: "flex-end", width: 240, marginBottom: 10 },
  sumRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 3 },
  sumRowTotal: { borderBottomWidth: 1, borderBottomColor: "#111111", fontWeight: 700 },
  muted: { color: GRAY, fontSize: 9 },
  note: { fontSize: 9, color: "#333333", lineHeight: 1.5 },
  issuer: { flexDirection: "row", justifyContent: "flex-end", marginTop: 14 },
  issuerBlock: { width: 260, alignItems: "flex-end" },
  // ロゴ：高さ 40pt 以内・幅は自動（右寄せで描く）
  logo: { maxHeight: 40, objectFit: "contain", objectPositionX: "100%", marginBottom: 4 },
  companyRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-start", width: "100%" },
  companyInfo: { flexGrow: 1, flexShrink: 1, flexBasis: 0, textAlign: "right", fontSize: 9, color: GRAY },
  companyName: { fontSize: 11, fontWeight: 700, color: "#111111", marginBottom: 2 },
  // 認印：会社情報の右にやや重ねる
  seal: { width: 44, height: 44, flexShrink: 0, marginLeft: 2, marginTop: -6 },
  footer: { position: "absolute", left: 36, right: 36, bottom: 24, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: GRAY },
});

export interface InvoicePdfProps {
  data: InvoiceData;
  /** 会社のロゴ・認印（loadStatementAssets の結果）。無ければ印字しない */
  assets?: StatementAssets;
}

function Amount({ value, bold = false }: { value: number; bold?: boolean }) {
  return <Text style={[styles.num, ...(value < 0 ? [styles.neg] : []), ...(bold ? [{ fontWeight: 700 }] : [])]}>{yen(value)}</Text>;
}

/** 小計・消費税・合計の 1 行 */
function SumRow({ label, value, total = false }: { label: string; value: number; total?: boolean }) {
  return (
    <View style={total ? [styles.sumRow, styles.sumRowTotal] : styles.sumRow} wrap={false}>
      <Text>{label}</Text>
      <Amount value={value} bold={total} />
    </View>
  );
}

/** 請求書 PDF ドキュメント */
export function InvoicePdf({ data: d, assets }: InvoicePdfProps) {
  const logo = d.company.logoPath && assets?.logo ? toDataUri(assets.logo) : null;
  const seal = d.company.sealPath && assets?.seal ? toDataUri(assets.seal) : null;
  const taxLabel = `消費税（${d.taxRateLabel}）`;

  return (
    <Document title={`請求書 ${d.invoiceNo} ${d.client.name}`} author={d.company.name} language="ja">
      <Page size="A4" style={styles.page}>
        {/* 右上：請求書番号・発行日 */}
        <View style={styles.topRight}>
          <Text>請求書番号 {d.invoiceNo}</Text>
          <Text>発行日 {d.issueDateLabel}</Text>
        </View>

        {/* 中央：タイトル */}
        <Text style={styles.title}>請求書</Text>

        {/* 左：宛名 */}
        <View>
          <Text style={styles.addressee}>
            {d.client.name} {d.client.honorific}
          </Text>
          {d.client.address ? <Text style={styles.addresseeSub}>{d.client.address}</Text> : null}
          {d.client.invoiceRegNo ? <Text style={styles.addresseeSub}>登録番号 {d.client.invoiceRegNo}</Text> : null}
          <Text style={styles.lead}>下記のとおりご請求申し上げます。</Text>
        </View>

        {/* ご請求金額（税込） */}
        <View style={styles.totalBox}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>ご請求金額（税込）</Text>
            <Text style={[styles.totalAmount, ...(d.total < 0 ? [styles.neg] : [])]}>{yen(d.total)}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <Text>対象月：{d.monthLabel}</Text>
          {d.dueDateLabel ? <Text>お支払い期限：{d.dueDateLabel}</Text> : null}
        </View>

        {/* 明細 */}
        <Text style={styles.sectionTitle}>ご請求明細</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]} fixed>
            <Text style={[styles.cell, styles.colName]}>内容</Text>
            <Text style={[styles.cell, styles.colQty, styles.num]}>数量</Text>
            <Text style={[styles.cell, styles.colUnit]}>単位</Text>
            <Text style={[styles.cell, styles.colRate, styles.num]}>単価</Text>
            <Text style={[styles.cell, styles.colAmount, styles.num]}>金額</Text>
          </View>
          {d.items.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.cell, styles.colName, styles.muted]}>明細はありません</Text>
            </View>
          ) : (
            d.items.map((it) => (
              <View key={it.id} style={styles.tr} wrap={false}>
                <Text style={[styles.cell, styles.colName]}>{it.name}</Text>
                <Text style={[styles.cell, styles.colQty, styles.num]}>{qtyText(it.qty)}</Text>
                <Text style={[styles.cell, styles.colUnit]}>{itemUnitLabel(it.unit)}</Text>
                <Text style={[styles.cell, styles.colRate, styles.num]}>{yen(it.unitPrice)}</Text>
                <View style={[styles.cell, styles.colAmount]}>
                  <Amount value={it.amount} />
                </View>
              </View>
            ))
          )}
        </View>

        {/* 小計・消費税・合計 */}
        <View style={styles.sumBox}>
          <SumRow label="小計（税抜）" value={d.subtotal} />
          <SumRow label={taxLabel} value={d.tax} />
          <SumRow label="合計（税込）" value={d.total} total />
        </View>

        {/* 備考（振込先など） */}
        {d.note ? (
          <View wrap={false}>
            <Text style={styles.sectionTitle}>備考</Text>
            <Text style={styles.note}>{d.note}</Text>
          </View>
        ) : null}

        {/* 右下：ロゴ・自社情報・認印 */}
        <View style={styles.issuer} wrap={false}>
          <View style={styles.issuerBlock}>
            {logo ? <PdfImage src={logo} style={styles.logo} /> : null}
            <View style={styles.companyRow}>
              <View style={styles.companyInfo}>
                <Text style={styles.companyName}>{d.company.name}</Text>
                {d.company.address ? <Text>{d.company.address}</Text> : null}
                {d.company.tel ? <Text>TEL {d.company.tel}</Text> : null}
                {d.company.invoiceRegNo ? <Text>登録番号 {d.company.invoiceRegNo}</Text> : null}
              </View>
              {seal ? <PdfImage src={seal} style={styles.seal} /> : null}
            </View>
          </View>
        </View>

        {/* フッター：会社名・請求書番号・ページ番号 */}
        <View style={styles.footer} fixed>
          <Text>
            {d.company.name} / 請求書 {d.invoiceNo} / {d.client.name} {d.client.honorific}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** 請求書データから PDF を生成する。assets（ロゴ・認印）は呼び出し側で読んで渡す */
export async function renderInvoicePdf(data: InvoiceData, opts: { assets?: StatementAssets } = {}): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf data={data} assets={opts.assets} />);
}
