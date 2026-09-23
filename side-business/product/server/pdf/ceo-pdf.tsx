/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ComponentProps } from "react";
import { en } from "@/lib/engine/types";
import { jpMonth } from "@/lib/format";
import { pct } from "@/lib/payroll/money";
import type { CeoSheet } from "~/server/features/profit";
import { barRatio, changeText, dateWithWeekday, jstDateTime, pointChangeText, rateText, shortMonthLabel, signedYen } from "~/server/features/profit/format";
import { PDF_FONT, registerPdfFonts } from "~/server/pdf/fonts";

/**
 * 社長の 1 枚（A4 縦・1 ページ）。利益の画面と同じ CeoSheet だけから作る。
 * 言い方は短く・やさしく。数字は記録から出したもので、税金の判断はしない。
 * 大きい字には lineHeight を必ず書く（react-pdf はページの行の高さを pt に直して引き継ぐので、書かないと下の行に重なる）。
 */

/**
 * 日本語の行の折り返しで「-」が入らないようにした Text。
 * 1 文字ずつ区切り、間に空の区切りを入れる（区切りの位置で折り返しても、ハイフンを足さない）
 */
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

/** 経過措置の出典（国税庁：インボイス 経過措置・2割特例） */
const TRANSITIONAL_URL = "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice_2tokurei.htm";

const st = StyleSheet.create({
  page: { fontFamily: PDF_FONT, fontSize: 8.6, color: INK, paddingTop: 28, paddingBottom: 30, paddingHorizontal: 32, lineHeight: 1.4 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 2, borderBottomColor: INK, paddingBottom: 6 },
  title: { fontSize: 18, fontWeight: 700, lineHeight: 1.3 },
  small: { fontSize: 7.5, color: MUTED },
  kpis: { flexDirection: "row", gap: 6, marginTop: 10 },
  kpi: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 6 },
  kpiValue: { fontSize: 13.5, fontWeight: 700, marginTop: 1, lineHeight: 1.3 },
  h2: { fontSize: 10, fontWeight: 700, marginTop: 11, marginBottom: 4, lineHeight: 1.3 },
  formula: { marginTop: 6, backgroundColor: SOFT, borderRadius: 4, padding: 6, fontSize: 8.2 },
  trendRow: { flexDirection: "row", alignItems: "center", marginBottom: 2.5 },
  trendMonth: { width: 62, fontSize: 8 },
  trendTrack: { flex: 1, height: 9, flexDirection: "row", alignItems: "center" },
  trendValue: { width: 86, textAlign: "right", fontSize: 8 },
  trendRate: { width: 44, textAlign: "right", fontSize: 7.5, color: MUTED },
  cols: { flexDirection: "row", gap: 10 },
  col: { flex: 1 },
  row: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 3 },
  cName: { flex: 3, paddingRight: 4 },
  cMoney: { flex: 1.6, textAlign: "right" },
  cRate: { flex: 0.9, textAlign: "right", color: MUTED },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  box: { width: "49%", borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 6 },
  boxTitle: { fontSize: 9, fontWeight: 700, marginBottom: 2, lineHeight: 1.3 },
  big: { fontSize: 11.5, fontWeight: 700, lineHeight: 1.3 },
  foundRow: { flexDirection: "row", justifyContent: "space-between", gap: 4, borderBottomWidth: 0.6, borderBottomColor: LINE, paddingVertical: 1.5 },
  foundLabel: { flex: 1, paddingRight: 4 },
  note: { marginTop: 10, fontSize: 7.2, color: MUTED },
  footerLeft: { position: "absolute", bottom: 14, left: 32, fontSize: 7, color: MUTED },
  // render で描く字は、ページの行の高さを引き継ぐと描かれないことがあるので lineHeight: 0（ほかの PDF と同じ）
  footerRight: { position: "absolute", bottom: 14, left: 32, right: 32, fontSize: 7, lineHeight: 0, color: MUTED, textAlign: "right" },
});

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "red" }) {
  return (
    <View style={st.kpi}>
      <T style={st.small}>{label}</T>
      <T style={[st.kpiValue, tone === "red" ? { color: RED } : {}]}>{value}</T>
      <T style={st.small}>{sub}</T>
    </View>
  );
}

function ProjectList({ title, rows, empty }: { title: string; rows: CeoSheet["topProjects"]; empty: string }) {
  return (
    <View style={st.col}>
      <T style={st.h2}>{title}</T>
      {rows.length === 0 ? (
        <T style={st.small}>{empty}</T>
      ) : (
        rows.map((p) => (
          <View key={p.key} style={st.row} wrap={false}>
            <View style={st.cName}>
              <T>{p.name}</T>
              <T style={st.small}>{p.client ?? "元請の設定なし"}</T>
            </View>
            <T style={[st.cMoney, p.profit < 0 ? { color: RED } : {}]}>{en(p.profit)}</T>
            <T style={st.cRate}>{rateText(p.rate)}</T>
          </View>
        ))
      )}
    </View>
  );
}

function sourceText(sheet: CeoSheet): string {
  if (sheet.source === "snapshot") return "締め済み（保存した明細の数字）";
  if (sheet.snapshotMissing) return "締め済み（明細の写しが無いため、今の稼働と設定から計算）";
  return "締める前（今の稼働と設定から計算。締めるまで変わります）";
}

function CeoPage({ sheet, generatedAt }: { sheet: CeoSheet; generatedAt: Date }) {
  const t = sheet.totals;
  const max = Math.max(1, ...sheet.trend.map((p) => Math.abs(p.profit)));
  const b = sheet.burden;
  const r = sheet.reconcile;
  const f = sheet.found;
  const w = sheet.watch;
  const c = sheet.confirm;
  const monthText = jpMonth(sheet.month);

  return (
    <Page size="A4" style={st.page}>
      <View style={st.head}>
        <View>
          <T style={st.title}>社長の1枚　{monthText}分</T>
          <T>{sheet.companyName}</T>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <T style={st.small}>{sourceText(sheet)}</T>
          <T style={st.small}>出力 {jstDateTime(generatedAt)}</T>
        </View>
      </View>

      <View style={st.kpis}>
        <Kpi label="売上（税抜）" value={en(t.sales)} sub={changeText(sheet.changes.sales)} />
        <Kpi label="委託料（税抜）" value={en(t.pay)} sub={changeText(sheet.changes.pay)} />
        <Kpi label="会社の利益" value={en(t.profit)} sub={changeText(sheet.changes.profit)} tone={t.profit < 0 ? "red" : undefined} />
        <Kpi label="利益率" value={rateText(t.rate)} sub={pointChangeText(sheet.changes.rate)} />
      </View>
      <T style={st.formula}>
        案件の粗利（売上 − 委託料）{en(t.gross)} ＋ 控除（ロイヤリティ・管理費など）{en(t.deductions)} − 経過措置の負担 {en(t.burden)} ＝ 会社の利益 {en(t.profit)}
      </T>

      <T style={st.h2}>会社の利益の推移（直近6か月）</T>
      {sheet.trend.map((p, i) => (
        <View key={p.month} style={st.trendRow} wrap={false}>
          <T style={st.trendMonth}>{shortMonthLabel(p.month, i)}</T>
          <View style={st.trendTrack}>
            {p.drivers === 0 ? (
              <T style={st.small}>記録なし</T>
            ) : (
              <View style={{ width: `${Math.max(0.5, barRatio(p.profit, max) * 100)}%`, height: 8, backgroundColor: p.profit < 0 ? RED : p.month === sheet.month ? INK : "#8a8d93", borderRadius: 2 }} />
            )}
          </View>
          <T style={[st.trendValue, p.profit < 0 ? { color: RED } : {}]}>{p.drivers === 0 ? "—" : `${p.profit < 0 ? "赤字 " : ""}${en(p.profit)}`}</T>
          <T style={st.trendRate}>{rateText(p.rate)}</T>
        </View>
      ))}

      <View style={st.cols}>
        <ProjectList title="利益の多い案件" rows={sheet.topProjects} empty="この月の案件はありません" />
        <ProjectList title="利益の少ない案件" rows={sheet.bottomProjects} empty="ほかの案件はありません" />
      </View>
      <T style={st.small}>案件の利益は 売上 − 委託料 です（控除と経過措置の負担はドライバーごとのものなので、案件には割り振っていません）。</T>

      <T style={st.h2}>今月の確かめ</T>
      <View style={st.grid}>
        <View style={st.box} wrap={false}>
          <T style={st.boxTitle}>インボイスの経過措置の負担</T>
          {!b.affected ? (
            <T>会社の設定が原則課税ではないため、この負担は計算していません。</T>
          ) : b.people === 0 ? (
            <T>この月、インボイスの登録が無い方への支払はありません。</T>
          ) : (
            <View>
              <T>
                登録の無い方 {b.people}人への支払で、控除できずに会社が負担する消費税：
                <T style={{ fontWeight: 700 }}>今月 {en(t.burden)}</T>
              </T>
              {b.next ? (
                <T>
                  {jpMonth(b.next.from)}からは 月 {en(b.next.monthly)}（今の段階より {signedYen(b.next.diffMonthly)}）。同じ稼働が続いた場合の目安です。
                </T>
              ) : (
                <T>経過措置の期間が終わり、これより先の段階はありません。</T>
              )}
              {sheet.split.people > 0 ? (
                <T style={st.small}>締めの期間の途中で割合が変わるため、日付のある {sheet.split.people}人は稼働の日ごとに分けて数えています。</T>
              ) : null}
              {sheet.split.undated.length > 0 ? (
                <T style={st.small}>日付の無い稼働の {sheet.split.undated.length}人は、期間の末日の割合で数えています。</T>
              ) : null}
            </View>
          )}
        </View>

        <View style={st.box} wrap={false}>
          <T style={st.boxTitle}>見つけたお金（元請の支払通知との突合）</T>
          {r.error ? (
            <T>{r.error}</T>
          ) : r.notices === 0 ? (
            <T>この月の支払通知はまだ取り込んでいません。</T>
          ) : (
            <View>
              <View style={st.foundRow}>
                <T style={st.foundLabel}>確定（取り戻せた額）</T>
                <T style={{ fontWeight: 700 }}>{f.confirmedCount > 0 ? `${en(f.confirmed)}（${f.confirmedCount}件）` : "まだありません"}</T>
              </View>
              <View style={st.foundRow}>
                <T style={st.foundLabel}>見込み（まだ片付いていない、通知が少ない差）</T>
                <T style={{ fontWeight: 700, color: f.estimated > 0 ? RED : INK }}>{f.estimatedCount > 0 ? `${en(f.estimated)}（${f.estimatedCount}件）` : "ありません"}</T>
              </View>
              {r.overCount > 0 ? <T>支払通知が当社の記録より多い差：{r.overCount}件・{en(r.over)}</T> : null}
              <T style={st.small}>確定と見込みは別の数です（足し合わせていません）。差は未対応と問い合わせ済みのもので、突合の画面と同じ数え方です。</T>
            </View>
          )}
          {!r.error && r.unread > 0 ? <T style={st.small}>行を読み取れていない支払通知が {r.unread}件あります。突合の画面で列を選び直してください。</T> : null}
        </View>

        <View style={st.box} wrap={false}>
          <T style={st.boxTitle}>見張り番</T>
          {w.error ? (
            <T>{w.error}</T>
          ) : (
            <View>
              <T style={st.big}>
                <T style={{ color: w.red > 0 ? RED : INK }}>赤 {w.red}件</T>・<T style={{ color: w.yellow > 0 ? AMBER : INK }}>黄 {w.yellow}件</T>
              </T>
              {w.titles.map((x, i) => (
                <T key={`${x.title}-${i}`} style={{ fontSize: 7.8 }}>
                  {x.severity === "red" ? "［赤］" : "［黄］"}
                  {x.title}
                  {x.subject ? `（${x.subject}）` : ""}
                </T>
              ))}
              {w.red + w.yellow === 0 ? <T>まだ確認していない赤・黄の指摘はありません。</T> : null}
              {w.acked > 0 ? <T style={st.small}>確認済みにした指摘 {w.acked}件は数えていません。</T> : null}
            </View>
          )}
        </View>

        <View style={st.box} wrap={false}>
          <T style={st.boxTitle}>ドライバーの確認と振込</T>
          {c.statements === 0 ? (
            <T>明細はまだ保存していません。</T>
          ) : (
            <T>
              明細 {c.statements}人のうち <T style={{ fontWeight: 700, color: c.confirmed === c.statements ? GREEN : INK }}>{c.confirmed}人が確認済み</T>
              {c.deemed > 0 ? `（ほかに みなし確認 ${c.deemed}人）` : ""}
            </T>
          )}
          {c.stale ? <T style={st.small}>保存した明細は、今の稼働・設定と違うところがあります。明細を作り直すと、確認の数も変わります。</T> : null}
          <T>
            振込額の合計 <T style={{ fontWeight: 700 }}>{en(sheet.transfer.total)}</T>（{sheet.transfer.people}人）
          </T>
          {sheet.transfer.notPositive > 0 ? <T style={st.small}>差し引きが 0 円以下で振込の無い方：{sheet.transfer.notPositive}人（控除の中身を確かめてください）</T> : null}
          <T>振込予定日 {dateWithWeekday(sheet.transfer.payDate)}</T>
        </View>
      </View>

      <View style={st.note}>
        <T>
          {[
            "金額は税抜です。消費税と、立替の精算などの調整は利益に入れていません。売上は受注の単価 × 数量から出したもので、元請からの入金額とは違うことがあります。",
            `経過措置の先の数字は、この月と同じ稼働が続いた場合の目安です（控除できる割合：今の段階 ${b.current ? pct(b.current.deductibleRate) : "—"}）。`,
            "消費税の扱いの最終的な判断は、顧問の税理士さんと確かめてください。",
          ].join("")}
        </T>
        <Link src={TRANSITIONAL_URL} style={{ color: MUTED }}>
          出典：国税庁 インボイス制度（経過措置・2割特例）のページ {TRANSITIONAL_URL}
        </Link>
      </View>

      {/* 下の帯（1 枚に収める作りだが、もしはみ出しても本当のページ数を出す。render は Text に直接 fixed を付けないと描かれない） */}
      <T style={st.footerLeft} fixed>
        しめ日ラボ　{sheet.companyName}　{monthText}分
      </T>
      <T style={st.footerRight} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </Page>
  );
}

/** 社長の 1 枚を PDF にする */
export async function renderCeoPdf(sheet: CeoSheet, generatedAt = new Date()): Promise<Uint8Array> {
  registerPdfFonts();
  const doc = (
    <Document title={`社長の1枚 ${jpMonth(sheet.month)}分`} author={sheet.companyName} creator="しめ日ラボ" producer="しめ日ラボ" language="ja">
      <CeoPage sheet={sheet} generatedAt={generatedAt} />
    </Document>
  );
  const buf = await renderToBuffer(doc);
  return new Uint8Array(buf);
}
