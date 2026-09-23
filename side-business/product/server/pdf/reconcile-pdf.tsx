/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ComponentProps } from "react";
import { jpToday } from "@/lib/format";
import type { LetterDocument } from "~/server/features/reconcile/letter";
import { PDF_FONT, registerPdfFonts } from "~/server/pdf/fonts";

/**
 * 元請のご担当者への「お支払通知書の内容のご確認のお願い」の PDF（A4 縦）。
 * 本文は画面の文面と同じ（letterDocument が buildLetter から作る。画面で直した文面ならそれ）。
 * 本文のあとに、差の一覧の表（当社の記録・お支払通知・差）と合計を付ける。
 * 丁寧語で、確かめてもらうお願いだけ（責める言い方・法律の話は書かない）。
 */

/** 日本語の行の折り返しで「-」が入らないように、1 文字ずつ区切る */
function noHyphen(word: string): string[] {
  return /[^\x00-\x7f]/.test(word) ? Array.from(word).flatMap((c) => [c, ""]) : [word];
}

function T(props: ComponentProps<typeof Text>) {
  return <Text hyphenationCallback={noHyphen} {...props} />;
}

const INK = "#16171a";
const MUTED = "#5c5f66";
const LINE = "#c9c9c2";
const SOFT = "#f3f3ef";
const RED = "#c62828";

const st = StyleSheet.create({
  page: { fontFamily: PDF_FONT, fontSize: 10, color: INK, paddingTop: 40, paddingBottom: 48, paddingHorizontal: 48, lineHeight: 1.6 },
  date: { textAlign: "right", fontSize: 9, color: MUTED },
  // 大きい文字は行の高さを明示する（引き継いだ行の高さのままだと、次の行と重なるため）
  title: { fontSize: 13, fontWeight: 700, lineHeight: 1.4, marginTop: 10, marginBottom: 12, textAlign: "center" },
  line: { minHeight: 16 },
  indent: { marginLeft: 14 },
  h2: { fontSize: 10.5, fontWeight: 700, lineHeight: 1.3, marginTop: 18, marginBottom: 2, borderLeftWidth: 3, borderLeftColor: INK, paddingLeft: 5 },
  target: { fontSize: 9, color: MUTED, marginBottom: 4 },
  headRow: { flexDirection: "row", backgroundColor: SOFT, borderTopWidth: 1, borderTopColor: INK, borderBottomWidth: 1, borderBottomColor: INK, paddingVertical: 3 },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 4 },
  totalRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingVertical: 4 },
  th: { fontSize: 8.5, fontWeight: 700 },
  cell: { fontSize: 8.5, lineHeight: 1.45 },
  c0: { width: 26, paddingRight: 4, textAlign: "right" },
  c1: { flex: 2.4, paddingRight: 6 },
  c2: { flex: 2.4, paddingRight: 6 },
  c3: { flex: 2.4, paddingRight: 6 },
  c4: { flex: 1.3, textAlign: "right" },
  sub: { fontSize: 7.5, color: MUTED },
  note: { marginTop: 8, fontSize: 7.8, color: MUTED, lineHeight: 1.5 },
  // render で書く文字は、ページの行の高さを引き継ぐと消える（@react-pdf/renderer 4.9）ので、行の高さを 0（指定なし）に戻す
  footer: { position: "absolute", bottom: 22, left: 48, right: 48, fontSize: 7.5, lineHeight: 0, color: MUTED, textAlign: "right" },
});

function LetterPage({ doc, generatedAt }: { doc: LetterDocument; generatedAt: Date }) {
  const lines = doc.body.split("\n");
  return (
    <Page size="A4" style={st.page} wrap>
      <T style={st.date}>{jpToday(generatedAt)}</T>
      <T style={st.title}>{doc.subject}</T>

      {lines.map((text, i) => {
        // 「   当社の記録では…」のような字下げの行は、字下げを残す
        const indented = /^\s{2,}/.test(text);
        return (
          <T key={i} style={indented ? [st.line, st.indent] : st.line} orphans={2} widows={2}>
            {indented ? text.trimStart() : text || " "}
          </T>
        );
      })}

      {doc.rows.length > 0 && (
        <View>
          {/* 見出しだけがページの下に残らないように */}
          <T style={st.h2} minPresenceAhead={60}>
            確認をお願いしたい点の一覧
          </T>
          <T style={st.target}>対象：{doc.targetText}</T>
          <View style={st.headRow}>
            <T style={[st.th, st.c0]}>{doc.head[0]}</T>
            <T style={[st.th, st.c1]}>{doc.head[1]}</T>
            <T style={[st.th, st.c2]}>{doc.head[2]}</T>
            <T style={[st.th, st.c3]}>{doc.head[3]}</T>
            <T style={[st.th, st.c4]}>{doc.head[4]}</T>
          </View>
          {doc.rows.map((r) => (
            <View key={r.no} style={st.row} wrap={false}>
              <T style={[st.cell, st.c0]}>{r.no}</T>
              <View style={st.c1}>
                <T style={st.cell}>{r.title}</T>
                <T style={st.sub}>{r.kind}</T>
              </View>
              <T style={[st.cell, st.c2]}>{r.ours}</T>
              <T style={[st.cell, st.c3]}>{r.theirs}</T>
              <T style={[st.cell, st.c4, r.diff < 0 ? { color: RED } : {}]}>{r.diffText}</T>
            </View>
          ))}
          <View style={st.totalRow} wrap={false}>
            <T style={[st.cell, st.c0]}> </T>
            <T style={[st.cell, st.c1, { fontWeight: 700 }]}>合計（{doc.rows.length}件）</T>
            <T style={[st.cell, st.c2]}> </T>
            <T style={[st.cell, st.c3]}> </T>
            <T style={[st.cell, st.c4, { fontWeight: 700 }, doc.total < 0 ? { color: RED } : {}]}>{doc.totalText}</T>
          </View>
          {doc.notes.map((n) => (
            <T key={n} style={st.note}>
              {n}
            </T>
          ))}
        </View>
      )}

      <Text style={st.footer} fixed render={({ pageNumber, totalPages }) => `${doc.companyName}　${pageNumber} / ${totalPages}`} />
    </Page>
  );
}

/** 問い合わせ文を PDF にする（本文 ＋ 差の一覧の表） */
export async function renderLetterPdf(doc: LetterDocument, generatedAt = new Date()): Promise<Uint8Array> {
  registerPdfFonts();
  const pdf = (
    <Document title={doc.subject} author={doc.companyName} creator="しめ日ラボ" producer="しめ日ラボ" language="ja">
      <LetterPage doc={doc} generatedAt={generatedAt} />
    </Document>
  );
  const buf = await renderToBuffer(pdf);
  return new Uint8Array(buf);
}

/** ファイル名：問い合わせ_A物流（架空）_2026年10月分.pdf（ファイル名に使えない文字は _ にする） */
export function letterPdfFileName(doc: Pick<LetterDocument, "clientName" | "monthText">): string {
  const safe = (v: string) => v.replace(/[\\/:*?"<>|\r\n\t]/g, "_").slice(0, 60);
  return `問い合わせ_${safe(doc.clientName) || "元請"}_${doc.monthText}分.pdf`;
}
