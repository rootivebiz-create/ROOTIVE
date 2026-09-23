"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, Field, Input } from "@/components/ui";
import { createTermsAction } from "~/app/(app)/terms/actions";
import type { TermsFormInitial, TermsProjectChoice } from "~/server/features/terms";

/** 1 円未満も出す単価（152.5円） */
function rate(v: number): string {
  return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 4 }).format(v)}円`;
}

const textareaCls = "block w-full min-h-24 rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground focus:border-foreground";

/** 入力欄（誤りは赤で、ヒントは灰色で下に出す） */
function F({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <Field label={label} hint={error ? undefined : hint}>
        {children}
      </Field>
      {error && <p className="mt-1 text-xs font-bold text-danger">{error}</p>}
    </div>
  );
}

function Section({ title, children, note }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    // fieldset は既定で中身の幅より狭くならない（スマホで横にはみ出す）ので min-w-0 を付ける
    <fieldset className="min-w-0 space-y-3 rounded-card border border-border bg-card p-4">
      <legend className="px-1 text-base font-bold">{title}</legend>
      {note && <div className="text-sm text-muted-foreground">{note}</div>}
      {children}
    </fieldset>
  );
}

function Check({ name, checked, onChange, label, hint }: { name: string; checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
      <input type="checkbox" name={name} value="1" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} className="mt-1 size-5 shrink-0" />
      <span className="min-w-0">
        <span className="block font-bold">{label}</span>
        {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export type TermsFormPreview = {
  deductions: string[];
  paymentText: string;
  periodText: string;
  taxNote: string;
  feeByDriver: boolean;
  deemedText: string;
};

/**
 * 新しい版（版 n+1）を作るフォーム。台帳から入る事項（単価・控除・支払期日）は見本として出し、
 * 書き換えるのは文で書く事項（業務の内容・場所・期間・受け取る日・その他）と、条項の有無だけ。
 * 送るときは onSubmit から（誤りがあっても入力が消えない）。
 */
export function TermsForm({
  driverId,
  baseVersion,
  projects,
  initial,
  today,
  preview,
  links,
  startOpen,
}: {
  driverId: string;
  baseVersion: number;
  projects: TermsProjectChoice[];
  initial: TermsFormInitial;
  today: string;
  preview: TermsFormPreview;
  links: { rules: string; company: string; rates: string; ntaQa: string };
  /** 最初から開いておくか（まだ版が無い・条件が変わったとき）。保存したあとも、開いたまま結果を出す */
  startOpen: boolean;
}) {
  const [state, dispatch, pending] = useActionState(createTermsAction, undefined);
  const [open, setOpen] = useState(startOpen);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.projectIds));
  const [deemed, setDeemed] = useState(initial.deemed);
  const [sub, setSub] = useState(initial.isSubcontract);
  const topRef = useRef<HTMLDivElement>(null);
  const fe: Record<string, string> = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  useEffect(() => {
    if (state) topRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [state]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const chosen = projects.filter((p) => selected.has(p.id));
  const nextVersion = baseVersion + 1;

  if (!open) {
    return (
      <div className="rounded-card border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">いまの版の中身は、台帳と同じです。場所・期間・条項などを直すときだけ、新しい版を作ってください。</p>
        <Button variant="secondary" className="mt-3" onClick={() => setOpen(true)}>
          直して新しい版（版 {nextVersion}）を作る
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={`版 ${nextVersion} を作る`}>
      <input type="hidden" name="driverId" value={driverId} />
      <input type="hidden" name="baseVersion" value={baseVersion} />
      <div ref={topRef}>
        {state && !state.ok && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state?.ok && state.message && (
          <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
            {state.message}
          </p>
        )}
      </div>

      <Section
        title="報酬（案件と単価）"
        note={
          <>
            この人が行う案件を選びます。単価はドライバーごとの単価があればその額（税抜）です。単価を変えるときは
            <a href={links.rates} className="mx-1">
              設定 → 単価
            </a>
            から。
          </>
        }
      >
        {projects.length === 0 ? (
          <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            案件がまだありません。報酬の額を書くために、先に設定 → 案件で登録してください。
          </p>
        ) : (
          <ul className="space-y-2">
            {projects.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-3">
                  <input
                    type="checkbox"
                    name="projectIds"
                    value={p.id}
                    checked={selected.has(p.id)}
                    onChange={(e) => toggle(p.id, e.currentTarget.checked)}
                    className="size-5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-bold">{p.name}</span>
                    {p.client && <span className="ml-2 text-xs text-muted-foreground">{p.client}</span>}
                    {p.recent && <span className="ml-2 text-xs text-muted-foreground">最近の稼働あり</span>}
                    {!p.active && <span className="ml-2 text-xs text-warning">無効にした案件</span>}
                  </span>
                  <span className="num whitespace-nowrap text-sm font-bold">
                    {rate(p.payRate)}
                    <span className="ml-1 font-normal text-muted-foreground">/{p.unit}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {fe.projectIds && <p className="text-xs font-bold text-danger">{fe.projectIds}</p>}
        <p className="text-sm">
          明示書に入る案件：{chosen.length ? chosen.map((p) => p.name).join("・") : <span className="font-bold text-danger">まだ選ばれていません</span>}
        </p>
        <p className="text-xs text-muted-foreground">{preview.taxNote}</p>
      </Section>

      <Section title="仕事の中身">
        <F label="給付の内容（どんな仕事か）" error={fe.serviceDescription} hint="例：貨物軽自動車を使った荷物の配送業務（上の案件）">
          <textarea name="serviceDescription" defaultValue={initial.serviceDescription} maxLength={500} className={textareaCls} />
        </F>
        <F label="給付を受け取る場所" error={fe.place} hint="例：A物流 ○○センターで荷物を受け取り、指定された配送先へ届ける">
          <textarea name="place" defaultValue={initial.place} maxLength={300} className={textareaCls} />
        </F>
        <F label="給付を受け取る日（または期間）" error={fe.receipt} hint="例：業務を行った日ごとに、その日の業務の完了をもって受け取ったものとします">
          <textarea name="receipt" defaultValue={initial.receipt} maxLength={300} className={textareaCls} />
        </F>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="業務の期間：始まり" error={fe.periodFrom}>
            <Input type="date" name="periodFrom" defaultValue={initial.periodFrom} required />
          </F>
          <F label="業務の期間：終わり（任意）" error={fe.periodTo} hint="決めていなければ空のまま（「終わりの日は定めていません」と書きます）">
            <Input type="date" name="periodTo" defaultValue={initial.periodTo} />
          </F>
          <F label="委託した日（任意）" error={fe.commissionedOn} hint="この条件で仕事を頼んだ日。空なら明示した日と同じにします">
            <Input type="date" name="commissionedOn" defaultValue={initial.commissionedOn} max={today} />
          </F>
        </div>
      </Section>

      <Section
        title="台帳から入るもの（ここでは変えません）"
        note={
          <>
            控除は
            <a href={links.rules} className="mx-1">
              設定 → 控除のルール
            </a>
            、支払日と振込手数料は
            <a href={links.company} className="mx-1">
              設定 → 会社
            </a>
            で変えます。変えたら、ここで新しい版を作ってください。
          </>
        }
      >
        <div className="text-sm">
          <p className="font-bold">報酬から差し引くもの（控除）</p>
          {preview.deductions.length ? (
            <ul className="mt-1 space-y-1">
              {preview.deductions.map((d, i) => (
                <li key={i} className="break-words">
                  ・{d}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">ありません</p>
          )}
        </div>
        <div className="text-sm">
          <p className="font-bold">支払期日</p>
          <p className="mt-1 break-words">{preview.paymentText}</p>
          <p className="text-muted-foreground">締めの期間：{preview.periodText}</p>
        </div>
        <div className="text-sm">
          <p className="font-bold">振込手数料</p>
          <p className={preview.feeByDriver ? "mt-1 font-bold text-danger" : "mt-1"}>
            {preview.feeByDriver ? "ドライバーの負担（振込額から差し引く）設定になっています" : "会社が負担します"}
          </p>
        </div>
      </Section>

      <Section title="条項">
        <Check
          name="deemed"
          checked={deemed}
          onChange={setDeemed}
          label="明細のみなし確認の条項を入れる"
          hint="支払明細を送ってから一定の日数のうちに連絡が無ければ、内容を確認したものとする条項です。明細の「みなし確認」は、この条項が取引条件の記録にある人だけに出します。"
        />
        {deemed && (
          <div className="space-y-1 rounded-lg border border-border bg-muted p-3 text-sm">
            <p>入る文：{preview.deemedText}</p>
            <p className="text-xs text-muted-foreground">
              仕入明細書の相手方の確認のしかたの 1 つとして、国税庁のインボイス Q&A（問86）に取り上げられている方法です。扱いは税理士とご確認ください。
              <a href={links.ntaQa} target="_blank" rel="noopener noreferrer" className="ml-1">
                国税庁 インボイス Q&A
              </a>
            </p>
          </div>
        )}
        <Check
          name="isSubcontract"
          checked={sub}
          onChange={setSub}
          label="再委託（元請などから受けた仕事を、この人に頼む）"
          hint="再委託のときは、その旨・元委託者の名前・元委託の支払期日も明示します。支払期日を元委託の支払期日から 30 日の範囲で決める特例（フリーランス法 第4条）の前提になる項目です。使うかどうかは専門家にご確認ください。"
        />
        {sub && (
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="元委託者の名前" error={fe.originalClient} hint="例：A物流株式会社">
              <Input name="originalClient" defaultValue={initial.originalClient} maxLength={100} autoComplete="off" />
            </F>
            <F label="元委託の支払期日" error={fe.originalPayDate} hint="例：毎月末日締め・翌月末日払い">
              <Input name="originalPayDate" defaultValue={initial.originalPayDate} maxLength={100} autoComplete="off" />
            </F>
          </div>
        )}
        <F
          label="契約書など、別の書面で明示している場合の名前（任意）"
          error={fe.documentName}
          hint="例：業務委託契約書（2026年4月1日）。この明示書は、その書面の内容を台帳からまとめたものとして出します"
        >
          <Input name="documentName" defaultValue={initial.documentName} maxLength={100} autoComplete="off" />
        </F>
        <F label="その他（任意）" error={fe.other} hint="例：業務に使う車両は受託者が用意します">
          <textarea name="other" defaultValue={initial.other} maxLength={1000} className={textareaCls} />
        </F>
      </Section>

      <Section title="明示した日">
        <F label="明示した日（ドライバーに渡す日）" error={fe.issuedOn} hint="今日送るなら今日のまま。あとの日付にはできません。台帳の「最初に明示した日」は、今より前の日付のときだけ動きます">
          <Input type="date" name="issuedOn" defaultValue={initial.issuedOn} max={today} required />
        </F>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || projects.length === 0}>
          {pending ? "保存しています…" : `版 ${nextVersion} として保存する`}
        </Button>
        <p className="text-xs text-muted-foreground">保存しても、前の版は書き換えずに残ります。</p>
      </div>
    </form>
  );
}
