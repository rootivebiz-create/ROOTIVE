/** @jsxRuntime automatic */
/** @jsxImportSource react */
import "server-only";
import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { en } from "@/lib/engine/types";
import { jpMonth } from "@/lib/format";
import { pct } from "@/lib/payroll/money";
import type { CeoSheet } from "~/server/features/profit";
import { barRatio, changeText, dateWithWeekday, jstDateTime, pointChangeText, rateText, shortMonthLabel, signedYen } from "~/server/features/profit/format";
import { PDF_FONT, registerPdfFonts } from "~/server/pdf/fonts";

/**
 * 社長の 1 枚（A4 縦・1 ページ）。利益の画面と同じ CeoSheet だけから作る。
 * 言い方は短く・やさしく。数字は記録から出したもので、税金の判断はしない。
 */

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
  title: { fontSize: 18, fontWeight: 700 },
  small: { fontSize: 7.5, color: MUTED },
  kpis: { flexDirection: "row", gap: 6, marginTop: 10 },
  kpi: { flex: 1, borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 6 },
  kpiValue: { fontSize: 13.5, fontWeight: 700, marginTop: 1 },
  h2: { fontSize: 10, fontWeight: 700, marginTop: 11, marginBottom: 4 },
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
  boxTitle: { fontSize: 9, fontWeight: 700, marginBottom: 2 },
  big: { fontSize: 11.5, fontWeight: 700 },
  note: { marginTop: 10, fontSize: 7.2, color: MUTED },
  footer: { position: "absolute", bottom: 14, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
});

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "red" }) {
  return (
    <View style={st.kpi}>
      <Text style={st.small}>{label}</Text>
      <Text style={[st.kpiValue, tone === "red" ? { color: RED } : {}]}>{value}</Text>
      <Text style={st.small}>{sub}</Text>
    </View>
  );
}

function ProjectList({ title, rows, empty }: { title: string; rows: CeoSheet["topProjects"]; empty: string }) {
  return (
    <View style={st.col}>
      <Text style={st.h2}>{title}</Text>
      {rows.length === 0 ? (
        <Text style={st.small}>{empty}</Text>
      ) : (
        rows.map((p) => (
          <View key={p.key} style={st.row} wrap={false}>
            <View style={st.cName}>
              <Text>{p.name}</Text>
              <Text style={st.small}>{p.client ?? "元請の設定なし"}</Text>
            </View>
            <Text style={[st.cMoney, p.profit < 0 ? { color: RED } : {}]}>{en(p.profit)}</Text>
            <Text style={st.cRate}>{rateText(p.rate)}</Text>
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
  const w = sheet.watch;
  const c = sheet.confirm;
  const monthText = jpMonth(sheet.month);

  return (
    <Page size="A4" style={st.page}>
      <View style={st.head}>
        <View>
          <Text style={st.title}>社長の1枚　{monthText}分</Text>
          <Text>{sheet.companyName}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={st.small}>{sourceText(sheet)}</Text>
          <Text style={st.small}>出力 {jstDateTime(generatedAt)}</Text>
        </View>
      </View>

      <View style={st.kpis}>
        <Kpi label="売上（税抜）" value={en(t.sales)} sub={changeText(sheet.changes.sales)} />
        <Kpi label="委託料（税抜）" value={en(t.pay)} sub={changeText(sheet.changes.pay)} />
        <Kpi label="会社の利益" value={en(t.profit)} sub={changeText(sheet.changes.profit)} tone={t.profit < 0 ? "red" : undefined} />
        <Kpi label="利益率" value={rateText(t.rate)} sub={pointChangeText(sheet.changes.rate)} />
      </View>
      <Text style={st.formula}>
        案件の粗利（売上 − 委託料）{en(t.gross)} ＋ 控除（ロイヤリティ・管理費など）{en(t.deductions)} − 経過措置の負担 {en(t.burden)} ＝ 会社の利益 {en(t.profit)}
      </Text>

      <Text style={st.h2}>会社の利益の推移（直近6か月）</Text>
      {sheet.trend.map((p, i) => (
        <View key={p.month} style={st.trendRow} wrap={false}>
          <Text style={st.trendMonth}>{shortMonthLabel(p.month, i)}</Text>
          <View style={st.trendTrack}>
            {p.drivers === 0 ? (
              <Text style={st.small}>記録なし</Text>
            ) : (
              <View style={{ width: `${Math.max(0.5, barRatio(p.profit, max) * 100)}%`, height: 8, backgroundColor: p.profit < 0 ? RED : p.month === sheet.month ? INK : "#8a8d93", borderRadius: 2 }} />
            )}
          </View>
          <Text style={[st.trendValue, p.profit < 0 ? { color: RED } : {}]}>{p.drivers === 0 ? "—" : `${p.profit < 0 ? "赤字 " : ""}${en(p.profit)}`}</Text>
          <Text style={st.trendRate}>{rateText(p.rate)}</Text>
        </View>
      ))}

      <View style={st.cols}>
        <ProjectList title="利益の多い案件" rows={sheet.topProjects} empty="この月の案件はありません" />
        <ProjectList title="利益の少ない案件" rows={sheet.bottomProjects} empty="ほかの案件はありません" />
      </View>
      <Text style={st.small}>案件の利益は 売上 − 委託料 です（控除と経過措置の負担はドライバーごとのものなので、案件には割り振っていません）。</Text>

      <Text style={st.h2}>今月の確かめ</Text>
      <View style={st.grid}>
        <View style={st.box} wrap={false}>
          <Text style={st.boxTitle}>インボイスの経過措置の負担</Text>
          {!b.affected ? (
            <Text>会社の設定が原則課税ではないため、この負担は計算していません。</Text>
          ) : b.people === 0 ? (
            <Text>この月、インボイスの登録が無い方への支払はありません。</Text>
          ) : (
            <View>
              <Text>
                登録の無い方 {b.people}人への支払で、控除できずに会社が負担する消費税：
                <Text style={{ fontWeight: 700 }}>今月 {en(b.current?.monthly ?? t.burden)}</Text>
              </Text>
              {b.next ? (
                <Text>
                  {jpMonth(b.next.from)}からは 月 {en(b.next.monthly)}（{signedYen(b.next.diffMonthly)}）。同じ稼働が続いた場合の目安です。
                </Text>
              ) : (
                <Text>経過措置の期間が終わり、これより先の段階はありません。</Text>
              )}
            </View>
          )}
        </View>

        <View style={st.box} wrap={false}>
          <Text style={st.boxTitle}>元請の支払通知との突合</Text>
          {r.notices === 0 ? (
            <Text>この月の支払通知はまだ取り込んでいません。</Text>
          ) : r.count === 0 ? (
            <Text>まだ片付いていない差の記録はありません（支払通知 {r.notices}件）。</Text>
          ) : (
            <View>
              <Text style={[st.big, r.net < 0 ? { color: RED } : {}]}>
                {r.count}件・合計 {signedYen(r.net)}
              </Text>
              {r.shortCount > 0 ? <Text>当社の記録より少ない分：{r.shortCount}件・{en(r.short)}</Text> : null}
              {r.overCount > 0 ? <Text>当社の記録より多い分：{r.overCount}件・{en(r.over)}</Text> : null}
              <Text style={st.small}>未対応と問い合わせ済みの差の合計です。</Text>
            </View>
          )}
        </View>

        <View style={st.box} wrap={false}>
          <Text style={st.boxTitle}>見張り番</Text>
          {w.error ? (
            <Text>{w.error}</Text>
          ) : (
            <View>
              <Text style={st.big}>
                <Text style={{ color: w.red > 0 ? RED : INK }}>赤 {w.red}件</Text>・<Text style={{ color: w.yellow > 0 ? AMBER : INK }}>黄 {w.yellow}件</Text>
              </Text>
              {w.titles.map((x, i) => (
                <Text key={`${x.title}-${i}`} style={{ fontSize: 7.8 }}>
                  {x.severity === "red" ? "［赤］" : "［黄］"}
                  {x.title}
                  {x.subject ? `（${x.subject}）` : ""}
                </Text>
              ))}
              {w.red + w.yellow === 0 ? <Text>まだ確認していない赤・黄の指摘はありません。</Text> : null}
              {w.acked > 0 ? <Text style={st.small}>確認済みにした指摘 {w.acked}件は数えていません。</Text> : null}
            </View>
          )}
        </View>

        <View style={st.box} wrap={false}>
          <Text style={st.boxTitle}>ドライバーの確認と振込</Text>
          {c.statements === 0 ? (
            <Text>明細はまだ保存していません。</Text>
          ) : (
            <Text>
              明細 {c.statements}人のうち <Text style={{ fontWeight: 700, color: c.confirmed === c.statements ? GREEN : INK }}>{c.confirmed}人が確認済み</Text>
              {c.deemed > 0 ? `（ほかに みなし確認 ${c.deemed}人）` : ""}
            </Text>
          )}
          <Text>
            振込額の合計 <Text style={{ fontWeight: 700 }}>{en(sheet.transfer.total)}</Text>（{sheet.transfer.people}人）
          </Text>
          <Text>振込予定日 {dateWithWeekday(sheet.transfer.payDate)}</Text>
        </View>
      </View>

      <View style={st.note}>
        <Text>
          金額は税抜です。消費税と、立替の精算などの調整は利益に入れていません。売上は受注の単価 × 数量から出したもので、元請からの入金額とは違うことがあります。
          経過措置の先の数字は、この月と同じ稼働が続いた場合の目安です（控除できる割合：今の段階 {b.current ? pct(b.current.deductibleRate) : "—"}）。
          消費税の扱いの最終的な判断は、顧問の税理士さんと確かめてください。
        </Text>
        <Link src={TRANSITIONAL_URL} style={{ color: MUTED }}>
          出典：国税庁 インボイス制度（経過措置・2割特例）のページ {TRANSITIONAL_URL}
        </Link>
      </View>

      <View style={st.footer} fixed>
        <Text>
          しめ日ラボ　{sheet.companyName}　{monthText}分
        </Text>
        <Text>1 / 1</Text>
      </View>
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
