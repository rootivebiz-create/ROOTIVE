import Link from "next/link";
import { Card, Select, buttonClass } from "@/components/ui";
import { EmptyState, PageHeader } from "~/components/page";
import { jstDateTime } from "~/components/close/format";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { auditCategoryLabel, auditCategoryOf, searchAuditLog, type AuditScope } from "~/server/features/close";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";

export const metadata = { title: "操作の記録" };

type SP = { m?: string; scope?: string; kind?: string; who?: string; p?: string };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** 絞り込みを URL に（空の項目は付けない） */
function hrefOf(base: { m: string; scope: AuditScope; kind: string; who: string }, page?: number, path = "/audit"): string {
  const q = new URLSearchParams({ m: base.m });
  if (base.scope !== "month") q.set("scope", base.scope);
  if (base.kind) q.set("kind", base.kind);
  if (base.who) q.set("who", base.who);
  if (page && page > 1) q.set("p", String(page));
  return `${path}?${q.toString()}`;
}

/**
 * 操作の記録：だれが・いつ・何をしたかを、月ごとに種類・人で絞って見る。CSV にも出せる（税務調査・元請の監査に出す）。
 * 記録は消したり書き換えたりできない（DB が止める）。
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("staff");
  const sp = await searchParams;
  const month = monthFromParam(one(sp.m));
  const m = monthParam(month);
  const scope: AuditScope = one(sp.scope) === "period" ? "period" : "month";
  const kind = (one(sp.kind) ?? "").slice(0, 40);
  const who = (one(sp.who) ?? "").slice(0, 60);
  const page = Math.max(1, Number.parseInt(one(sp.p) ?? "1", 10) || 1);
  const db = await getDb();
  const res = await searchAuditLog(db, user.tenantId, { month, scope, kind: kind || null, who: who || null, page, pageSize: 50 });
  const base = { m, scope, kind, who };
  const label = monthLabelJa(month);
  const filtered = !!kind || !!who;

  return (
    <div className="space-y-6">
      <PageHeader
        title="操作の記録"
        month={month}
        basePath="/audit"
        description="だれが・いつ・何をしたかの記録です。消したり書き換えたりはできません。税務調査や元請の監査で求められたときは、CSV で出せます。"
      />

      <Card>
        <form method="get" action="/audit" className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="m" value={m} />
          <label className="block">
            <span className="block text-sm font-bold">範囲</span>
            <Select name="scope" defaultValue={scope} className="mt-1">
              <option value="month">{label}分の締めに関わる操作</option>
              <option value="period">{label}中に行った操作（設定の変更も）</option>
            </Select>
          </label>
          <label className="block">
            <span className="block text-sm font-bold">種類</span>
            <Select name="kind" defaultValue={kind} className="mt-1">
              <option value="">すべて</option>
              {res.kinds.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}（{k.count}）
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="block text-sm font-bold">した人</span>
            <Select name="who" defaultValue={who} className="mt-1">
              <option value="">だれでも</option>
              {res.people.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}（{p.count}）
                </option>
              ))}
            </Select>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <button type="submit" className={buttonClass("primary")}>
              絞り込む
            </button>
            {filtered && (
              <Link href={hrefOf({ ...base, kind: "", who: "" })} className={buttonClass("ghost")}>
                絞り込みを外す
              </Link>
            )}
            <a href={hrefOf(base, undefined, "/api/data/audit")} className={buttonClass("secondary", "sm:ml-auto")}>
              この条件で CSV に出す（{res.total}件）
            </a>
          </div>
        </form>
      </Card>

      <p className="text-sm text-muted-foreground">
        {scope === "month"
          ? `${label}分の取り込み・明細・確認・見張り番・振込・締め・突合などの操作です。`
          : `${label}の 1 日から末日まで（日本時間）に行った操作すべてです。`}
        {res.total > 0 && ` ${res.total}件のうち ${(res.page - 1) * res.pageSize + 1}〜${Math.min(res.total, res.page * res.pageSize)}件目（新しい順）。`}
      </p>

      {res.rows.length === 0 ? (
        <EmptyState title={filtered ? "この条件に当たる記録はありません" : "この月の操作の記録はまだありません"}>
          {filtered
            ? "絞り込みを外すか、範囲を変えてみてください。"
            : "取り込み・明細の作成・振込データ・締めなどの操作をすると、ここに残ります。前の月は、上の「‹」で開けます。"}
        </EmptyState>
      ) : (
        <ol className="divide-y divide-border rounded-card border border-border bg-card">
          {res.rows.map((r) => (
            <li key={r.id} className="p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="font-bold">{r.label}</p>
                <p className="num text-xs text-muted-foreground">{jstDateTime(r.at)}</p>
              </div>
              <p className="text-muted-foreground">
                {r.actor}
                <span className="ml-2 text-xs">［{auditCategoryLabel(auditCategoryOf(r.action))}］</span>
              </p>
              {r.summary && <p className="break-all">{r.summary}</p>}
              <details className="mt-1">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs text-muted-foreground">記録の中身を見る（番号 {r.id}）</summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 text-xs">
                  {`操作の名前：${r.action}\n対象：${r.entity}${r.entityId ? `（${r.entityId}）` : ""}\n${JSON.stringify(r.detail, null, 2)}`}
                </pre>
              </details>
            </li>
          ))}
        </ol>
      )}

      {res.pages > 1 && (
        <nav aria-label="ページ" className="flex flex-wrap items-center justify-between gap-2">
          {res.page > 1 ? (
            <Link href={hrefOf(base, res.page - 1)} className={buttonClass("secondary")}>
              ‹ 新しい記録
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">
            {res.page} / {res.pages} ページ
          </span>
          {res.page < res.pages ? (
            <Link href={hrefOf(base, res.page + 1)} className={buttonClass("secondary")}>
              古い記録 ›
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <section className="space-y-2 text-sm text-muted-foreground">
        <h2 className="text-base font-bold text-foreground">この記録について</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>操作の記録は、しめ日ラボの中から消したり書き換えたりできません（DB が止めます）。</li>
          <li>ドライバーが明細を開いた・確認した・質問した記録も残ります（ログインなしのリンクからの操作です）。</li>
          <li>
            CSV には、画面の項目に加えて「記録の中身（JSON）」も入ります。口座番号など、設定を直したときの前後の値が入ることがあるので、渡す相手に気をつけてください。
          </li>
          <li>
            帳簿や書類の保存のしかたは、会社で決めた決まり（事務処理規程など）に沿ってください。判断に迷うときは、税理士にご相談ください。
          </li>
        </ul>
        <p>
          <Link href={`/close?m=${m}`} className="inline-flex min-h-11 items-center">
            締めの画面へ戻る →
          </Link>
        </p>
      </section>
    </div>
  );
}
