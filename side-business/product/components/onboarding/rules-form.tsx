"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Button, Input, NumberInput, Select } from "@/components/ui";
import { createRulesAction, type CreateRulesState } from "~/app/(app)/onboarding/actions";
import { checkRule, KIND_LABEL, KIND_UNIT, RULE_TEMPLATES, type RuleInput, type RuleKind } from "~/server/features/onboarding/rules";

const FL_QA = "https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html";

type Row = RuleInput & { key: string; use: boolean; custom: boolean };

function templateRows(taken: Set<string>): Row[] {
  return RULE_TEMPLATES.filter((t) => !taken.has(t.name)).map((t) => ({
    key: t.id,
    use: false,
    custom: false,
    name: t.name,
    kind: t.kind,
    value: "",
    taxable: t.taxable,
    onlyWhenWorked: t.onlyWhenWorked,
    agreedInWriting: false,
    agreedOn: "",
    basis: "",
  }));
}

/** 控除のルール：ひな形から選び、取引条件に書いて合意しているかに印を付ける */
export function RulesForm({ existing, nextHref, nextTitle = "取引条件の明示" }: { existing: string[]; nextHref: string; nextTitle?: string }) {
  const [round, setRound] = useState(0);
  return <RulesFormInner key={round} existing={existing} nextHref={nextHref} nextTitle={nextTitle} onAgain={() => setRound((n) => n + 1)} />;
}

function RulesFormInner({ existing, nextHref, nextTitle, onAgain }: { existing: string[]; nextHref: string; nextTitle: string; onAgain: () => void }) {
  const taken = new Set(existing);
  const [rows, setRows] = useState<Row[]>(() => templateRows(taken));
  const [asking, setAsking] = useState(false);
  const [state, action, pending] = useActionState<CreateRulesState, FormData>(createRulesAction, undefined);

  const used = rows.filter((r) => r.use);
  const checks = used.map((r) => ({ row: r, ...checkRule(r) }));
  const errors = checks.flatMap((c) => c.errors);
  const notAgreed = used.filter((r) => !r.agreedInWriting);
  const set = (key: string, patch: Partial<Row>) => {
    setAsking(false);
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const addCustom = () =>
    setRows((prev) => [
      ...prev,
      { key: `custom-${prev.length}-${Date.now()}`, use: true, custom: true, name: "", kind: "fixed", value: "", taxable: true, onlyWhenWorked: true, agreedInWriting: false, agreedOn: "", basis: "" },
    ]);
  const submit = () => {
    const form = new FormData();
    form.set("rules", JSON.stringify(used.map(({ name, kind, value, taxable, onlyWhenWorked, agreedInWriting, agreedOn, basis }) => ({ name, kind, value, taxable, onlyWhenWorked, agreedInWriting, agreedOn, basis }))));
    startTransition(() => action(form));
  };

  if (state?.ok && state.data) {
    const r = state.data;
    return (
      <div role="status" className="space-y-3 rounded-card border border-success/40 bg-success/10 p-4">
        <p className="text-lg font-bold text-success">{r.created > 0 ? `控除のルールを ${r.created} 件登録しました` : "新しく登録した控除はありません"}</p>
        {r.skipped.length > 0 && <p className="text-sm">同じ名前のルールがすでにあった {r.skipped.join("、")} は登録していません。</p>}
        {r.notAgreed.length > 0 && (
          <p className="text-sm">
            「{r.notAgreed.join("」「")}」は「取引条件に書いて合意している」に印がありません。取引条件に書いてあるかの確認をおすすめします（見張り番が毎月お知らせします）。
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href={nextHref} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground no-underline">
            次の手順「{nextTitle}」へ →
          </Link>
          <Button variant="secondary" onClick={onAgain}>
            続けて足す
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {rows.map((r) => {
          const c = r.use ? checkRule(r) : null;
          const kind = r.kind as RuleKind;
          const hint = RULE_TEMPLATES.find((t) => t.id === r.key)?.hint;
          return (
            <li key={r.key} className={`rounded-lg border bg-card p-3 ${r.use ? "border-foreground" : "border-border"}`}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={r.use} onChange={(e) => set(r.key, { use: e.target.checked })} className="h-5 w-5 shrink-0" />
                <span className="font-bold">{r.custom ? "自分で名前を付ける控除" : r.name}</span>
                <span className="text-xs text-muted-foreground">{KIND_LABEL[kind]}</span>
              </label>
              {hint && !r.use && <p className="ml-8 text-xs text-muted-foreground">{hint}</p>}
              {r.use && (
                <div className="mt-2 space-y-3 sm:ml-8">
                  <div className="grid gap-2 sm:grid-cols-3">
                    {r.custom && (
                      <>
                        <label className="block text-xs">
                          <span className="text-muted-foreground">控除の名前</span>
                          <Input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="例：端末代" maxLength={40} />
                        </label>
                        <label className="block text-xs">
                          <span className="text-muted-foreground">引き方</span>
                          <Select value={r.kind} onChange={(e) => set(r.key, { kind: e.target.value })}>
                            {(Object.keys(KIND_LABEL) as RuleKind[]).map((k) => (
                              <option key={k} value={k}>
                                {KIND_LABEL[k]}
                              </option>
                            ))}
                          </Select>
                        </label>
                      </>
                    )}
                    <label className="block text-xs">
                      <span className="text-muted-foreground">{kind === "percent" ? "率" : kind === "fixed" ? "毎月の額" : "1 数量あたりの額"}（{KIND_UNIT[kind]}）</span>
                      <NumberInput value={r.value} onChange={(e) => set(r.key, { value: e.target.value })} placeholder={RULE_TEMPLATES.find((t) => t.id === r.key)?.example ?? ""} />
                    </label>
                  </div>
                  <div className="flex flex-col gap-1 text-sm">
                    <label className="flex min-h-11 cursor-pointer items-center gap-3">
                      <input type="checkbox" checked={r.agreedInWriting} onChange={(e) => set(r.key, { agreedInWriting: e.target.checked })} className="h-5 w-5 shrink-0" />
                      <span className="font-bold">取引条件に書いて合意している</span>
                    </label>
                    {r.agreedInWriting && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs">
                          <span className="text-muted-foreground">合意した日（分かれば）</span>
                          <Input type="date" value={r.agreedOn} onChange={(e) => set(r.key, { agreedOn: e.target.value })} />
                        </label>
                        <label className="block text-xs">
                          <span className="text-muted-foreground">根拠（例：業務委託契約 第8条）</span>
                          <Input value={r.basis} onChange={(e) => set(r.key, { basis: e.target.value })} maxLength={200} />
                        </label>
                      </div>
                    )}
                    <label className="flex min-h-11 cursor-pointer items-center gap-3">
                      <input type="checkbox" checked={r.taxable} onChange={(e) => set(r.key, { taxable: e.target.checked })} className="h-5 w-5 shrink-0" />
                      <span>消費税がかかる（会社の売上として消費税を足して引く）</span>
                    </label>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3">
                      <input type="checkbox" checked={r.onlyWhenWorked} onChange={(e) => set(r.key, { onlyWhenWorked: e.target.checked })} className="h-5 w-5 shrink-0" />
                      <span>稼働があった月だけ引く</span>
                    </label>
                  </div>
                  {c && c.errors.length > 0 && r.value && <p className="text-sm text-danger">{c.errors.join("。")}</p>}
                  {c && c.warnings.length > 0 && (
                    <p className={`rounded-lg border p-2 text-sm ${r.agreedInWriting ? "border-border text-muted-foreground" : "border-warning/40 bg-warning/10"}`}>
                      {c.warnings[0]}
                      {!r.agreedInWriting && (
                        <>
                          {" "}
                          <a href={FL_QA} target="_blank" rel="noopener noreferrer">
                            公正取引委員会 フリーランス法 Q&amp;A
                          </a>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Button variant="secondary" onClick={addCustom} className="w-full sm:w-auto">
        ＋ ほかの控除を足す
      </Button>
      <p className="text-xs text-muted-foreground">消費税がかかるかの初期値は、よくある扱いを置いています。会社の扱いは、顧問の税理士さんと確かめてください。</p>

      {state && !state.ok && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      {asking ? (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p>
            「取引条件に書いて合意している」に印が無い控除が {notAgreed.length} 件あります（{notAgreed.map((r) => r.name || "名前なし").join("、")}）。
            このまま登録すると、見張り番が毎月お知らせします。登録しますか？
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={submit} disabled={pending}>
              {pending ? "登録しています…" : "このまま登録する"}
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)} disabled={pending}>
              戻って直す
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => (notAgreed.length ? setAsking(true) : submit())}
          disabled={pending || used.length === 0 || errors.length > 0}
          className="w-full sm:w-auto"
        >
          {pending ? "登録しています…" : used.length ? `${used.length} 件を登録する` : "使う控除に印を付けてください"}
        </Button>
      )}
      {used.length > 0 && errors.length > 0 && <p className="text-sm text-danger">入れていない額や、直すところがあります（{errors[0]}）。</p>}
    </div>
  );
}
