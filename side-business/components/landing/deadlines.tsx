import Link from "next/link";
import type { ReactNode } from "react";
import { TRANSITIONAL_SOURCE, TRANSITIONAL_STEPS, nonDeductibleTax } from "@/lib/payroll/tax";
import { jpDate, jpMonth } from "@/lib/tools/invoice-cost";
import { ArrowIcon, Section, yenText } from "./section";

/** 例：免税の方へ税込 11 万円を払ったとき、控除できずに会社が負担する消費税（期間ごと） */
const EXAMPLE_PAID = 110_000;
const EXAMPLE = TRANSITIONAL_STEPS.map((s, i) => ({
  label: i === 0 && s.to ? `${jpMonth(s.to)}まで` : `${jpMonth(s.from)}から`,
  rate: s.rate,
  burden: nonDeductibleTax(EXAMPLE_PAID, s.from),
}));
/** 80% → 70% に変わる日（2026-10-01） */
const STEP_70 = TRANSITIONAL_STEPS.find((s) => s.rate === 0.7);

type Source = { label: string; url: string };

function DeadlineCard({
  date,
  tag,
  title,
  children,
  sources,
}: {
  date: string;
  tag: string;
  title: string;
  children: ReactNode;
  sources: Source[];
}) {
  return (
    <li className="flex flex-col rounded-card border border-border bg-card p-4 sm:p-5">
      <p className="flex flex-wrap items-center gap-2">
        <span className="num text-lg font-bold">{date}</span>
        <span className="rounded bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">{tag}</span>
      </p>
      <h3 className="mt-2 text-lg font-bold leading-snug [word-break:auto-phrase]">{title}</h3>
      <div className="mt-2 flex-1 space-y-3 text-[15px] leading-relaxed">{children}</div>
      <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        <p className="font-bold">出典</p>
        <ul className="mt-1 space-y-1">
          {sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all py-1">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export function Deadlines() {
  return (
    <Section
      id="kigen"
      title="今知っておきたい期限"
      lead={
        <p>
          まずは負担と期限を正しく知り、ドライバーと話し合う材料にしてください。個別の判断は、税理士・弁護士・社労士にご確認ください。
        </p>
      }
    >
      <ol className="grid gap-4 lg:grid-cols-3">
        <DeadlineCard
          date={STEP_70 ? jpDate(STEP_70.from) : "2026年10月1日"}
          tag="消費税"
          title="免税ドライバーへの支払の控除が、80%から70%に"
          sources={[{ label: "国税庁「インボイス制度の見直し」（令和8年度税制改正）", url: TRANSITIONAL_SOURCE }]}
        >
          <p>
            インボイス登録をしていない（免税の）ドライバーへの支払は、消費税の一部しか差し引けません。その割合が下がり、会社の負担が増えます。
          </p>
          <div className="rounded-lg bg-muted p-3">
            <p className="text-sm font-bold">例：税込{yenText(EXAMPLE_PAID)}を払ったときの会社の負担（1人・1か月）</p>
            <ul className="mt-2 space-y-1 text-sm">
              {EXAMPLE.map((e) => (
                <li key={e.label} className="flex items-baseline justify-between gap-3">
                  <span>
                    {e.label}
                    <span className="ml-1 text-xs text-muted-foreground">（{e.rate > 0 ? `控除${Math.round(e.rate * 100)}%` : "控除なし"}）</span>
                  </span>
                  <span className="num font-bold">{yenText(e.burden)}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm text-muted-foreground">
            この負担が出るのは、消費税を原則課税で計算している会社です。簡易課税や2割特例の会社には出ません。
          </p>
          <Link href="/tools/invoice-cost" className="inline-flex min-h-11 items-center gap-1 font-bold">
            御社の負担を計算する（無料）
            <ArrowIcon />
          </Link>
        </DeadlineCard>

        <DeadlineCard
          date="2026年9月2日"
          tag="フリーランス法"
          title="日本郵便に、フリーランス法の勧告"
          sources={[
            { label: "公正取引委員会「フリーランス法に基づく勧告」", url: "https://www.jftc.go.jp/FL/FLkankoku/index.html" },
            { label: "LNEWS（2026年9月2日の記事）", url: "https://www.lnews.jp/2026/09/s0902505.html" },
          ]}
        >
          <p>公正取引委員会が、取引条件を明示していなかったことや支払の遅れについて、日本郵便に勧告しました。</p>
          <p>
            フリーランス法（2024年11月1日施行）では、従業員を使っていない個人の業務委託ドライバーなどに仕事を頼むとき、単価や支払期日などの取引条件を、すぐに書面かメールなどで示す必要があります。
          </p>
          <p>支払期日は、役務の提供を受けた日から60日以内の、できるだけ短い期間で決めます。</p>
        </DeadlineCard>

        <DeadlineCard
          date="2027年3月31日"
          tag="安全対策"
          title="貨物軽自動車安全管理者の選任の期限"
          sources={[
            { label: "国土交通省（報道発表）", url: "https://www.mlit.go.jp/report/press/jidosha02_hh_000665.html" },
            { label: "国土交通省（貨物軽自動車運送事業）", url: "https://www.mlit.go.jp/jidosha/jidosha_tk2_000172.html" },
          ]}
        >
          <p>
            2025年3月末までに届出をしていた軽貨物の事業者は、この日までに、営業所ごとに貨物軽自動車安全管理者を選んで届け出る必要があります。
          </p>
          <p>あわせて、業務記録は1年、事故の記録は3年の保存が求められています。</p>
          <p className="text-sm text-muted-foreground">
            記録の仕組みはオプションで作れます。選任や届出そのものは、御社で行っていただくものです。
          </p>
        </DeadlineCard>
      </ol>
    </Section>
  );
}
