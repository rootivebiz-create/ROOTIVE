import Link from "next/link";
import { Money, TableWrap } from "@/components/ui";
import { summarize } from "@/lib/payroll/calc";
import { pct } from "@/lib/payroll/money";
import { sampleData } from "@/lib/payroll/sample";
import { deductibleRateForExempt } from "@/lib/payroll/tax";
import { jpMonth } from "@/lib/tools/invoice-cost";
import { OPTIONS, PLANS } from "@/site.config";
import { ArrowIcon, Section, cx } from "./section";

type Feature = {
  title: string;
  body: string;
  /** どのパックに入るか（PLANS / OPTIONS の id） */
  planId: string;
  /** 上のパックにも入っている（「〇〇パックから」と出す） */
  andUp?: boolean;
  links?: { href: string; label: string }[];
};

const FEATURES: Feature[] = [
  {
    title: "支払明細PDF",
    body: "ドライバーごとの支払明細をPDFで作ります。登録番号や税率ごとの金額なども載せ、仕入明細書として使う形にもできます。",
    planId: "payroll",
    andUp: true,
    links: [{ href: "/demo#statements", label: "デモで見る" }],
  },
  {
    title: "全銀の振込データ",
    body: "ネットバンキングに取り込める、全銀形式の振込データを作ります。振込は御社が金額を確かめてから行います（当方はお金に触れません）。",
    planId: "payroll",
    andUp: true,
    links: [{ href: "/demo#transfer", label: "デモで見る" }],
  },
  {
    title: "取引条件明示書と60日チェック",
    body: "フリーランス法に合わせて、単価・支払期日などの取引条件を示す書面を作り、支払期日が60日を超えていないかを確かめます。",
    planId: "payroll",
    andUp: true,
    links: [{ href: "/tools/torihiki-joken", label: "明示書を作ってみる（無料）" }],
  },
  {
    title: "案件別・元請別・ドライバー別の利益",
    body: "どこで儲かって、どこが薄いかを月ごとに出します。免税ドライバーへの支払で会社が負担する消費税も差し引きます。",
    planId: "profit",
    links: [
      { href: "/demo#profit", label: "デモで見る" },
      { href: "/tools/invoice-cost", label: "負担を計算する" },
    ],
  },
  {
    title: "元請の支払通知との突き合わせ",
    body: "元請から届く支払通知と自社の実績を案件ごとに比べ、差が出たところを一覧にします。",
    planId: "profit",
  },
  {
    title: "点呼などの記録はオプション",
    body: "業務前・業務後の点呼、業務記録、事故記録を、ドライバー本人がスマホで記録し、会社が見られる形で作れます。",
    planId: "records",
  },
];

/** 「支払明細パックから」「利益まるごとパック」「オプション」 */
function planLabel(f: Feature): string {
  if (OPTIONS.some((o) => o.id === f.planId)) return "オプション";
  const plan = PLANS.find((p) => p.id === f.planId);
  if (!plan) return "";
  return f.andUp ? `${plan.name}から` : plan.name;
}

/** デモの架空データで作る、小さな見本（サーバーで 1 回だけ計算する） */
function DemoPreview() {
  const data = sampleData();
  const s = summarize(data);
  const month = jpMonth(`${data.settings.month}-01`);
  const rate = deductibleRateForExempt(s.judgedOn);
  const kpis = [
    { label: "売上", value: s.sales },
    { label: "会社に残る利益", value: s.profit, note: s.margin === null ? undefined : `利益率 ${pct(s.margin)}`, strong: true },
    { label: "免税の方の分で会社が負担する消費税", value: s.invoiceCost, note: `控除${pct(rate)}で計算` },
  ];
  const rows = s.projects.slice(0, 3);

  return (
    <figure className="mt-8 rounded-card border border-border bg-card p-4 sm:p-6">
      <figcaption className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">デモの架空データ</span>
        <span className="text-sm font-bold">{month}分の数字（例）</span>
      </figcaption>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className={cx("rounded-lg p-3", k.strong ? "border-2 border-accent" : "border border-border")}>
            <dt className="text-xs font-bold leading-snug text-muted-foreground">{k.label}</dt>
            <dd className="mt-1 text-xl font-bold sm:text-2xl">
              <Money value={k.value} />
            </dd>
            {k.note && <dd className="num mt-0.5 text-xs text-muted-foreground">{k.note}</dd>}
          </div>
        ))}
      </dl>

      <h3 className="mt-6 text-sm font-bold">案件別の粗利（上位3件）</h3>
      <TableWrap>
        <table className="mt-2 w-full min-w-[20rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-2 font-bold">
                案件（元請）
              </th>
              <th scope="col" className="px-2 py-2 text-right font-bold">
                売上
              </th>
              <th scope="col" className="px-2 py-2 text-right font-bold">
                粗利
              </th>
              <th scope="col" className="py-2 pl-2 text-right font-bold">
                粗利率
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.project.id} className="border-b border-border">
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  <span className="block font-bold leading-snug">{r.project.name}</span>
                  <span className="block text-xs text-muted-foreground">{r.project.client}</span>
                </th>
                <td className="px-2 py-2 text-right">
                  <Money value={r.sales} />
                </td>
                <td className="px-2 py-2 text-right">
                  <Money value={r.gross} />
                </td>
                <td className="num py-2 pl-2 text-right">{r.margin === null ? "—" : pct(r.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        ドライバー{data.drivers.length}人・元請{new Set(data.projects.map((p) => p.client)).size}
        社の架空のデータです（実在の会社・人物ではありません）。金額は税抜。利益 ＝ 売上 − 委託料 ＋ ロイヤリティ・管理費 −
        免税の方の分の消費税の負担。
      </p>
      <Link href="/demo#profit" className="mt-2 inline-flex min-h-11 items-center gap-1 font-bold">
        デモで全部さわる
        <ArrowIcon />
      </Link>
    </figure>
  );
}

export function Features() {
  return (
    <Section
      id="dekiru"
      title="できること"
      lead={<p>御社の今のやり方に合わせて、必要なものだけを作ります。画面はデモ（架空のデータ）で触れます。</p>}
    >
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <li key={f.title} className="flex flex-col rounded-card border border-border bg-card p-4 sm:p-5">
            <p className="text-xs font-bold text-muted-foreground">{planLabel(f)}</p>
            <h3 className="mt-1 text-lg font-bold leading-snug [word-break:auto-phrase]">{f.title}</h3>
            <p className="mt-2 flex-1 text-[15px] leading-relaxed">{f.body}</p>
            {f.links && (
              <p className="mt-2 flex flex-wrap gap-x-4">
                {f.links.map((l) => (
                  <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center gap-1 text-sm font-bold">
                    {l.label}
                    <ArrowIcon />
                  </Link>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
      <DemoPreview />
    </Section>
  );
}
