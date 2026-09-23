/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ComponentProps } from "react";
import { en } from "@/lib/engine/types";
import { jpMonth } from "@/lib/format";
import type { ParallelReport, ParallelRow } from "~/server/features/parallel";
import { GOLIVE_STREAK_TARGET } from "~/server/features/parallel/gate";
import { jstDateTime, signedYen } from "~/server/features/profit/format";
import { PDF_FONT, registerPdfFonts } from "~/server/pdf/fonts";

/**
 * 並行運用レポート（A4 縦・1 ページ）。「Excel と比べる」の画面・印刷用の報告と同じ loadParallelReport の中身だけから作る。
 * 社長が「切り替えてよいか」を 1 枚で決められるように：一致の人数・差の合計（払いすぎ／払い不足の可能性）・人ごとの差と原因の候補とメモ・切り替えの目安。
 * 今の Excel の払いすぎ・払い不足が見えても、払い直しの要否などは書かない（事実と額だけ）。原因は「候補」で、断定しない。
 * 人数が多くても 1 ページに収まるように、差のある人の行数と名前の数に上限を置き、残りは「ほか n 人」とまとめる。
 */

/** 日本語の折り返しで「-」が入らないようにした Text（1 文字ずつ区切る） */
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
const GREEN = "#1b7f47";
const AMBER = "#9a6200";

/**
 * 1 ページに収めるための上限（A4 の本文はおよそ 780pt。差の行 1 つが約 26pt、名前の一覧 1 行が約 10pt）。
 * 差の大きい順に 10 人まで行にし、残りは人数と差の合計にまとめる
 */
export const PDF_MAX_DIFF_ROWS = 10;
const MAX_NAMES = 16;
/** 1 行に収まる長さ（メモ・原因の候補・名前） */
const MAX_NOTE = 50;
const MAX_WHY = 20;
const MAX_NAME = 9;

const st = StyleSheet.create({
  page: { fontFamily: PDF_FONT, fontSize: 8.4, color: INK, paddingTop: 28, paddingBottom: 34, paddingHorizontal: 32, lineHeight: 1.4 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 6 },
  title: { fontSize: 17, fontWeight: 700, lineHeight: 1.3 },
  small: { fontSize: 7.3, color: MUTED },
  kpis: { flexDirection: "row", gap: 6, marginTop: 10 },
  kpi: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 6 },
  kpiValue: { fontSize: 13, fontWeight: 700, marginTop: 1, lineHeight: 1.3 },
  h2: { fontSize: 10, fontWeight: 700, marginTop: 10, marginBottom: 3, lineHeight: 1.3 },
  band: { marginTop: 6, backgroundColor: SOFT, borderRadius: 4, padding: 6, fontSize: 8 },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 2, fontSize: 7.3, color: MUTED },
  row: { borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 2 },
  rowMain: { flexDirection: "row", fontSize: 7.9 },
  cName: { width: 104, paddingRight: 4 },
  cMoney: { width: 66, textAlign: "right", paddingRight: 4 },
  cDiff: { width: 70, textAlign: "right", paddingRight: 6, fontWeight: 700 },
  cWhy: { flex: 1 },
  memo: { fontSize: 7.3, color: MUTED, paddingLeft: 104 },
  gate: { marginTop: 4, borderWidth: 1.2, borderRadius: 4, padding: 6 },
  note: { marginTop: 8, fontSize: 7, color: MUTED },
  footerLeft: { position: "absolute", bottom: 14, left: 32, fontSize: 7, color: MUTED },
  // render で描く字は、ページの行の高さを引き継ぐと描かれないことがあるので lineHeight: 0（ほかの PDF と同じ）
  footerRight: { position: "absolute", bottom: 14, left: 32, right: 32, fontSize: 7, lineHeight: 0, color: MUTED, textAlign: "right" },
});

function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <View style={st.kpi}>
      <T style={st.small}>{label}</T>
      <T style={[st.kpiValue, color ? { color } : {}]}>{value}</T>
      <T style={st.small}>{sub}</T>
    </View>
  );
}

function cut(text: string, max: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function namesLine(names: string[]): string {
  const shown = names.slice(0, MAX_NAMES).join("・");
  return names.length > MAX_NAMES ? `${shown} ほか ${names.length - MAX_NAMES}人` : shown;
}

function historyText(h: ParallelReport["history"]["months"][number]): string {
  if (h.state === "ok") return `一致・説明済み（${h.compared}人）`;
  if (h.state === "diff") return `${h.compared}人中 ${h.matched}人が一致（理由のメモが無い差あり）`;
  return "比べていません";
}

function DiffRow({ r }: { r: ParallelRow }) {
  const [first, ...more] = r.explanations;
  const why = first ? `${cut(first.title, MAX_WHY)}${more.length ? ` ほか${more.length}` : ""}` : "—";
  return (
    <View style={st.row} wrap={false}>
      <View style={st.rowMain}>
        <T style={st.cName}>{cut(r.name, MAX_NAME)}</T>
        <T style={st.cMoney}>{r.ours === null ? "明細なし" : en(r.ours)}</T>
        <T style={st.cMoney}>{en(r.excelTotal ?? 0)}</T>
        <T style={[st.cDiff, { color: (r.diff ?? 0) < 0 ? RED : INK }]}>{signedYen(r.diff ?? 0)}</T>
        <T style={st.cWhy}>{why}</T>
      </View>
      <T style={[st.memo, r.note ? {} : { color: AMBER }]}>{r.note ? `メモ：${cut(r.note, MAX_NOTE)}` : "メモ：まだありません（どちらに合わせるかを決めて残してください）"}</T>
    </View>
  );
}

function ParallelPage({ report, generatedAt }: { report: ParallelReport; generatedAt: Date }) {
  const { view, history, gate, golive } = report;
  const sm = view.summary;
  const monthText = jpMonth(report.month);
  const compared = view.rows.filter((r) => r.excelTotal !== null && r.diff !== null);
  const diffs = compared.filter((r) => r.diff !== 0).sort((a, b) => Math.abs(b.diff!) - Math.abs(a.diff!) || a.name.localeCompare(b.name, "ja"));
  const shown = diffs.slice(0, PDF_MAX_DIFF_ROWS);
  const rest = diffs.slice(PDF_MAX_DIFF_ROWS);
  const matched = compared.filter((r) => r.diff === 0).map((r) => r.name);
  const notEntered = gate.notEntered.map((r) => r.name);
  const lowCount = diffs.filter((r) => r.diff! > 0).length;
  const highCount = diffs.filter((r) => r.diff! < 0).length;

  return (
    <Page size="A4" style={st.page}>
      <View style={st.head}>
        <View>
          <T style={st.title}>並行運用レポート　{monthText}分</T>
          <T>{report.companyName}</T>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <T style={st.small}>しめ日ラボと、今の Excel の振込額の比べ合わせ</T>
          <T style={st.small}>出力 {jstDateTime(generatedAt)}</T>
        </View>
      </View>

      <View style={st.kpis}>
        <Kpi
          label="一致した人"
          value={sm.compared === 0 ? "—" : `${sm.matched} / ${sm.compared}人`}
          sub={sm.compared === 0 ? "まだ Excel の額を入れていません" : notEntered.length ? `ほかに未入力 ${notEntered.length}人` : "Excel の額を入れた全員のうち"}
          color={sm.compared > 0 && sm.matched === sm.compared ? GREEN : undefined}
        />
        <Kpi label="差の合計（しめ日ラボ − Excel）" value={signedYen(sm.diffTotal)} sub={`差のある人 ${sm.different}人`} />
        <Kpi label="払い不足の可能性（Excel の方が少ない）" value={en(sm.oursHigher)} sub={`${lowCount}人`} color={sm.oursHigher > 0 ? AMBER : undefined} />
        <Kpi label="払いすぎの可能性（Excel の方が多い）" value={en(sm.excelHigher)} sub={`${highCount}人`} color={sm.excelHigher > 0 ? AMBER : undefined} />
      </View>
      {compared.length > 0 ? (
        <T style={st.band}>
          比べた {compared.length}人の振込額の合計：しめ日ラボ {en(report.totals.ours)}／Excel {en(report.totals.excel)}（差 {signedYen(report.totals.ours - report.totals.excel)}）。
          しめ日ラボの額は{view.closed ? "締めたときの明細" : "保存した明細（無ければ今の稼働から出した見込み）"}です。
        </T>
      ) : null}

      <T style={st.h2}>差のある人と、原因の候補</T>
      {diffs.length === 0 ? (
        <T>{compared.length === 0 ? "まだ Excel の額が入っていません。「Excel と比べる」の画面で入れてから出してください。" : "比べた人は、全員 Excel と同じ振込額です。"}</T>
      ) : (
        <View>
          <View style={st.th}>
            <T style={st.cName}>ドライバー</T>
            <T style={st.cMoney}>しめ日ラボ</T>
            <T style={st.cMoney}>Excel</T>
            <T style={[st.cDiff, { fontWeight: 400 }]}>差</T>
            <T style={st.cWhy}>原因の候補（当てはまる額のもの）</T>
          </View>
          {shown.map((r) => (
            <DiffRow key={r.driverId} r={r} />
          ))}
          {rest.length > 0 ? (
            <T style={[st.small, { marginTop: 2 }]}>
              ほか {rest.length}人（差の合計 {signedYen(rest.reduce((a, r) => a + (r.diff ?? 0), 0))}、うちメモの無い人 {rest.filter((r) => !r.note?.trim()).length}人）は、画面の「Excel と比べる」で確かめてください。
            </T>
          ) : null}
        </View>
      )}
      {matched.length > 0 ? (
        <T style={[st.small, { marginTop: 4 }]}>
          一致した人（{matched.length}人）：{namesLine(matched)}
        </T>
      ) : null}
      {notEntered.length > 0 ? (
        <T style={[st.small, { marginTop: 2 }]}>
          Excel の額が入っていない人（{notEntered.length}人。比べていません）：{namesLine(notEntered)}
        </T>
      ) : null}

      <T style={st.h2}>切り替えの目安</T>
      <View wrap={false}>
        <T>
          直近 3 か月：
          {history.months.map((h) => `${jpMonth(h.month)}分 ${historyText(h)}`).join("／")}
        </T>
        <T>
          続けて一致（または差の理由を説明済み）の月：
          <T style={{ fontWeight: 700 }}>{history.streak} か月</T>（目安は {GOLIVE_STREAK_TARGET}〜3 か月）
        </T>
        {golive ? (
          <View style={[st.gate, { borderColor: GREEN }]}>
            <T style={{ fontWeight: 700, color: GREEN }}>{jpMonth(golive)}分から、Excel をやめて、しめ日ラボで締めています。</T>
          </View>
        ) : gate.ready ? (
          <View style={[st.gate, { borderColor: GREEN }]}>
            <T style={{ fontWeight: 700, color: GREEN }}>本番に切り替える条件（比べた人が全員一致か、差のある人全員に理由のメモがある）がそろっています。</T>
            {gate.cautions.map((c, i) => (
              <T key={i} style={st.small}>
                ・{c}
              </T>
            ))}
            <T style={st.small}>切り替えるかは社長が決めます（しめ日ラボの「Excel と比べる」から記録できます）。</T>
          </View>
        ) : (
          <View style={[st.gate, { borderColor: AMBER }]}>
            <T style={{ fontWeight: 700, color: AMBER }}>本番に切り替える前に、次のことが残っています。</T>
            {gate.blockers.map((b, i) => (
              <T key={i}>・{b}</T>
            ))}
            {gate.cautions.map((c, i) => (
              <T key={`c${i}`} style={st.small}>
                ・{c}
              </T>
            ))}
          </View>
        )}
      </View>

      <View style={st.note}>
        <T>
          {[
            "「原因の候補」は、差の額が明細の部品（消費税・控除・調整・源泉徴収・端数）と同じ額か、ある行の数量・単価の違いで説明できるかを探したものです。当てはまっても、別の理由のことがあります。",
            "「払い不足・払いすぎの可能性」は、しめ日ラボの計算（登録した単価・控除・端数の設定）を基準にしたときの見え方です。どちらの計算が取引条件に合っているかは、会社で確かめてください。消費税の扱いは、顧問の税理士さんに確かめると安心です。",
          ].join("")}
        </T>
      </View>

      {/* 下の帯（1 枚に収める作りだが、もしはみ出しても本当のページ数を出す。render は Text に直接 fixed を付けないと描かれない） */}
      <T style={st.footerLeft} fixed>
        しめ日ラボ　{report.companyName}　{monthText}分
      </T>
      <T style={st.footerRight} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </Page>
  );
}

/** 並行運用レポートを PDF にする */
export async function renderParallelPdf(report: ParallelReport, generatedAt = new Date()): Promise<Uint8Array> {
  registerPdfFonts();
  const doc = (
    <Document title={`並行運用レポート ${jpMonth(report.month)}分`} author={report.companyName} creator="しめ日ラボ" producer="しめ日ラボ" language="ja">
      <ParallelPage report={report} generatedAt={generatedAt} />
    </Document>
  );
  const buf = await renderToBuffer(doc);
  return new Uint8Array(buf);
}
