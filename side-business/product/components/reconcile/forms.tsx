"use client";

/**
 * 突合の画面の入力（ブラウザ側）。保存は app/(app)/reconcile/actions.ts の Server Action。
 * どれも useActionState で結果（成功・失敗・入力の誤り）をその場に出す。
 * ファイル・貼り付け・メモのように打ち直しが大変な欄のあるフォームは、useFormAction（onSubmit から送る）で送る。
 * form の action に直接渡すと、断られたときも React が入力を空に戻し、選んだファイルやチェックが消えるため
 */
import { useActionState, useState } from "react";
import { Button, Field, Input, NumberInput, Select } from "@/components/ui";
import {
  deleteNoticeAction,
  loadSampleAction,
  removeNoticeFileAction,
  rerunAction,
  setDriverMappingAction,
  setItemStatusAction,
  setLineMappingAction,
  updateNoticeMetaAction,
  uploadNoticeAction,
} from "~/app/(app)/reconcile/actions";
import { useFormAction } from "~/components/form-field";
import { FormMessage } from "~/components/reconcile/bits";
import { SAME_CONTENT_OVERRIDE } from "~/server/features/reconcile/files";
import { closingSpan, dateJa, ITEM_STATUSES, monthJa, STATUS_LABEL, type ItemStatus } from "~/server/features/reconcile/labels";

const fileClass =
  "block w-full min-h-11 rounded-lg border border-border bg-card px-2 py-2 text-sm text-foreground file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-muted file:px-3 file:font-bold file:text-foreground";

// ---------------------------------------------------------------- 取り込み

/** ファイルを選ぶか、表を貼り付ける（PDF しか無いとき・画面の表をコピーしたとき）。サーバーは、ファイルがあればファイルを使う */
function FileOrPaste({ fileLabel, fileHint }: { fileLabel: string; fileHint: string }) {
  return (
    <div className="space-y-3">
      <Field label={fileLabel} hint={fileHint}>
        <input type="file" name="file" accept=".csv,.xlsx,.xlsm,.tsv,.txt" className={fileClass} />
      </Field>
      <details className="rounded-lg border border-border bg-card px-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">ファイルが無いとき：表を貼り付ける</summary>
        <div className="space-y-3 pb-3">
          <p className="text-xs text-muted-foreground">
            元請の画面や Excel の表、PDF のお支払通知の表を、見出しの行（品目・数量・単価・金額など）から下までコピーして貼り付けてください。PDF
            からのコピーは列がずれることがあります。取り込んだあと、結果の画面の「お支払通知の行」と「読み取りの詳細」で、品目と金額を確かめてください。
          </p>
          <label className="block">
            <span className="block text-sm font-bold">貼り付ける表</span>
            <textarea
              name="pasted"
              rows={6}
              maxLength={1_000_000}
              placeholder={"品目\t数量\t単価\t金額\n宅配\t4520\t190\t858800"}
              className="mt-1 block w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm text-foreground focus:border-foreground"
            />
          </label>
          <Field label="名前（任意）" hint="結果の画面に出す名前。例：北営業所の分">
            <Input type="text" name="pasteName" maxLength={60} autoComplete="off" />
          </Field>
        </div>
      </details>
    </div>
  );
}

/** 中身が同じファイルを止めたときだけ出す「それでも足す」（別の営業所の分で、たまたま同じ数・同じ金額のとき） */
function SameContentOverride({ state }: { state: { ok: boolean; error?: string } | undefined }) {
  if (!state || state.ok || !state.error?.includes(SAME_CONTENT_OVERRIDE)) return null;
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <input type="checkbox" name="allowSameContent" value="1" className="mt-1 h-5 w-5 shrink-0" />
      <span>
        {SAME_CONTENT_OVERRIDE}
        <span className="block text-xs text-muted-foreground">別の営業所の分で、たまたま同じ中身のときだけ。ファイルを選び直して、もう一度上げてください。</span>
      </span>
    </label>
  );
}

const MODE_CHOICES: { value: "new" | "replace" | "add"; label: string; hint: string }[] = [
  { value: "new", label: "上げない", hint: "まちがえて入れ替えないように、止めて知らせます。" },
  { value: "replace", label: "入れ替える", hint: "直したお支払通知が届いたとき。行を新しいファイルの内容に入れ替えます。問い合わせの状態とメモは残ります。" },
  {
    value: "add",
    label: "足す",
    hint: "営業所ごとなど、同じ月に何通も届くとき。前のファイルの行に足して、合計で突き合わせます。同じファイルを二重に足すことはできません。",
  },
];

export function UploadForm({
  clients,
  month,
  existing,
}: {
  /** closingDay：元請の締め日（0＝月末）。月末でなければ、何日〜何日の分として比べるかを書き添える */
  clients: { id: string; name: string; closingDay?: number }[];
  /** 画面の月（YYYY-MM） */
  month: string;
  /** この月にお支払通知がもうある元請 */
  existing: { clientId: string; fileName: string }[];
}) {
  const { state, pending, onSubmit } = useFormAction(uploadNoticeAction);
  const firstFree = clients.find((c) => !existing.some((e) => e.clientId === c.id)) ?? clients[0];
  const [clientId, setClientId] = useState(firstFree?.id ?? "");
  const [m, setM] = useState(month);
  const [mode, setMode] = useState<"new" | "replace" | "add">("new");
  const already = m === month ? existing.find((e) => e.clientId === clientId) : undefined;
  const picked = clients.find((c) => c.id === clientId);
  // 締め日が月末でない元請は、何月分が何日〜何日の分か（上げる月を取り違えないように）
  const span = picked && /^\d{4}-\d{2}$/.test(m) ? closingSpan(m, picked.closingDay ?? 0) : null;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
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
      {picked && span && (
        <p className="rounded-lg border border-border bg-muted p-3 text-sm">
          {picked.name}は毎月{picked.closingDay}日締めです。{monthJa(m)}分は {dateJa(span.from)}〜{dateJa(span.to)} の分です。
          <span className="block text-xs text-muted-foreground">
            お支払通知の締めの日が {dateJa(span.to)} になっているか確かめてください。稼働に日付があれば、この期間の稼働で比べます（日付が無ければ当社の月で比べます）。
          </span>
        </p>
      )}
      <FileOrPaste fileLabel="お支払通知のファイル" fileHint="CSV か Excel（.xlsx）。元請の画面から落としたファイルを、そのまま上げられます（5MB まで）" />
      {already && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          この月のお支払通知は、すでに上げてあります（{already.fileName}）。直したお支払通知なら「入れ替える」、営業所ごとなど同じ月の別のお支払通知なら「足す」を選んでください。
        </p>
      )}
      <fieldset className="space-y-1">
        <legend className="text-sm font-bold">この月のお支払通知がすでにあるとき</legend>
        {MODE_CHOICES.map((c) => (
          <label key={c.value} className="flex min-h-11 items-start gap-3 py-1 text-sm">
            <input type="radio" name="mode" value={c.value} checked={mode === c.value} onChange={() => setMode(c.value)} className="mt-1 h-5 w-5 shrink-0" />
            <span>
              {c.label}
              <span className="block text-xs text-muted-foreground">{c.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {mode === "add" && <SameContentOverride state={state} />}
      <Button type="submit" className="w-full sm:w-auto" disabled={pending || clients.length === 0}>
        {pending ? "読み取っています…" : "取り込んで突き合わせる"}
      </Button>
    </form>
  );
}

/**
 * 結果の画面から、同じ元請・同じ月のお支払通知を直したものに入れ替える（元請と月は決まっているので、ファイルを選ぶだけ）。
 * 取引をやめた元請でも、すでにある月の通知は入れ替えられる。何通かを足したお支払通知では、全部のファイルが入れ替わる
 */
export function ReplaceNoticeForm({
  clientId,
  clientName,
  month,
  monthText,
  fileCount = 1,
}: {
  clientId: string;
  clientName: string;
  month: string;
  monthText: string;
  /** お支払通知を作っているファイルの数（2 つ以上なら、全部が入れ替わることを書き添える） */
  fileCount?: number;
}) {
  const { state, pending, onSubmit } = useFormAction(uploadNoticeAction, { resetOnSuccess: true });
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="mode" value="replace" />
      <FormMessage state={state} />
      <FileOrPaste
        fileLabel={`直したお支払通知のファイル（${clientName}・${monthText}分）`}
        fileHint={
          fileCount > 1
            ? `いま足してある ${fileCount} つのファイルを、全部このファイル 1 つに入れ替えます。1 つのファイルだけ直すときは、上の「ファイル」の「このファイルだけ入れ替える」を使ってください`
            : "行を新しいファイルの内容に入れ替えて、突き合わせ直します。問い合わせの状態・メモ・取り戻せた額は残ります"
        }
      />
      <Button type="submit" variant="secondary" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "読み取っています…" : fileCount > 1 ? "全部を入れ替えて突き合わせ直す" : "入れ替えて突き合わせ直す"}
      </Button>
    </form>
  );
}

/** 結果の画面から、同じ元請・同じ月の別のお支払通知（営業所ごとなど）を足す */
export function AddNoticeFileForm({ clientId, clientName, month, monthText }: { clientId: string; clientName: string; month: string; monthText: string }) {
  const { state, pending, onSubmit } = useFormAction(uploadNoticeAction, { resetOnSuccess: true });
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="mode" value="add" />
      <FormMessage state={state} />
      <FileOrPaste
        fileLabel={`足すお支払通知のファイル（${clientName}・${monthText}分）`}
        fileHint="営業所ごとなど、同じ月に別に届いたお支払通知。今の行に足して、合計で突き合わせ直します。同じファイル・同じ中身のファイルは、二重に数えないように止めます"
      />
      <SameContentOverride state={state} />
      <Button type="submit" variant="secondary" className="w-full sm:w-auto" disabled={pending}>
        {pending ? "読み取っています…" : "足して突き合わせ直す"}
      </Button>
    </form>
  );
}

/** 何通かを足したお支払通知の、1 つのファイルだけを直したものに入れ替える */
export function ReplaceFileForm({ clientId, month, fileId, fileName }: { clientId: string; month: string; fileId: string; fileName: string }) {
  const { state, pending, onSubmit } = useFormAction(uploadNoticeAction, { resetOnSuccess: true });
  return (
    <details className="rounded-lg border border-border bg-card px-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold">このファイルだけ入れ替える</summary>
      <form onSubmit={onSubmit} className="space-y-3 pb-3">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="mode" value="replaceFile" />
        <input type="hidden" name="fileId" value={fileId} />
        <FormMessage state={state} />
        <FileOrPaste fileLabel={`「${fileName}」を直したファイル`} fileHint="このファイルの行だけを入れ替えます。ほかのファイルの行はそのままです" />
        <SameContentOverride state={state} />
        <Button type="submit" variant="secondary" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "読み取っています…" : "このファイルを入れ替える"}
        </Button>
      </form>
    </details>
  );
}

/** 何通かを足したお支払通知から、ファイルを 1 つ外す（まちがえて足したとき） */
export function RemoveFileForm({ noticeId, fileId, fileName }: { noticeId: string; fileId: string; fileName: string }) {
  const [state, action, pending] = useActionState(removeNoticeFileAction, undefined);
  const [ok, setOk] = useState(false);
  return (
    <details className="rounded-lg border border-danger/40 bg-card px-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-bold text-danger">このファイルを外す</summary>
      <form action={action} className="space-y-3 pb-3">
        <input type="hidden" name="noticeId" value={noticeId} />
        <input type="hidden" name="fileId" value={fileId} />
        <p className="text-sm">「{fileName}」の行を外して、残りのファイルで突き合わせ直します。まちがえて足したときに使ってください（直したものが届いたときは「このファイルだけ入れ替える」）。</p>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" name="confirm" value="1" className="h-5 w-5" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          外してよい
        </label>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-danger bg-card px-4 text-sm font-bold text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!ok || pending}
        >
          {pending ? "外しています…" : "外す"}
        </button>
        <FormMessage state={state} />
      </form>
    </details>
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

export function ItemStatusForm({
  itemId,
  status,
  note,
  diff,
  recoveredAmount,
  statuses = ITEM_STATUSES,
}: {
  itemId: string;
  status: ItemStatus;
  note: string | null;
  /** 差（マイナス＝受け取りが少ない可能性）。取り戻せた額の欄は、マイナスのときだけ出す */
  diff: number;
  recoveredAmount: number | null;
  /** 選べる扱い（片付いた記録は「解決」「了承」だけ） */
  statuses?: readonly ItemStatus[];
}) {
  const { state, pending, onSubmit } = useFormAction(setItemStatusAction);
  const [chosen, setChosen] = useState<ItemStatus>(status);
  const [recovered, setRecovered] = useState(recoveredAmount !== null ? String(recoveredAmount) : "");
  const showRecovered = chosen === "resolved" && diff < 0;
  // 了承は理由が必須。解決は「取り戻せた額」か「どう片付いたかのメモ」のどちらかが必須（サーバーでも確かめる）
  const noteRequired = chosen === "accepted" || (chosen === "resolved" && (!showRecovered || recovered.trim() === ""));
  const noteLabel =
    chosen === "accepted"
      ? "メモ（了承した理由・必須）"
      : chosen === "resolved"
        ? showRecovered
          ? noteRequired
            ? "メモ（取り戻せた額を入れないときは必須）"
            : "メモ"
          : "メモ（どう片付いたか・必須）"
        : "メモ";
  const placeholder =
    chosen === "accepted"
      ? "例：11/5 先方と電話。10月分はこの数で合意"
      : chosen === "resolved"
        ? showRecovered
          ? "例：11月分に上乗せで入金／自社の記録を直した"
          : "例：待機料の請求どおりと確認した"
        : "例：10/31 メールで問い合わせ";
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-2 border-t border-border pt-3">
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <Field label="扱い">
          <Select name="status" value={chosen} onChange={(e) => setChosen(e.target.value as ItemStatus)}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={noteLabel}>
          <Input name="note" defaultValue={note ?? ""} maxLength={500} required={noteRequired} placeholder={placeholder} />
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </div>
      {showRecovered && (
        <div className="sm:max-w-xs">
          <Field
            label="取り戻せた額（円）"
            hint="入金された額、または次の支払に上乗せされると決まった額（差と違う額でもかまいません）。当社の記録の誤りだったときは 0 か、メモに「自社の記録を直した」と残してください。入れた額だけを「見つけたお金（確定）」として数えます"
          >
            <NumberInput name="recoveredAmount" value={recovered} onChange={(e) => setRecovered(e.target.value)} placeholder={`例：${Math.abs(diff)}`} />
          </Field>
        </div>
      )}
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
  const { state, pending, onSubmit } = useFormAction(updateNoticeMetaAction);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
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
          ファイルを上げ直したいだけなら、削除せずに上の「入れ替える」で上げてください。状態とメモが残ります。
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
