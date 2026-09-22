/**
 * PDF 運転者台帳（A4 縦・1 人 1 ページ）。サーバー専用（@react-pdf/renderer の Node 版）
 *
 * 貨物軽自動車運送事業の監査で求められる項目を、そのまま提出できる並びで出す。
 * 値はすべて DB（v_driver_roster と各記録）の値をそのまま表示し、ここでは計算しない。
 */
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { APTITUDE_KIND_LABELS, INCIDENT_KIND_LABELS, INSTRUCTION_KIND_LABELS, type AptitudeKind, type IncidentKind } from "@/lib/db/types";
import { ensurePdfFonts, PDF_FONT_FAMILY } from "./fonts";

ensurePdfFonts();

const GRAY = "#555555";
const LINE = "#bbbbbb";
const HEAD_BG = "#eeeeee";

const styles = StyleSheet.create({
  page: { padding: 32, fontFamily: PDF_FONT_FAMILY, fontSize: 9.5, color: "#111111" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 },
  title: { fontSize: 15, fontWeight: 700 },
  meta: { fontSize: 8.5, color: GRAY, textAlign: "right" },
  section: { marginTop: 10 },
  sectionTitle: { fontSize: 10.5, fontWeight: 700, marginBottom: 4 },
  table: { borderWidth: 1, borderColor: LINE },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: LINE },
  rowLast: { flexDirection: "row" },
  th: { width: 96, backgroundColor: HEAD_BG, padding: 4, borderRightWidth: 1, borderColor: LINE },
  td: { flexGrow: 1, flexShrink: 1, padding: 4 },
  listHead: { flexDirection: "row", backgroundColor: HEAD_BG, borderBottomWidth: 1, borderColor: LINE },
  listRow: { flexDirection: "row", borderBottomWidth: 1, borderColor: LINE },
  cell: { padding: 3.5 },
  empty: { padding: 6, color: GRAY },
  footer: { position: "absolute", bottom: 18, left: 32, right: 32, fontSize: 8, color: GRAY, textAlign: "center" },
});

/** 台帳 1 人ぶん（v_driver_roster の 1 行 ＋ 明細） */
export interface RosterPdfDriver {
  rosterNo: string;
  name: string;
  kana: string;
  birthDate: string | null;
  age: number | null;
  address: string;
  phone: string;
  hiredOn: string | null;
  appointedOn: string | null;
  retiredOn: string | null;
  licenseNo: string;
  licenseKinds: string;
  licenseConditions: string;
  licenseIssuedOn: string | null;
  licenseExpiresOn: string | null;
  healthCheckOn: string | null;
  keepUntil: string | null;
  instructions: { on: string; kind: string; hours: number; topics: string; instructor: string }[];
  aptitudes: { on: string; kind: string; institution: string; result: string }[];
  incidents: { on: string; kind: string; place: string; description: string; prevention: string }[];
}

export interface RosterPdfData {
  companyName: string;
  /** 出力日 "YYYY-MM-DD" */
  today: string;
  drivers: RosterPdfDriver[];
}

function v(s: string | null | undefined): string {
  return s == null || s === "" ? "—" : s;
}

function Field({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={last ? styles.rowLast : styles.row}>
      <Text style={styles.th}>{label}</Text>
      <Text style={styles.td}>{value}</Text>
    </View>
  );
}

/** 明細の表（列の幅は合計 1 になるように渡す） */
function List({
  title,
  headers,
  widths,
  rows,
}: {
  title: string;
  headers: string[];
  widths: number[];
  rows: string[][];
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.table}>
        <View style={styles.listHead}>
          {headers.map((h, i) => (
            <Text key={h} style={[styles.cell, { width: `${widths[i] * 100}%` }]}>
              {h}
            </Text>
          ))}
        </View>
        {rows.length === 0 ? (
          <Text style={styles.empty}>記録はありません</Text>
        ) : (
          rows.map((r, ri) => (
            <View key={ri} style={styles.listRow}>
              {r.map((c, ci) => (
                <Text key={ci} style={[styles.cell, { width: `${widths[ci] * 100}%` }]}>
                  {c}
                </Text>
              ))}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function DriverPage({ d, companyName, today }: { d: RosterPdfDriver; companyName: string; today: string }) {
  return (
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.title}>運転者台帳</Text>
        <View>
          <Text style={styles.meta}>{companyName}</Text>
          <Text style={styles.meta}>作成番号 {v(d.rosterNo)}　出力日 {today}</Text>
        </View>
      </View>

      <View style={styles.table}>
        <Field label="氏名" value={`${d.name}${d.kana ? `（${d.kana}）` : ""}`} />
        <Field label="生年月日" value={d.birthDate ? `${d.birthDate}${d.age != null ? `（${d.age} 歳）` : ""}` : "—"} />
        <Field label="住所" value={v(d.address)} />
        <Field label="電話" value={v(d.phone)} />
        <Field label="雇入れ年月日" value={v(d.hiredOn)} />
        <Field label="選任年月日" value={v(d.appointedOn)} />
        <Field label="退職年月日" value={v(d.retiredOn)} />
        <Field label="免許証番号" value={v(d.licenseNo)} />
        <Field label="免許の種類" value={v(d.licenseKinds)} />
        <Field label="免許の条件" value={v(d.licenseConditions)} />
        <Field label="免許交付日" value={v(d.licenseIssuedOn)} />
        <Field label="免許有効期限" value={v(d.licenseExpiresOn)} />
        <Field label="健康診断" value={v(d.healthCheckOn)} last />
      </View>

      <List
        title="指導・監督の記録"
        headers={["実施日", "種類", "時間", "内容", "実施者"]}
        widths={[0.14, 0.12, 0.08, 0.46, 0.2]}
        rows={d.instructions.map((i) => [
          i.on,
          INSTRUCTION_KIND_LABELS[i.kind] ?? i.kind,
          String(i.hours),
          i.topics,
          i.instructor,
        ])}
      />

      <List
        title="適性診断の記録"
        headers={["受診日", "種類", "実施機関", "結果"]}
        widths={[0.16, 0.16, 0.4, 0.28]}
        rows={d.aptitudes.map((a) => [a.on, APTITUDE_KIND_LABELS[a.kind as AptitudeKind] ?? a.kind, a.institution, a.result])}
      />

      <List
        title="事故・違反の記録"
        headers={["発生日", "種類", "場所", "内容", "再発防止"]}
        widths={[0.14, 0.1, 0.16, 0.34, 0.26]}
        rows={d.incidents.map((n) => [
          n.on,
          INCIDENT_KIND_LABELS[n.kind as IncidentKind] ?? n.kind,
          n.place,
          n.description,
          n.prevention,
        ])}
      />

      <Text style={styles.footer} fixed>
        {d.keepUntil ? `保存期限 ${d.keepUntil} まで` : "在籍中（退職の 3 年後まで保存します）"}
      </Text>
    </Page>
  );
}

/** 運転者台帳 PDF を作る */
export async function renderRosterPdf(data: RosterPdfData): Promise<Uint8Array> {
  const doc = (
    <Document title="運転者台帳" author={data.companyName}>
      {data.drivers.length === 0 ? (
        <Page size="A4" style={styles.page}>
          <Text style={styles.title}>運転者台帳</Text>
          <Text style={{ marginTop: 12, color: GRAY }}>ドライバーが登録されていません。</Text>
        </Page>
      ) : (
        data.drivers.map((d) => <DriverPage key={d.name} d={d} companyName={data.companyName} today={data.today} />)
      )}
    </Document>
  );
  return new Uint8Array(await renderToBuffer(doc));
}
