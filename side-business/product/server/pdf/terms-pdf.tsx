/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { jpDate } from "@/lib/format";
import { TEMPLATE_NOTE, TERMS_TITLE, termsSections, type TermsDocument } from "~/server/features/terms/document";
import { jpDateTimeJst } from "~/server/features/terms/links";
import { PDF_FONT, registerPdfFonts } from "~/server/pdf/fonts";

/**
 * 取引条件の明示書の PDF（A4）。中身は画面と同じ termsSections() の並びと文だけから作る。
 * どのページの下にも「ひな形の内容は専門家に確認を」を入れる（法令の判断はしない）。
 */

const INK = "#16171a";
const MUTED = "#5c5f66";
const LINE = "#c9c9c2";
const SOFT = "#f3f3ef";
const WARN = "#9a3412";

const st = StyleSheet.create({
  page: { fontFamily: PDF_FONT, fontSize: 9.5, color: INK, paddingTop: 32, paddingBottom: 56, paddingHorizontal: 40, lineHeight: 1.5 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  // 大きい文字は行の高さを明示する（引き継いだ行の高さのままだと、次の行と重なるため）
  title: { fontSize: 16, fontWeight: 700, lineHeight: 1.3 },
  small: { fontSize: 8, color: MUTED },
  parties: { flexDirection: "row", marginTop: 12, gap: 14 },
  party: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8 },
  partyName: { fontSize: 12, fontWeight: 700, lineHeight: 1.3 },
  intro: { marginTop: 10 },
  section: { marginTop: 9 },
  h2: { fontSize: 10.5, fontWeight: 700, lineHeight: 1.3, borderLeftWidth: 3, borderLeftColor: INK, paddingLeft: 5, marginBottom: 3 },
  para: { marginLeft: 8 },
  emphasis: { marginLeft: 8, fontWeight: 700, color: WARN },
  table: { marginTop: 3, marginLeft: 8 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 2, backgroundColor: SOFT },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 3 },
  th: { fontWeight: 700, fontSize: 8.5 },
  c0: { flex: 3, paddingRight: 4 },
  c1: { flex: 2.2, paddingRight: 4 },
  c2: { flex: 1.6, textAlign: "right", paddingRight: 6 },
  c3: { flex: 1.4 },
  receipt: { marginTop: 14, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 8, fontSize: 8.5 },
  // 下の 2 行：ひな形の注意／会社・相手・版・ページ。
  // render で書く文字は、ページの行の高さを引き継ぐと消える（@react-pdf/renderer 4.9）ので、行の高さを 0（指定なし）に戻す
  footerNote: { position: "absolute", bottom: 32, left: 40, right: 40, fontSize: 7.5, lineHeight: 1.3, color: MUTED },
  footer: { position: "absolute", bottom: 18, left: 40, right: 40, flexDirection: "row", alignItems: "flex-end" },
  footerText: { fontSize: 7.5, lineHeight: 1.3, color: MUTED },
  footerLeft: { flex: 1, paddingRight: 12, textAlign: "right" },
  footerPage: { width: 48, alignItems: "flex-end" },
});

const COLS = [st.c0, st.c1, st.c2, st.c3];

export type TermsPdfSource = { doc: TermsDocument; receivedText?: string | null };

function TermsPages({ source, generatedAt }: { source: TermsPdfSource; generatedAt: Date }) {
  const d = source.doc;
  const sections = termsSections(d);
  return (
    <Page size="A4" style={st.page} wrap>
      <View>
        <View style={st.head}>
          <View>
            <Text style={st.title}>{TERMS_TITLE}</Text>
            <Text style={st.small}>明示した日 {jpDate(d.issuedOn)}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={st.small}>
              版 {d.version}　目印 {d.hashShort}
            </Text>
            <Text style={st.small}>出力 {jpDateTimeJst(generatedAt)}</Text>
          </View>
        </View>

        <View style={st.parties}>
          <View style={st.party}>
            <Text style={st.small}>委託者</Text>
            <Text style={st.partyName}>{d.company.name}</Text>
            {d.company.registrationNo ? <Text>登録番号 {d.company.registrationNo}</Text> : null}
          </View>
          <View style={st.party}>
            <Text style={st.small}>受託者</Text>
            <Text style={st.partyName}>{d.driver.name} 様</Text>
            {d.driver.code ? <Text style={st.small}>番号 {d.driver.code}</Text> : null}
          </View>
        </View>

        <Text style={st.intro}>委託者は、受託者に委託する業務の取引条件を、次のとおり明示します。</Text>

        {sections.map((sec) => (
          <View key={sec.key} style={st.section} wrap={!sec.table || sec.table.rows.length > 12}>
            {/* 見出しだけがページの下に残らないように */}
            <Text style={st.h2} minPresenceAhead={28}>
              {sec.label}
            </Text>
            {sec.paragraphs.map((p, i) => (
              <Text key={i} style={sec.emphasis ? st.emphasis : st.para}>
                {p}
              </Text>
            ))}
            {sec.table ? (
              <View style={st.table}>
                <View style={st.headRow}>
                  {sec.table.head.map((h, i) => (
                    <Text key={h} style={[st.th, COLS[i] ?? st.c3]}>
                      {h}
                    </Text>
                  ))}
                </View>
                {sec.table.rows.map((r, ri) => (
                  <View key={ri} style={st.row} wrap={false}>
                    {r.map((cell, ci) => (
                      <Text key={ci} style={COLS[ci] ?? st.c3}>
                        {cell}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        <View style={st.receipt} wrap={false}>
          <Text>{source.receivedText ?? "受託者の受け取り：この版の記録はまだありません"}</Text>
          <Text style={st.small}>この書面の目印（{d.hashShort}）は、書いてある中身から作った値です。中身が 1 文字でも変わると、目印も変わります。</Text>
        </View>
      </View>

      <Text style={st.footerNote} fixed>
        {TEMPLATE_NOTE}
      </Text>
      {/* ページ番号：文字の要素に render を付けると、描き直すたびに行の高さが掛け算されてページの外へ押し出される（react-pdf の動き）。
          外側の枠で render し、毎回新しい文字の要素を返す（明細の PDF と同じ作り） */}
      <View style={st.footer} fixed>
        <Text style={[st.footerText, st.footerLeft]}>{`${d.company.name}　${d.driver.name} 様　版 ${d.version}`}</Text>
        <View style={st.footerPage} render={(p) => {
            // View の render にも totalPages は渡る（型にだけ無い）
            const { pageNumber, totalPages } = p as { pageNumber: number; totalPages?: number };
            return <Text style={st.footerText}>{totalPages ? `${pageNumber} / ${totalPages}` : `${pageNumber}`}</Text>;
          }} />
      </View>
    </Page>
  );
}

/** 明示書（1 通でも何人分でも）を 1 つの PDF にする */
export async function renderTermsPdf(sources: TermsPdfSource[], generatedAt = new Date()): Promise<Uint8Array> {
  registerPdfFonts();
  const first = sources[0]?.doc;
  const doc = (
    <Document title={TERMS_TITLE} author={first?.company.name ?? ""} creator="しめ日ラボ" producer="しめ日ラボ" language="ja">
      {sources.length === 0 ? (
        <Page size="A4" style={st.page}>
          <Text>明示書がありません。</Text>
        </Page>
      ) : (
        sources.map((src, i) => <TermsPages key={`${src.doc.recordId}-${i}`} source={src} generatedAt={generatedAt} />)
      )}
    </Document>
  );
  const buf = await renderToBuffer(doc);
  return new Uint8Array(buf);
}
