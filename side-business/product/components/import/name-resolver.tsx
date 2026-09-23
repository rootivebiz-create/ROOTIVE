"use client";

import { useState } from "react";
import { Button, Field, Input, NumberInput, Select } from "@/components/ui";
import { ActionForm, ResultLine, useFormAction, type FormAction } from "~/components/import/action-form";

export type NameGroupView = {
  key: string;
  raw: string;
  spellings: string[];
  rows: number;
  qty: number;
  match: { id: string; name: string } | null;
  needsCheck: boolean;
  skipped: boolean;
  candidates: { id: string; name: string }[];
};

type Kind = "driver" | "project";

function Hidden({ batchId, kind, groupKey, action }: { batchId: string; kind: Kind; groupKey: string; action: string }) {
  return (
    <>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="key" value={groupKey} />
      <input type="hidden" name="action" value={action} />
    </>
  );
}

/**
 * 当たらなかった名前 1 つぶん：「どれのことですか？」
 * 候補を選ぶと、その書き方を別名として覚える（来月から自動で当たる）。
 */
export function NameResolver({
  action,
  batchId,
  kind,
  group,
  all,
  clients,
  defaults,
}: {
  action: FormAction;
  batchId: string;
  kind: Kind;
  group: NameGroupView;
  /** 候補にない人・案件から選ぶとき */
  all: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  /** 新しく登録するときの下書き（案件の名前・単位） */
  defaults: { name: string; unit: string };
}) {
  const [creating, setCreating] = useState(false);
  const noun = kind === "driver" ? "人" : "案件";
  const qty = group.qty.toLocaleString("ja-JP");

  return (
    <li className="space-y-3 p-4">
      <div>
        <p className="font-bold">
          「{group.raw}」
          {group.spellings.length > 1 && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">（ほかの書き方：{group.spellings.slice(1).join("、")}）</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {group.rows}行・数量の合計 {qty}
        </p>
      </div>

      {group.skipped ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">取り込まないことにしています。</span>
          <ActionForm action={action} submit="取り込む対象に戻す" pendingText="戻しています…">
            <Hidden batchId={batchId} kind={kind} groupKey={group.key} action="unskip" />
          </ActionForm>
        </div>
      ) : (
        <>
          {group.match && group.needsCheck && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                名前の一部が「<b>{group.match.name}</b>」と同じです。この{noun}で合っていますか？
              </span>
              <ActionForm action={action} submit="合っている（覚える）" variant="primary" pendingText="覚えています…">
                <Hidden batchId={batchId} kind={kind} groupKey={group.key} action="match" />
                <input type="hidden" name="targetId" value={group.match.id} />
              </ActionForm>
            </div>
          )}
          {(!group.match || group.needsCheck) && (
            <div>
              <p className="text-sm">
                {group.match
                  ? `違うときは、どの${noun}か選んでください`
                  : group.candidates.length > 0
                    ? `どの${noun}のことですか？`
                    : `台帳に近い名前が見つかりませんでした。一覧から選ぶか、新しく登録してください`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.candidates
                  .filter((c) => c.id !== group.match?.id)
                  .map((c) => (
                    <ActionForm key={c.id} action={action} submit={c.name} pendingText="覚えています…">
                      <Hidden batchId={batchId} kind={kind} groupKey={group.key} action="match" />
                      <input type="hidden" name="targetId" value={c.id} />
                    </ActionForm>
                  ))}
              </div>
              {all.length > group.candidates.length && <OtherPicker action={action} batchId={batchId} kind={kind} groupKey={group.key} all={all} noun={noun} />}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
              {creating ? "登録をやめる" : `新しい${noun}として登録する`}
            </Button>
            <ActionForm action={action} submit="取り込まない" variant="ghost" pendingText="外しています…">
              <Hidden batchId={batchId} kind={kind} groupKey={group.key} action="skip" />
            </ActionForm>
          </div>
          {creating &&
            (kind === "driver" ? (
              <CreateDriver action={action} batchId={batchId} group={group} />
            ) : (
              <CreateProject action={action} batchId={batchId} group={group} clients={clients} defaults={defaults} />
            ))}
        </>
      )}
    </li>
  );
}

function OtherPicker({
  action,
  batchId,
  kind,
  groupKey,
  all,
  noun,
}: {
  action: FormAction;
  batchId: string;
  kind: Kind;
  groupKey: string;
  all: { id: string; name: string }[];
  noun: string;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  return (
    <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
      <Hidden batchId={batchId} kind={kind} groupKey={groupKey} action="match" />
      <div className="sm:w-72">
        <Field label={`ほかの${noun}から選ぶ`}>
          <Select name="targetId" defaultValue="">
            <option value="" disabled>
              選んでください
            </option>
            {all.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "覚えています…" : "この" + noun + "にする"}
      </Button>
      <ResultLine state={state} />
    </form>
  );
}

function CreateDriver({ action, batchId, group }: { action: FormAction; batchId: string; group: NameGroupView }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <Hidden batchId={batchId} kind="driver" groupKey={group.key} action="create" />
      <Field label="名前" hint={fe.name ?? "明細に出る名前です"}>
        <Input name="name" defaultValue={group.raw} required maxLength={60} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="フリガナ（任意）" hint={fe.kana}>
          <Input name="kana" maxLength={60} />
        </Field>
        <Field label="社内の番号（任意）" hint={fe.code ?? "Excel に番号の列があれば、次から番号で当たります"}>
          <Input name="code" maxLength={30} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">口座・登録番号などは、あとで台帳から入れられます（明細や振込を作るときに案内します）。</p>
      <Button type="submit" disabled={pending}>
        {pending ? "登録しています…" : "登録する"}
      </Button>
      <ResultLine state={state} />
    </form>
  );
}

function CreateProject({
  action,
  batchId,
  group,
  clients,
  defaults,
}: {
  action: FormAction;
  batchId: string;
  group: NameGroupView;
  clients: { id: string; name: string }[];
  defaults: { name: string; unit: string };
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <Hidden batchId={batchId} kind="project" groupKey={group.key} action="create" />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <Field label="案件の名前" hint={fe.name}>
          <Input name="name" defaultValue={defaults.name} required maxLength={60} />
        </Field>
        <Field label="単位" hint={fe.unit ?? "個・日・時間 など"}>
          <Input name="unit" defaultValue={defaults.unit} required maxLength={10} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="受注単価（税抜・元請から）" hint={fe.billRate ?? "あとで直せます。利益の計算に使います"}>
          <NumberInput name="billRate" placeholder="例：190" />
        </Field>
        <Field label="支払単価（税抜・ドライバーへ）" hint={fe.payRate ?? "明細の金額はこの単価 × 数量です"}>
          <NumberInput name="payRate" placeholder="例：150" />
        </Field>
      </div>
      {clients.length > 0 && (
        <Field label="元請（任意）" hint={fe.clientId}>
          <Select name="clientId" defaultValue="">
            <option value="">選ばない</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "登録しています…" : "登録する"}
      </Button>
      <ResultLine state={state} />
    </form>
  );
}
