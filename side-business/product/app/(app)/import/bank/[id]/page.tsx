import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass } from "@/components/ui";
import { ActionForm } from "~/components/import/action-form";
import { Section } from "~/components/import/sections";
import { Badge, Notice, PageHeader } from "~/components/page";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { maskAccount, shownValue, type BankPreviewRow } from "~/server/features/import/bank-read";
import { loadBankView, type BankView } from "~/server/features/import/bank";
import { monthParam } from "~/server/month";
import { bankApplyAction, bankAssignAction, bankDiscardAction } from "../actions";

export const metadata = { title: "口座の取り込み" };

const dateTime = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

const STATUS: Record<BankPreviewRow["status"], { label: string; tone: "red" | "yellow" | "green" | "gray" }> = {
  new: { label: "新しく入る", tone: "green" },
  changed: { label: "口座が変わる", tone: "yellow" },
  same: { label: "今と同じ", tone: "gray" },
  unmatched: { label: "当たらない", tone: "red" },
  problem: { label: "読めない所がある", tone: "red" },
  duplicate: { label: "同じ人にもう 1 行", tone: "red" },
};

const HOW: Record<string, string> = { chosen: "選んで当てた", code: "番号で当てた", name: "名前で当てた", kana: "カナで当てた" };

/** ファイルの 1 行（誰の・どの口座か）を短く */
function FileLine({ r }: { r: BankPreviewRow }) {
  const i = r.input;
  return (
    <span className="block text-sm">
      <span className="text-muted-foreground">{i.where}：</span>
      {[i.name, i.holderKana || i.kana].filter(Boolean).join("・")}
      <span className="ml-1 text-muted-foreground">
        （{i.bankCode}-{i.branchCode} {i.accountType ? shownValue("accountType", i.accountType) : "種目？"} {maskAccount(i.accountNumber)}）
      </span>
    </span>
  );
}

function Changes({ r }: { r: BankPreviewRow }) {
  if (r.changes.length === 0) return null;
  return (
    <span className="mt-1 block space-y-0.5 text-sm">
      {r.changes.map((c) => (
        <span key={c.field} className="block">
          <span className="text-muted-foreground">{c.label}：</span>
          {r.status === "new" ? (
            <b>{c.after || "（空）"}</b>
          ) : (
            <>
              {c.before || "（空）"} → <b>{c.after || "（空）"}</b>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

export default async function BankImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  // 口座の中身を出すので、事務・オーナーだけ
  const user = await requirePageUser("staff");
  const { id } = await params;
  const sp = await searchParams;
  const view = await loadBankView(await getDb(), user.tenantId, id);
  if (!view) notFound();
  const { batch, draft } = view;
  const m = monthParam(batch.month);
  const src = draft.source;
  return (
    <div className="space-y-5">
      <PageHeader
        title="口座の取り込み"
        description={<span className="break-all">{batch.fileName}</span>}
        actions={
          <Link href={`/import?m=${m}&kind=bank`} className={buttonClass("secondary")}>
            ← 口座の取り込み
          </Link>
        }
      />
      <p className="text-sm text-muted-foreground">
        {dateTime.format(batch.createdAt)}に{batch.createdByName ?? "（記録なし）"}が置きました・
        {src.kind === "zengin"
          ? `全銀の${src.typeLabel}ファイル（振込指定日 ${src.transferDate.slice(0, 2)}/${src.transferDate.slice(2)}・${src.count}件・合計 ${src.total.toLocaleString("ja-JP")}円）`
          : `口座一覧（シート「${src.sheetName}」・見出しは ${src.headerRow} 行目）`}
      </p>
      {draft.problems.length > 0 && (
        <div className="space-y-1">
          {draft.problems.map((p) => (
            <Notice key={p} tone="error">
              {p}
            </Notice>
          ))}
        </div>
      )}
      {batch.status === "draft" ? <DraftBody view={view} m={m} /> : <DoneBody view={view} justApplied={sp.done === "applied"} m={m} />}
    </div>
  );
}

function DraftBody({ view, m }: { view: BankView; m: string }) {
  const { batch, rows, counts } = view;
  const toApply = rows.filter((r) => r.status === "new" || r.status === "changed");
  const unmatched = rows.filter((r) => r.status === "unmatched");
  const bad = rows.filter((r) => r.status === "problem" || r.status === "duplicate");
  const same = rows.filter((r) => r.status === "same");
  const chosen = rows.filter((r) => r.how === "chosen");
  return (
    <>
      <div className="rounded-card border border-border bg-card p-4">
        <p className="font-bold">ファイルの {rows.length} 件を台帳に当てました</p>
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          <li>
            <Badge tone="green">新しく入る {counts.new}</Badge>
          </li>
          <li>
            <Badge tone="yellow">口座が変わる {counts.changed}</Badge>
          </li>
          <li>
            <Badge>今と同じ {counts.same}</Badge>
          </li>
          <li>
            <Badge tone="red">当たらない {counts.unmatched}</Badge>
          </li>
          {counts.problem + counts.duplicate > 0 && (
            <li>
              <Badge tone="red">入れられない {counts.problem + counts.duplicate}</Badge>
            </li>
          )}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">まだ台帳には何も書いていません。下で確かめて、チェックした人だけ入れます。口座番号は下 3 桁だけ出しています。</p>
      </div>

      <Section step="1" title="台帳に入れる人" aside={toApply.length > 0 ? <Badge tone="yellow">{toApply.length} 人</Badge> : null}>
        {toApply.length === 0 ? (
          <p className="text-sm text-muted-foreground">新しく入る人・口座が変わる人はいません。</p>
        ) : (
          <>
            {counts.changed > 0 && (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                <b>口座が変わる {counts.changed} 人は、最初はチェックを外しています。</b>
                {view.draft.source.kind === "zengin"
                  ? "先月の振込ファイルより台帳のほうが新しいことがあります（ドライバーから口座が変わったと聞いて直した など）。"
                  : "一覧より台帳のほうが新しいことがあります（ドライバーから口座が変わったと聞いて直した など）。"}
                ファイルの口座が正しいと確かめた人だけチェックしてください。違う口座に振り込まないためです。
              </p>
            )}
            <ActionForm
              action={bankApplyAction}
              submit="チェックした人の口座を台帳に入れる"
              variant="accent"
              buttonClassName="w-full sm:w-auto"
              pendingText="台帳に入れています…"
              confirm={
                <>
                  チェックした人の口座を台帳に書きます。口座が変わる人は、次に作る振込データから新しい口座になります（振込データの画面でも「口座が変わった人」として出ます）。チェックしなかった人は入れません（あとで入れるときは、ファイルを置き直してください）。
                </>
              }
              confirmSubmit="台帳に入れる"
            >
              <input type="hidden" name="batchId" value={batch.id} />
              <ul className="mb-3 divide-y divide-border rounded-card border border-border">
                {toApply.map((r) => (
                  <li key={r.index} className="p-3">
                    <label className="flex min-h-11 items-start gap-3">
                      {/* 新しく入る人は最初からチェック。口座が変わる人は、台帳のほうが新しいこともあるので、確かめてから自分でチェックする */}
                      <input type="checkbox" name="row" value={r.index} defaultChecked={r.status === "new"} className="mt-1 h-5 w-5 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <b>{r.driver!.name}</b>
                          {r.driver!.code && <span className="text-xs text-muted-foreground">{r.driver!.code}</span>}
                          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                          {r.how && <span className="text-xs text-muted-foreground">{HOW[r.how]}</span>}
                        </span>
                        <FileLine r={r} />
                        <Changes r={r} />
                        {r.input.notes.map((n) => (
                          <span key={n} className="mt-1 block text-xs text-muted-foreground">
                            {n}
                          </span>
                        ))}
                      </span>
                    </label>
                    <input type="hidden" name={`seen-${r.index}`} value={r.seen} />
                  </li>
                ))}
              </ul>
            </ActionForm>
          </>
        )}
        {chosen.length > 0 && (
          <div className="text-sm">
            <p className="font-bold">選んで当てた行</p>
            <ul className="mt-1 space-y-1">
              {chosen.map((r) => (
                <li key={r.index} className="flex flex-wrap items-center gap-2">
                  <span>
                    {r.input.where}（{r.input.holderKana || r.input.name}）→ {r.driver?.name}
                  </span>
                  <ActionForm action={bankAssignAction} submit="当て先を外す" variant="ghost" pendingText="外しています…">
                    <input type="hidden" name="batchId" value={batch.id} />
                    <input type="hidden" name="row" value={r.index} />
                    <input type="hidden" name="driverId" value="" />
                  </ActionForm>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section step="2" title="当たらなかった行" aside={unmatched.length > 0 ? <Badge tone="red">{unmatched.length} 件</Badge> : <Badge tone="green">なし</Badge>}>
        {unmatched.length === 0 ? (
          <p className="text-sm text-muted-foreground">すべての行が台帳のドライバーに当たりました。</p>
        ) : (
          <>
            <p className="text-sm">
              名義のカナ・名前・番号のどれでも台帳に当たらなかった行です。台帳にいる人なら、選ぶとその人の口座として上に出ます（まだ書きません）。台帳にまだいない人は、先に設定の「ドライバー」で登録してください。
            </p>
            <ul className="divide-y divide-border rounded-card border border-border">
              {unmatched.map((r) => (
                <li key={r.index} className="space-y-2 p-3">
                  <FileLine r={r} />
                  {r.candidates.length > 0 && (
                    <p className="text-xs text-warning">同じ読みの方が {r.candidates.length} 人います（{r.candidates.map((c) => c.name).join("・")}）。どちらか選んでください</p>
                  )}
                  <ActionForm action={bankAssignAction} submit="この人の口座にする" pendingText="当てています…" className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <input type="hidden" name="batchId" value={batch.id} />
                    <input type="hidden" name="row" value={r.index} />
                    <select
                      name="driverId"
                      required
                      defaultValue={r.candidates[0]?.id ?? ""}
                      aria-label={`${r.input.where}の口座の持ち主`}
                      className="block min-h-11 w-full rounded-lg border border-border bg-card px-3 text-base sm:w-72"
                    >
                      <option value="">ドライバーを選ぶ</option>
                      {view.drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code ? `${d.code} ` : ""}
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {bad.length > 0 && (
        <Section title="入れられない行">
          <ul className="divide-y divide-border rounded-card border border-border">
            {bad.map((r) => (
              <li key={r.index} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {r.driver && <b>{r.driver.name}</b>}
                  <Badge tone="red">{STATUS[r.status].label}</Badge>
                </div>
                <FileLine r={r} />
                <ul className="mt-1 list-disc pl-5 text-sm text-danger">
                  {r.status === "duplicate" && <li>{r.driver?.name}さんの口座が、ファイルに 2 行以上あります。正しい 1 行だけのファイルにして置き直してください</li>}
                  {r.input.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {same.length > 0 && (
        <details className="rounded-card border border-border bg-card p-4">
          <summary className="min-h-11 cursor-pointer py-2 font-bold">今の台帳と同じ人を見る（{same.length} 人）</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {same.map((r) => (
              <li key={r.index}>
                {r.driver?.name}：{r.input.bankCode}-{r.input.branchCode} {maskAccount(r.input.accountNumber)}
              </li>
            ))}
          </ul>
        </details>
      )}

      <ActionForm
        action={bankDiscardAction}
        submit="この取り込みをやめる"
        variant="ghost"
        confirm="この取り込みをやめます（台帳には何も書きません）。"
        confirmSubmit="やめる"
        pendingText="やめています…"
      >
        <input type="hidden" name="batchId" value={batch.id} />
        <input type="hidden" name="month" value={m} />
      </ActionForm>
    </>
  );
}

function DoneBody({ view, justApplied, m }: { view: BankView; justApplied: boolean; m: string }) {
  const { batch, draft } = view;
  if (batch.status === "applied" && draft.applied) {
    const a = draft.applied;
    return (
      <>
        {justApplied && (
          <Notice tone="ok">
            台帳に入れました（新しく {a.created} 人・口座の変更 {a.updated} 人）。変えた記録は「操作の記録」に残っています（口座番号は下 3 桁だけ）。
          </Notice>
        )}
        <Section title="台帳に入れた人">
          <p className="text-sm">{dateTime.format(new Date(a.at))}に台帳に入れました。</p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {a.drivers.map((d) => (
              <li key={d.id}>
                {d.name}
                <span className="ml-1 text-xs text-muted-foreground">（{d.status === "new" ? "新しく入れた" : "口座を変えた"}）</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Link href={`/transfer?m=${m}`} className={buttonClass("primary")}>
              振込データへ →
            </Link>
            <Link href="/settings/drivers" className={buttonClass("secondary")}>
              ドライバーの台帳を見る
            </Link>
          </div>
        </Section>
      </>
    );
  }
  return (
    <Section title="やめた取り込み">
      <p className="text-sm">この口座の取り込みはやめました。台帳には何も書いていません。</p>
      <Link href={`/import?m=${m}&kind=bank`} className={buttonClass("secondary")}>
        ファイルを置き直す
      </Link>
    </Section>
  );
}
