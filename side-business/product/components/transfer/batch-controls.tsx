"use client";

import { useActionState, useState } from "react";
import { Button, Input } from "@/components/ui";
import { deleteTransferAction, setExecutedOnAction, type SimpleState } from "~/app/(app)/transfer/actions";

function Result({ state }: { state: SimpleState }) {
  if (!state) return null;
  if (!state.ok)
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
        {state.fieldErrors?.executedOn ? `（${state.fieldErrors.executedOn}）` : ""}
      </p>
    );
  return (
    <p role="status" className="text-sm text-success">
      {state.message}
    </p>
  );
}

/** 実際に振り込んだ日（締めたあとでも入れられる。支払日との比較に使う） */
export function ExecutedOnForm({ batchId, executedOn, suggested }: { batchId: string; executedOn: string | null; suggested: string }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(setExecutedOnAction, undefined);
  const [value, setValue] = useState(executedOn ?? "");
  const id = `executed-${batchId}`;
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="batchId" value={batchId} />
      <label htmlFor={id} className="block text-sm font-bold">
        実際に振り込んだ日
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id={id} type="date" name="executedOn" value={value} onChange={(e) => setValue(e.target.value)} className="w-auto min-w-0 flex-1 sm:max-w-48" />
        {!value && (
          <Button variant="ghost" onClick={() => setValue(suggested)} className="px-2">
            振込指定日を入れる
          </Button>
        )}
        <Button type="submit" variant="secondary" disabled={pending || value === (executedOn ?? "")}>
          {pending ? "保存中…" : value ? "記録する" : "日付を消す"}
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}

/** 振込データを取り消す（2 段階。振り込んだ日が入っていないものだけ） */
export function DeleteBatchButton({ batchId, fileName }: { batchId: string; fileName: string }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(deleteTransferAction, undefined);
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <div>
        <Button variant="ghost" onClick={() => setAsking(true)} className="text-danger">
          この振込データを取り消す
        </Button>
        <Result state={state} />
      </div>
    );
  return (
    <form action={action} className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-3">
      <input type="hidden" name="batchId" value={batchId} />
      <p className="text-sm">
        「{fileName}」を取り消します。銀行にまだ出していないときだけ取り消してください。取り消したことは操作の記録に残ります。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "取り消しています…" : "取り消す"}
        </Button>
        <Button variant="secondary" onClick={() => setAsking(false)}>
          やめる
        </Button>
      </div>
      <Result state={state} />
    </form>
  );
}
