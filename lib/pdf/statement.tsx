/**
 * PDF 支払明細（§8.3、A4 縦）。会社利益・単価差額は載せない（ドライバー本人に渡せる内容）
 * サーバー専用（@react-pdf/renderer の Node 版を使う）
 * 消費税（0008）：単価・管理費・ロイヤリティは税抜。控除 → 小計（税抜）→ 消費税 → 調整（税込）→ お支払額（税込）の順に載せる。
 * 金額はすべて StatementData（集計ビューの値）をそのまま表示し、ここでは計算しない。
 * ロゴ・認印は assets（loadStatementAssets の結果）を data URI で Image に渡す。無ければレイアウトは従来どおり。
 */
// Image は PdfImage として読み込む（jsx-a11y/alt-text が Image を <img> と見なして alt を要求するため）
import { Document, Page, Text, View, Image as PdfImage, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { StatementData } from "@/lib/statement";
import { toDataUri, type StatementAssets } from "@/lib/company-assets";
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
  page: { padding: 36, paddingBottom: 46, fontFamily: PDF_FONT_FAMILY, fontSize: 10, color: "#111111" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  headerLeft: { flexGrow: 1, flexShrink: 1, paddingRight: 12 },
  headerRight: { width: 220, flexShrink: 0, textAlign: "right", fontSize: 9, color: GRAY },
  // ロゴ：高さ 40pt 以内・幅は自動（枠は右ブロック幅いっぱいになるので右寄せで描く）
  logo: { maxHeight: 40, objectFit: "contain", objectPositionX: "100%", marginBottom: 4 },
  companyRow: { flexDirection: "row", justifyContent: "flex-end", alignItems: "flex-start" },
  companyInfo: { flexShrink: 1, textAlign: "right" },
  // 認印：会社名の右にやや重ねる
  seal: { width: 44, height: 44, flexShrink: 0, marginLeft: -4, marginTop: -6 },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 6 },
  addressee: { fontSize: 13, marginBottom: 2 },
  regNo: { fontSize: 9, color: GRAY, marginBottom: 2 },
  companyName: { fontSize: 11, fontWeight: 700, color: "#111111", marginBottom: 2 },
  payoutBox: { borderWidth: 1, borderColor: "#111111", borderRadius: 4, padding: 10, marginBottom: 12 },
  payoutRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  payoutLabel: { fontSize: 12, fontWeight: 700 },
  payoutAmount: { fontSize: 22, fontWeight: 700 },
  payoutDate: { fontSize: 9, color: GRAY, marginTop: 4 },
  sectionTitle: { fontSize: 11, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: "#111111", paddingBottom: 3, marginBottom: 4, marginTop: 4 },
  table: { marginBottom: 10 },
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
  taxNote: { fontSize: 8.5, color: GRAY, marginBottom: 10 },
  note: { fontSize: 9, color: "#333333", lineHeight: 1.5 },
  footer: { position: "absolute", left: 36, right: 36, bottom: 24, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: GRAY },
});

export interface StatementPdfProps {
  data: StatementData;
  /** ロイヤリティ率を表示するか（ドライバー本人向けは会社設定 driver_portal_show_royalty に従う） */
  showRoyaltyRate?: boolean;
  /** 会社のロゴ・認印（loadStatementAssets の結果）。無ければ印字しない */
  assets?: StatementAssets;
}

function Amount({ value, bold = false }: { value: number; bold?: boolean }) {
  return <Text style={[styles.num, ...(value < 0 ? [styles.neg] : []), ...(bold ? [{ fontWeight: 700 }] : [])]}>{yen(value)}</Text>;
}

function entryName(e: StatementData["entries"][number]): string {
  return e.itemName && e.itemName !== "標準" ? `${e.projectName}（${e.itemName}）` : e.projectName;
}

/** 項目 / 金額 の 2 列表の 1 行 */
function ItemRow({ label, value, total = false }: { label: string; value: number; total?: boolean }) {
  return (
    <View style={total ? [styles.tr, styles.trTotal] : styles.tr} wrap={false}>
      <Text style={[styles.cell, styles.colItem]}>{label}</Text>
      <View style={[styles.cell, styles.colAmount]}>
        <Amount value={value} bold={total} />
      </View>
    </View>
  );
}

/** 支払明細 PDF ドキュメント */
export function StatementPdf({ data: s, showRoyaltyRate = true, assets }: StatementPdfProps) {
  const taxable = s.taxMode === "taxable";
  const payoutLabel = taxable ? "お支払額（税込）" : "お支払額";
  const taxLabel = `消費税（${s.taxRateLabel}）`;
  const logo = s.company.logo_path && assets?.logo ? toDataUri(assets.logo) : null;
  const seal = s.company.seal_path && assets?.seal ? toDataUri(assets.seal) : null;

  return (
    <Document title={`${s.monthLabel} 支払明細書 ${s.driverName}`} author={s.company.name} language="ja">
      <Page size="A4" style={styles.page}>
        {/* ヘッダー：宛名・タイトル／ロゴ・会社情報・認印 */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>{s.monthLabel} 支払明細書</Text>
            <Text style={styles.addressee}>{s.driverName} 様</Text>
            {s.driverInvoiceRegNo ? <Text style={styles.regNo}>登録番号 {s.driverInvoiceRegNo}</Text> : null}
            <Text style={styles.muted}>下記のとおりお支払いいたします。</Text>
          </View>
          <View style={styles.headerRight}>
            {logo ? <PdfImage src={logo} style={styles.logo} /> : null}
            <View style={styles.companyRow}>
              <View style={styles.companyInfo}>
                <Text style={styles.companyName}>{s.company.name}</Text>
                {s.company.address ? <Text>{s.company.address}</Text> : null}
                {s.company.tel ? <Text>TEL {s.company.tel}</Text> : null}
                {s.company.invoice_reg_no ? <Text>登録番号 {s.company.invoice_reg_no}</Text> : null}
                <Text>発行日 {formatDateJa(s.issuedAt)}</Text>
              </View>
              {seal ? <PdfImage src={seal} style={styles.seal} /> : null}
            </View>
          </View>
        </View>

        {/* お支払額（税込） */}
        <View style={styles.payoutBox}>
          <View style={styles.payoutRow}>
            <Text style={styles.payoutLabel}>{payoutLabel}</Text>
            <Text style={[styles.payoutAmount, ...(s.payoutIncl < 0 ? [styles.neg] : [])]}>{yen(s.payoutIncl)}</Text>
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

        {/* 控除・調整 → 小計（税抜）→ 消費税 → 調整（税込）→ お支払額（税込）：1 つの表にまとめて 1 ページに収める */}
        <Text style={styles.sectionTitle}>控除・調整</Text>
        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]} fixed>
            <Text style={[styles.cell, styles.colItem]}>項目</Text>
            <Text style={[styles.cell, styles.colAmount, styles.num]}>金額</Text>
          </View>
          <ItemRow label="稼働小計" value={s.pay} />
          <ItemRow label={`ロイヤリティ${showRoyaltyRate && s.royaltyRate != null ? `（${pct(s.royaltyRate)}）` : ""}`} value={-s.royalty} />
          {s.mgmtFee !== 0 ? <ItemRow label="管理費" value={-s.mgmtFee} /> : null}
          <ItemRow label="小計（税抜）" value={s.taxBase} total />
          {taxable ? <ItemRow label={taxLabel} value={s.tax} /> : null}
          {s.adjustments.map((a) => (
            <ItemRow key={a.id} label={`調整（税込）：${a.label}`} value={a.amount} />
          ))}
          <ItemRow label={payoutLabel} value={s.payoutIncl} total />
        </View>

        {taxable ? <Text style={styles.taxNote}>※ 単価は税抜です。</Text> : null}

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

/** 明細データから PDF を生成する。assets（ロゴ・認印）は呼び出し側で 1 回読んで渡す（ZIP では全ドライバーで使い回す） */
export async function renderStatementPdf(data: StatementData, opts: { showRoyaltyRate?: boolean; assets?: StatementAssets } = {}): Promise<Buffer> {
  return renderToBuffer(<StatementPdf data={data} showRoyaltyRate={opts.showRoyaltyRate} assets={opts.assets} />);
}
