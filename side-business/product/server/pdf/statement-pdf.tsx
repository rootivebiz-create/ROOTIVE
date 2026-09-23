/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { en } from "@/lib/engine/types";
import { jpDate } from "@/lib/format";
import type { PdfSource } from "~/server/features/statements";
import {
  jpDateTime,
  jpDateWithWeekday,
  jpMonthLabel,
  qtyText,
  summaryRows,
  taxBreakdown,
  totalNote,
  unitPriceText,
  type DriverStatementView,
} from "~/server/features/statements/view";
import { PDF_FONT, registerPdfFonts } from "~/server/pdf/fonts";

/**
 * 支払明細の PDF（A4・1 人ずつ改ページ）。中身は画面と同じ DriverStatementView と summaryRows だけから作る。
 * 会社の利益・売上・受注の単価は載せない（その項目を持たない形から作るので、載せようがない）。
 */

const INK = "#16171a";
const MUTED = "#5c5f66";
const LINE = "#c9c9c2";
const SOFT = "#f3f3ef";

const st = StyleSheet.create({
  page: { fontFamily: PDF_FONT, fontSize: 9, color: INK, paddingTop: 32, paddingBottom: 44, paddingHorizontal: 36, lineHeight: 1.45 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  // 大きい文字は行の高さを明示する（ページの行の高さがそのまま引き継がれて、次の行と重なるため）
  title: { fontSize: 17, fontWeight: 700, lineHeight: 1.3 },
  small: { fontSize: 8, color: MUTED },
  parties: { flexDirection: "row", marginTop: 12, gap: 16 },
  party: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8 },
  partyName: { fontSize: 12, fontWeight: 700, lineHeight: 1.3 },
  meta: { flexDirection: "row", marginTop: 10, gap: 16 },
  metaItem: { flex: 1 },
  totalBox: { marginTop: 12, backgroundColor: SOFT, borderRadius: 4, padding: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  totalLabel: { fontSize: 11, fontWeight: 700, lineHeight: 1.3 },
  totalValue: { fontSize: 20, fontWeight: 700, lineHeight: 1.3 },
  h2: { fontSize: 10.5, fontWeight: 700, marginTop: 14, marginBottom: 4, lineHeight: 1.3 },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 3.5 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 3 },
  th: { fontWeight: 700, fontSize: 8.5 },
  cName: { flex: 3.2, paddingRight: 4 },
  cQty: { flex: 1.1, textAlign: "right" },
  cUnit: { flex: 0.8, textAlign: "center" },
  cRate: { flex: 1.3, textAlign: "right" },
  cAmount: { flex: 1.5, textAlign: "right" },
  cHow: { flex: 3.2, paddingRight: 4, color: MUTED, fontSize: 8 },
  cTag: { flex: 1.3, fontSize: 8 },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.6, borderBottomColor: LINE },
  sumTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderTopWidth: 1.2, borderTopColor: INK, marginTop: 2 },
  note: { marginTop: 12, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8, fontSize: 8.5 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

function money(v: number): string {
  return en(v);
}

function StatementPages({ source, generatedAt }: { source: PdfSource; generatedAt: Date }) {
  const v: DriverStatementView = source.view;
  const tb = taxBreakdown(v);
  const rows = summaryRows(v);
  return (
    <Page size="A4" style={st.page} wrap>
      <View style={st.head}>
        <View>
          <Text style={st.title}>{v.title}</Text>
          <Text style={st.small}>{jpMonthLabel(v.month)}分</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={st.small}>版 {v.version}　目印 {v.hashShort}</Text>
          <Text style={st.small}>出力 {jpDateTime(generatedAt)}</Text>
        </View>
      </View>

      <View style={st.parties}>
        <View style={st.party}>
          <Text style={st.small}>お支払先</Text>
          <Text style={st.partyName}>{v.driver.name} 様</Text>
          {v.driver.code ? <Text style={st.small}>番号 {v.driver.code}</Text> : null}
          <Text>{v.driver.registrationNo ? `登録番号 ${v.driver.registrationNo}` : "登録番号 なし"}</Text>
        </View>
        <View style={st.party}>
          <Text style={st.small}>作成者</Text>
          <Text style={st.partyName}>{v.company.name}</Text>
          {v.company.registrationNo ? <Text>登録番号 {v.company.registrationNo}</Text> : null}
        </View>
      </View>

      <View style={st.meta}>
        <View style={st.metaItem}>
          <Text style={st.small}>取引の期間</Text>
          <Text>
            {jpDate(v.period.from)}〜{jpDate(v.period.to)}
          </Text>
        </View>
        <View style={st.metaItem}>
          <Text style={st.small}>振込予定日</Text>
          <Text>{jpDateWithWeekday(v.payDate)}</Text>
        </View>
        <View style={st.metaItem}>
          <Text style={st.small}>振込先</Text>
          <Text>{source.account ? `${source.account.bank} ${source.account.branch} ${source.account.type} 下3桁 ${source.account.last3}` : "未登録"}</Text>
        </View>
      </View>

      <View style={st.totalBox}>
        <Text style={st.totalLabel}>お振込額</Text>
        <Text style={st.totalValue}>{money(v.total)}</Text>
      </View>
      {totalNote(v.total) ? <Text style={{ marginTop: 4, fontWeight: 700 }}>{totalNote(v.total)}</Text> : null}

      <Text style={st.h2}>委託料の内容</Text>
      <View style={st.headRow}>
        <Text style={[st.th, st.cName]}>内容</Text>
        <Text style={[st.th, st.cQty]}>数量</Text>
        <Text style={[st.th, st.cUnit]}>単位</Text>
        <Text style={[st.th, st.cRate]}>単価（税抜）</Text>
        <Text style={[st.th, st.cAmount]}>金額（税抜）</Text>
      </View>
      {v.lines.length === 0 ? (
        <View style={st.row}>
          <Text style={st.cName}>この月の稼働はありません</Text>
        </View>
      ) : (
        v.lines.map((l) => (
          <View key={l.key} style={st.row} wrap={false}>
            <View style={st.cName}>
              <Text>{l.project}</Text>
              {l.client ? <Text style={st.small}>{l.client}</Text> : null}
            </View>
            <Text style={st.cQty}>{qtyText(l.qty)}</Text>
            <Text style={st.cUnit}>{l.unit}</Text>
            <Text style={st.cRate}>{unitPriceText(l.rate)}</Text>
            <Text style={st.cAmount}>{money(l.amount)}</Text>
          </View>
        ))
      )}
      {tb ? (
        <View style={[st.sumRow, { backgroundColor: SOFT, paddingHorizontal: 4 }]}>
          <Text>
            税率ごとの合計：{tb.rateLabel} {money(tb.base)}
          </Text>
          <Text>
            {tb.taxLabel} {money(tb.tax)}
          </Text>
        </View>
      ) : (
        <View style={[st.sumRow, { backgroundColor: SOFT, paddingHorizontal: 4 }]}>
          <Text>委託料の合計（税抜）{money(v.subtotal)}</Text>
          <Text>消費税相当額の支払はありません</Text>
        </View>
      )}

      {v.deductions.length > 0 ? (
        <View>
          <Text style={st.h2}>引かれているもの（控除）</Text>
          <View style={st.headRow}>
            <Text style={[st.th, st.cName]}>名前</Text>
            <Text style={[st.th, st.cHow]}>計算</Text>
            <Text style={[st.th, st.cTag]}>取引条件</Text>
            <Text style={[st.th, st.cAmount]}>金額（税抜）</Text>
          </View>
          {v.deductions.map((d) => (
            <View key={d.key} style={st.row} wrap={false}>
              <Text style={st.cName}>
                {d.name}
                {d.taxable ? "" : "（消費税の対象外）"}
              </Text>
              <Text style={st.cHow}>{d.how}</Text>
              <Text style={st.cTag}>{d.agreedInWriting ? "取引条件で合意" : "—"}</Text>
              <Text style={st.cAmount}>{money(-d.amount)}</Text>
            </View>
          ))}
          {v.deductionTax !== 0 ? (
            <View style={st.row}>
              <Text style={st.cName}>引かれているものの消費税（{v.taxRatePercent}%）</Text>
              <Text style={st.cHow}>課税の控除の合計 × {v.taxRatePercent}%</Text>
              <Text style={st.cTag} />
              <Text style={st.cAmount}>{money(-v.deductionTax)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {v.adjustments.length > 0 ? (
        <View>
          <Text style={st.h2}>調整（立替の精算など）</Text>
          {v.adjustments.map((a) => (
            <View key={a.key} style={st.row} wrap={false}>
              <Text style={st.cName}>{a.label}</Text>
              <Text style={st.cHow}>{a.taxable ? "消費税の対象" : "消費税の対象外"}</Text>
              <Text style={st.cTag}>{a.agreedInWriting ? "取引条件で合意" : "—"}</Text>
              <Text style={st.cAmount}>{money(a.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Text style={st.h2}>お振込額の計算</Text>
      {rows.map((r) => (
        <View key={r.key} style={st.sumRow} wrap={false}>
          <View style={{ flex: 1 }}>
            <Text>{r.label}</Text>
            {r.hint ? <Text style={st.small}>{r.hint}</Text> : null}
          </View>
          <Text>{money(r.amount)}</Text>
        </View>
      ))}
      <View style={st.sumTotal} wrap={false}>
        <Text style={{ fontWeight: 700, fontSize: 11 }}>お振込額</Text>
        <Text style={{ fontWeight: 700, fontSize: 11 }}>{money(v.total)}</Text>
      </View>

      <View style={st.note} wrap={false}>
        {v.isPurchaseStatement ? <Text>登録番号のある方への明細は、仕入明細書の記載事項を載せています。</Text> : null}
        <Text>{v.note}</Text>
        <Text style={[st.small, { marginTop: 4 }]}>{source.confirmationText}</Text>
      </View>

      <View style={st.footer} fixed>
        <Text>
          {v.company.name}　{v.driver.name} 様　{jpMonthLabel(v.month)}分　版 {v.version}
        </Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </Page>
  );
}

/** 明細（1 件でも 1 か月分でも）を 1 つの PDF にする */
export async function renderStatementsPdf(sources: PdfSource[], generatedAt = new Date()): Promise<Uint8Array> {
  registerPdfFonts();
  const first = sources[0]?.view;
  const doc = (
    <Document
      title={first ? `支払明細 ${jpMonthLabel(first.month)}` : "支払明細"}
      author={first?.company.name ?? ""}
      creator="しめ日ラボ"
      producer="しめ日ラボ"
      language="ja"
    >
      {sources.map((src, i) => (
        <StatementPages key={`${src.view.driver.name}-${i}`} source={src} generatedAt={generatedAt} />
      ))}
    </Document>
  );
  const buf = await renderToBuffer(doc);
  return new Uint8Array(buf);
}
