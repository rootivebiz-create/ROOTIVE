import Link from "next/link";
import { Money, TableWrap } from "@/components/ui";
import { cx } from "@/lib/cx";
import { jpMonth } from "@/lib/format";
import { summarize } from "@/lib/payroll/calc";
import { pct } from "@/lib/payroll/money";
import { sampleData } from "@/lib/payroll/sample";
import { deductibleRateForExempt } from "@/lib/payroll/tax";
import { PLANS } from "@/site.config";
import { NextStep } from "./primary-cta";
import { MONTH_STEPS, SCREENS, type PackId } from "./product-content";
import { ArrowIcon, Section } from "./section";

/** 「支払明細パックから」「利益まるごとパック」（どのパックで使えるか） */
function packLabel(pack: PackId): string {
  const plan = PLANS.find((p) => p.id === pack);
  if (!plan) return "";
  // 支払明細パックの機能は、上のパックにも入っている
  return pack === "payroll" ? `${plan.name}から` : plan.name;
}

/** 計算のデモ（ブラウザだけ）の架空データで作る、利益の画面の小さな見本（サーバーで 1 回だけ計算する） */
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
        <span className="rounded bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground">架空のデータ</span>
        <span className="text-sm font-bold">利益の見え方（{month}分の例）</span>
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
        計算のデモ（ブラウザだけ）で触る
        <ArrowIcon />
      </Link>
    </figure>
  );
}

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

export function Features() {
  const packOf = (id: string) => SCREENS.find((s) => s.id === id)?.pack ?? "payroll";
  return (
    <Section
      id="dekiru"
      title="ひと月の締めの流れで、できること"
      lead={
        <p>
          製品の画面は、締めの順に並んでいます。上から順に進めれば、その月の締めが終わります。最初の 1〜2 か月は、今の Excel
          と並べて 1 円まで比べます（並行運用）。
        </p>
      }
    >
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MONTH_STEPS.map((step, i) => (
          <li key={step.screenId} className="flex flex-col rounded-card border border-border bg-card p-4 sm:p-5">
            <p className="text-xs font-bold text-muted-foreground">{packLabel(packOf(step.screenId))}</p>
            <h3 className="mt-1 flex items-baseline gap-2 text-lg font-bold leading-snug [word-break:auto-phrase]">
              <span aria-hidden>{CIRCLED[i] ?? `${i + 1}.`}</span>
              <span>
                <span className="sr-only">{i + 1}. </span>
                {step.label}
              </span>
            </h3>
            <p className="mt-2 flex-1 text-[15px] leading-relaxed">{step.body}</p>
            <Link href={`/product#${step.screenId}`} className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-bold">
              くわしく
              <span className="sr-only">（{step.label}）</span>
              <ArrowIcon />
            </Link>
          </li>
        ))}
      </ol>
      <DemoPreview />
      <NextStep alt={{ href: "/product", label: "製品の画面をすべて見る" }}>
        御社の単価・控除・元請の形で同じように動くかは、30分の相談でお答えします。
      </NextStep>
    </Section>
  );
}
