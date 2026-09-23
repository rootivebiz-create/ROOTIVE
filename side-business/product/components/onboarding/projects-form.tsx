"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Button, Input, NumberInput } from "@/components/ui";
import {
  createProjectsAction,
  previewProjectsAction,
  type CreateProjectsState,
  type ProjectPreviewState,
} from "~/app/(app)/onboarding/actions";
import { Badge } from "~/components/page";
import { projectRowsFromPaste, UNIT_CHOICES, type ProjectRowInput } from "~/server/features/onboarding/projects-parse";

const EMPTY: ProjectRowInput = { client: "", project: "", unit: "", billRate: "", payRate: "" };
const blankRows = (n: number) => Array.from({ length: n }, () => ({ ...EMPTY }));

/** 元請と案件を、表に書くように入れる（Excel から 5 列を貼り付けても入る） */
export function ProjectsForm({ clients }: { clients: string[] }) {
  const [round, setRound] = useState(0);
  return <ProjectsFormInner key={round} clients={clients} onAgain={() => setRound((n) => n + 1)} />;
}

function ProjectsFormInner({ clients, onAgain }: { clients: string[]; onAgain: () => void }) {
  const [rows, setRows] = useState<ProjectRowInput[]>(blankRows(3));
  const [paste, setPaste] = useState("");
  const [checkedJson, setCheckedJson] = useState<string | null>(null);
  const [preview, previewAction, previewing] = useActionState<ProjectPreviewState, FormData>(previewProjectsAction, undefined);
  const [created, createAction, creating] = useActionState<CreateProjectsState, FormData>(createProjectsAction, undefined);

  const json = JSON.stringify(rows);
  // 確かめたあとに表を変えたら、もう一度確かめてもらう
  const data = preview?.ok && checkedJson === json ? preview.data : undefined;
  const statusOf = (i: number) => data?.rows.find((r) => r.rowNo === i + 1);

  const set = (i: number, key: keyof ProjectRowInput, value: string) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const remove = (i: number) => setRows((prev) => (prev.length <= 1 ? blankRows(1) : prev.filter((_, j) => j !== i)));
  const fromPaste = () => {
    const parsed = projectRowsFromPaste(paste);
    if (parsed.length === 0) return;
    setRows((prev) => [...prev.filter((r) => Object.values(r).some((v) => v.trim())), ...parsed]);
    setPaste("");
  };
  const check = () => {
    const form = new FormData();
    form.set("rows", json);
    setCheckedJson(json);
    startTransition(() => previewAction(form));
  };
  const save = () => {
    const form = new FormData();
    form.set("rows", json);
    startTransition(() => createAction(form));
  };

  if (created?.ok && created.data) {
    const r = created.data;
    return (
      <div role="status" className="space-y-3 rounded-card border border-success/40 bg-success/10 p-4">
        <p className="text-lg font-bold text-success">
          案件 {r.projects} 件を登録しました{r.clients > 0 ? `（元請 ${r.clients} 社を新しく作りました）` : ""}
        </p>
        {r.skipped > 0 && <p className="text-sm">すでにあった {r.skipped} 件は登録していません。</p>}
        {r.rejected.length > 0 && <p className="text-sm text-danger">登録しなかった行：{r.rejected.join("／")}</p>}
        <p className="text-sm">ドライバーごとに支払単価が違う人は、あとで設定のドライバーから入れられます。</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/onboarding/rules" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground no-underline">
            次の手順「控除のルール」へ →
          </Link>
          <Button variant="secondary" onClick={onAgain}>
            続けて入れる
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <datalist id="client-names">
        {clients.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="unit-choices">
        {UNIT_CHOICES.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <details className="rounded-lg border border-border bg-card p-3">
        <summary className="min-h-11 cursor-pointer py-2 font-bold">Excel から貼り付ける（元請名・案件名・単位・受注単価・支払単価の 5 列）</summary>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          spellCheck={false}
          aria-label="Excel から貼り付ける"
          placeholder={"A物流\t宅配（個建て）\t個\t190\t150\nA物流\t企業配（日当）\t日\t22000\t18000"}
          className="mt-2 block w-full rounded-lg border border-border bg-card p-3 font-mono text-sm text-foreground focus:border-foreground"
        />
        <Button variant="secondary" onClick={fromPaste} disabled={!paste.trim()} className="mt-2 w-full sm:w-auto">
          下の表に入れる
        </Button>
      </details>

      <ol className="space-y-3">
        {rows.map((r, i) => {
          const st = statusOf(i);
          return (
            <li key={i} className={`rounded-lg border bg-card p-3 ${st?.status === "error" ? "border-danger/50" : "border-border"}`}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-bold">{i + 1} 行目</span>
                {st && <Badge tone={st.status === "new" ? "green" : st.status === "duplicate" ? "gray" : "red"}>{st.status === "new" ? "登録できます" : st.status === "duplicate" ? "すでにあります" : "直すところがあります"}</Badge>}
                <Button variant="ghost" onClick={() => remove(i)} className="ml-auto" aria-label={`${i + 1} 行目を消す`}>
                  消す
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1.2fr_1.5fr_0.6fr_0.8fr_0.8fr]">
                <label className="block text-xs">
                  <span className="text-muted-foreground">元請名</span>
                  <Input value={r.client} onChange={(e) => set(i, "client", e.target.value)} list="client-names" placeholder="A物流" />
                </label>
                <label className="block text-xs">
                  <span className="text-muted-foreground">案件名</span>
                  <Input value={r.project} onChange={(e) => set(i, "project", e.target.value)} placeholder="宅配（個建て）" />
                </label>
                <label className="block text-xs">
                  <span className="text-muted-foreground">単位</span>
                  <Input value={r.unit} onChange={(e) => set(i, "unit", e.target.value)} list="unit-choices" placeholder="個" />
                </label>
                <label className="block text-xs">
                  <span className="text-muted-foreground">受注単価（税抜）</span>
                  <NumberInput value={r.billRate} onChange={(e) => set(i, "billRate", e.target.value)} placeholder="190" />
                </label>
                <label className="block text-xs">
                  <span className="text-muted-foreground">支払単価（税抜）</span>
                  <NumberInput value={r.payRate} onChange={(e) => set(i, "payRate", e.target.value)} placeholder="150" />
                </label>
              </div>
              {st && (st.errors.length > 0 || st.warnings.length > 0) && (
                <ul className="mt-2 space-y-1 text-sm">
                  {st.errors.map((e) => (
                    <li key={e} className="text-danger">
                      {e}
                    </li>
                  ))}
                  {st.warnings.map((w) => (
                    <li key={w} className="text-muted-foreground">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      <Button variant="secondary" onClick={() => setRows((prev) => [...prev, { ...EMPTY }])} className="w-full sm:w-auto">
        ＋ 行を足す
      </Button>

      {preview && !preview.ok && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {preview.error}
        </p>
      )}
      {data && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p className="font-bold">
            登録できる {data.counts.new} 件・すでにある {data.counts.duplicate} 件・直すところがある {data.counts.error} 件
          </p>
          {data.newClients.length > 0 && <p className="mt-1">新しく作る元請：{data.newClients.join("、")}</p>}
        </div>
      )}
      {created && !created.ok && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {created.error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant={data ? "secondary" : "primary"} onClick={check} disabled={previewing} className="w-full sm:w-auto">
          {previewing ? "確かめています…" : "確かめる（まだ登録しません）"}
        </Button>
        {data && (
          <Button onClick={save} disabled={creating || data.counts.new === 0} className="w-full sm:w-auto">
            {creating ? "登録しています…" : `${data.counts.new} 件を登録する`}
          </Button>
        )}
      </div>
    </div>
  );
}
