"use client";

/**
 * 突合の画面の入力（ブラウザ側）。保存は app/(app)/reconcile/actions.ts の Server Action。
 * どれも useActionState で結果（成功・失敗・入力の誤り）をその場に出す。
 */
import { useActionState, useState } from "react";
import { Button, Field, Input, NumberInput, Select } from "@/components/ui";
import {
  deleteNoticeAction,
  loadSampleAction,
  rerunAction,
  setDriverMappingAction,
  setItemStatusAction,
  setLineMappingAction,
  updateNoticeMetaAction,
  uploadNoticeAction,
} from "~/app/(app)/reconcile/actions";
import { FormMessage } from "~/components/reconcile/bits";
import { ITEM_STATUSES, STATUS_LABEL, type ItemStatus } from "~/server/features/reconcile/labels";

const fileClass =
  "block w-full min-h-11 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-muted file:px-3 file:font-bold file:text-foreground";

// ---------------------------------------------------------------- 取り込み

export function UploadForm({
  clients,
  month,
  existing,
}: {
  clients: { id: string; name: string }[];
  /** 画面の月（YYYY-MM） */
  month: string;
  /** この月にお支払通知がもうある元請 */
  existing: { clientId: string; fileName: string }[];
}) {
  const [state, action, pending] = useActionState(uploadNoticeAction, undefined);
  const firstFree = clients.find((c) => !existing.some((e) => e.clientId === c.id)) ?? clients[0];
  const [clientId, setClientId] = useState(firstFree?.id ?? "");
  const [m, setM] = useState(month);
  const already = m === month ? existing.find((e) => e.clientId === clientId) : undefined;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="元請">
          <Select name="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="何月分か" hint="当社の稼働の月（例：10月に走った分なら 10月）">
          <Input type="month" name="month" value={m} onChange={(e) => setM(e.target.value)} required />
        </Field>
      </div>
      <Field label="お支払通知のファイル" hint="CSV か Excel（.xlsx）。元請の画面から落としたファイルを、そのまま上げられます（5MB まで）">
        <input type="file" name="file" accept=".csv,.xlsx,.xlsm,.tsv,.txt" required className={fileClass} />
      </Field>
      {already && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          この月のお支払通知は、すでに上げてあります（{already.fileName}）。上げ直すときは、下の「入れ替える」にチェックを入れてください。
        </p>
      )}
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="replace" value="1" className="mt-1 h-5 w-5 shrink-0" />
        <span>
          すでにあれば入れ替える
          <span className="block text-xs text-muted-foreground">行を新しいファイルの内容に入れ替えます。問い合わせの状態とメモは残ります。</span>
        </span>
      </label>
      <Button type="submit" className="w-full sm:w-auto" disabled={pending || clients.length === 0}>
        {pending ? "読み取っています…" : "取り込んで突き合わせる"}
      </Button>
    </form>
  );
}

export function SampleButton({ clientName }: { clientName: string }) {
  const [state, action, pending] = useActionState(loadSampleAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <Button type="submit" variant="accent" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "取り込んでいます…" : `見本のファイルで試す（${clientName}・2026年10月分）`}
      </Button>
      <p className="text-xs text-muted-foreground">
        架空の元請のお支払通知（Shift_JIS の CSV）を取り込みます。この月の{clientName}のお支払通知は、見本の内容に入れ替わります。
      </p>
    </form>
  );
}

// ---------------------------------------------------------------- 突き合わせ直す

export function RerunButton({ noticeId, label = "今の記録で突き合わせ直す" }: { noticeId: string; label?: string }) {
  const [state, action, pending] = useActionState(rerunAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="noticeId" value={noticeId} />
      <Button type="submit" disabled={pending}>
        {pending ? "突き合わせています…" : label}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- 差の状態とメモ

export function ItemStatusForm({ itemId, status, note }: { itemId: string; status: ItemStatus; note: string | null }) {
  const [state, action, pending] = useActionState(setItemStatusAction, undefined);
  return (
    <form action={action} className="mt-3 space-y-2 border-t border-border pt-3">
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <Field label="扱い">
          <Select name="status" defaultValue={status}>
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="メモ">
          <Input name="note" defaultValue={note ?? ""} maxLength={500} placeholder="例：10/31 メールで問い合わせ" />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- 行の当て方

export function LineMappingForm({
  noticeId,
  lineKey,
  current,
  remembered,
  suggestedProjectId,
  projects,
  clientName,
}: {
  noticeId: string;
  lineKey: string;
  /** 今の当て方（project:<id>・extra・ignore・""（未確認）） */
  current: string;
  remembered: boolean;
  suggestedProjectId: string | null;
  projects: { id: string; name: string; own: boolean }[];
  clientName: string | null;
}) {
  const [state, action, pending] = useActionState(setLineMappingAction, undefined);
  const own = projects.filter((p) => p.own);
  const others = projects.filter((p) => !p.own);
  const initial = current || (suggestedProjectId ? `project:${suggestedProjectId}` : "");
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="noticeId" value={noticeId} />
      <input type="hidden" name="key" value={lineKey} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1">
          <span className="sr-only">どれのことか</span>
          <Select name="target" defaultValue={initial} required>
            <option value="" disabled>
              どれのことか選んでください
            </option>
            {own.length > 0 && (
              <optgroup label={`${clientName ?? "この元請"}の案件`}>
                {own.map((p) => (
                  <option key={p.id} value={`project:${p.id}`}>
                    {p.name}
                    {p.id === suggestedProjectId ? "（近い名前）" : ""}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="ほかの案件">
                {others.map((p) => (
                  <option key={p.id} value={`project:${p.id}`}>
                    {p.name}
                    {p.id === suggestedProjectId ? "（近い名前）" : ""}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="案件ではない">
              <option value="extra">追加の料金（待機料・再配達・高速代など）</option>
              <option value="ignore">対象外（突き合わせに使わない）</option>
            </optgroup>
            {remembered && <option value="auto">覚えた決め方を消す（名前で当て直す）</option>}
          </Select>
        </label>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "保存中…" : "決める"}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function DriverMappingForm({
  noticeId,
  driverKey,
  current,
  remembered,
  drivers,
}: {
  noticeId: string;
  driverKey: string;
  current: string | null;
  remembered: boolean;
  drivers: { id: string; name: string; code: string | null }[];
}) {
  const [state, action, pending] = useActionState(setDriverMappingAction, undefined);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="noticeId" value={noticeId} />
      <input type="hidden" name="key" value={driverKey} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1">
          <span className="sr-only">どのドライバーか</span>
          <Select name="driverId" defaultValue={current ?? (remembered ? "none" : "")} required>
            <option value="" disabled>
              どのドライバーか選んでください
            </option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code ? `${d.code} ` : ""}
                {d.name}
              </option>
            ))}
            <option value="none">名簿にいない（ドライバーなしとして扱う）</option>
            {remembered && <option value="auto">覚えた決め方を消す（名前で当て直す）</option>}
          </Select>
        </label>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "保存中…" : "決める"}
        </Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- 入金の記録

export function NoticeMetaForm({ noticeId, paidOn, feeDeducted }: { noticeId: string; paidOn: string | null; feeDeducted: number }) {
  const [state, action, pending] = useActionState(updateNoticeMetaAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="noticeId" value={noticeId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="入金日" hint="元請から実際に振り込まれた日">
          <Input type="date" name="paidOn" defaultValue={paidOn ?? ""} />
        </Field>
        <Field label="差し引かれた手数料（円）" hint="振込手数料などで、入金が少なくなっていた額。無ければ 0">
          <NumberInput name="feeDeducted" defaultValue={feeDeducted ? String(feeDeducted) : ""} placeholder="0" />
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "保存中…" : "入金の記録を保存"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

// ---------------------------------------------------------------- 削除

export function DeleteNoticeForm({ noticeId, itemCount }: { noticeId: string; itemCount: number }) {
  const [state, action, pending] = useActionState(deleteNoticeAction, undefined);
  const [ok, setOk] = useState(false);
  return (
    <details className="rounded-card border border-danger/40 bg-card p-4">
      <summary className="flex min-h-11 cursor-pointer items-center font-bold text-danger">このお支払通知を削除する</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="noticeId" value={noticeId} />
        <p className="text-sm">
          お支払通知の行と、見つかった差（{itemCount}件）の状態・メモを削除します。元に戻せません（操作の記録には残ります）。
          ファイルを上げ直したいだけなら、削除せずに「すでにあれば入れ替える」で上げてください。状態とメモが残ります。
        </p>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" name="confirm" value="1" className="h-5 w-5" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          削除してよい
        </label>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-danger bg-card px-4 text-sm font-bold text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!ok || pending}
        >
          {pending ? "削除しています…" : "削除する"}
        </button>
        <FormMessage state={state} />
      </form>
    </details>
  );
}

// ---------------------------------------------------------------- 印刷

export function PrintButton({ label = "印刷・PDF にする" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
