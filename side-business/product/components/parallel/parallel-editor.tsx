"use client";

import { startTransition, useActionState, useEffect, useState, useTransition, type FormEvent } from "react";
import { Button, Input, Money, NumberInput, Select } from "@/components/ui";
import { parseAmount } from "@/lib/payroll/money";
import {
  clearParallelAction,
  readParallelAction,
  saveParallelAction,
  type ClearParallelState,
  type ReadParallelState,
  type SaveParallelState,
} from "~/app/(app)/parallel/actions";
import { Badge } from "~/components/page";
import { Breakdown, Explanations, signedYen } from "~/components/parallel/diff-detail";
import { draftKey, draftText, parseDraft, readDraftStorage, useUnsavedGuard, writeDraftStorage, type DraftValue } from "~/components/parallel/unsaved";
import { explainDiff, type DiffParts } from "~/server/features/parallel/explain";

export type EditorRow = {
  driverId: string;
  name: string;
  code: string | null;
  ours: number | null;
  source: "saved" | "draft" | null;
  stale: boolean;
  draftTotal: number | null;
  excelTotal: number | null;
  note: string | null;
  parts: DiffParts | null;
};

type Value = { excel: string; note: string };

function initialValues(rows: EditorRow[]): Record<string, Value> {
  return Object.fromEntries(rows.map((r) => [r.driverId, { excel: r.excelTotal === null ? "" : String(r.excelTotal), note: r.note ?? "" }]));
}

/** 入れた文字を円の整数に（読めなければ undefined、空なら null） */
function amountOf(text: string): number | null | undefined {
  const t = text.normalize("NFKC").trim();
  if (!t) return null;
  const n = parseAmount(t);
  return n !== null && Number.isInteger(n) ? n : undefined;
}

function colLabel(i: number, header: string): string {
  const letter = i < 26 ? String.fromCharCode(65 + i) : `${i + 1}列目`;
  return header ? `${letter}列「${header}」` : `${letter}列`;
}

/**
 * Excel の振込額を入れる：1 人ずつ打つ・「名前と金額」の 2 列を貼り付ける・ファイルを置く。
 * 入れるとすぐに差と理由の見当が出る。「保存する」までは保存しない。
 * 保存していない入力があるあいだは、ほかの画面へ移る前に確かめる。入力はこのタブに下書きとして残し、戻ってきたら入れ直す。
 * 月ごとに別の下書き（画面は key={month} で月ごとに作り直す）。
 */
export function ParallelEditor({ month, rows, otherDrivers }: { month: string; rows: EditorRow[]; otherDrivers: { id: string; name: string; code: string | null }[] }) {
  // 保存すると一覧が読み直されるので、そのときは入力を今の保存内容に戻す
  const signature = rows.map((r) => `${r.driverId}:${r.excelTotal ?? ""}:${r.note ?? ""}`).join("|");
  const [seen, setSeen] = useState(signature);
  const [values, setValues] = useState<Record<string, Value>>(() => initialValues(rows));
  const [extra, setExtra] = useState<EditorRow[]>([]);
  const [askClear, setAskClear] = useState(false);
  /** 下書きから入れ直した人数（0 なら知らせを出さない） */
  const [restored, setRestored] = useState(0);
  /** 下書きを読み終えたか（読む前に「変えたところなし」で下書きを消さないため） */
  const [hydrated, setHydrated] = useState(false);
  if (seen !== signature) {
    setSeen(signature);
    setValues(initialValues(rows));
    setExtra([]);
    setAskClear(false);
    setRestored(0);
  }

  const [saveState, saveAction, saving] = useActionState<SaveParallelState, FormData>(saveParallelAction, undefined);
  const [clearState, clearAction, clearing] = useActionState<ClearParallelState, FormData>(clearParallelAction, undefined);
  const [readResult, setReadResult] = useState<ReadParallelState>(undefined);
  const [reading, startReading] = useTransition();
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [addId, setAddId] = useState("");

  const all = [...rows, ...extra];
  const initial = initialValues(rows);
  const valueOf = (id: string): Value => values[id] ?? { excel: "", note: "" };
  const dirty = all.filter((r) => {
    const v = valueOf(r.driverId);
    const i = initial[r.driverId] ?? { excel: "", note: "" };
    // 額の無いメモだけでは保存しない（メモは Excel の額と一緒に残す）
    if (!v.excel.trim() && !i.excel.trim()) return false;
    return v.excel.trim() !== i.excel.trim() || v.note.trim() !== i.note.trim();
  });
  const invalid = dirty.filter((r) => amountOf(valueOf(r.driverId).excel) === undefined);

  // 保存していない入力があるあいだは、移る前に確かめる
  useUnsavedGuard(dirty.length > 0);

  // 開いたとき：このタブに残した下書きがあり、保存内容がそのときと同じなら入れ直す（ブラウザの中だけ。サーバーには送らない）
  useEffect(() => {
    const draft = parseDraft(readDraftStorage(draftKey(month)), signature);
    if (draft) {
      const known = new Set([...rows.map((r) => r.driverId), ...otherDrivers.map((d) => d.id)]);
      const values = Object.fromEntries(Object.entries(draft.values).filter(([id]) => known.has(id)));
      const listed = new Set(rows.map((r) => r.driverId));
      const add = draft.extra
        .filter((x) => !listed.has(x.driverId) && otherDrivers.some((d) => d.id === x.driverId))
        .map((x): EditorRow => ({ driverId: x.driverId, name: x.name, code: x.code, ours: null, source: null, stale: false, draftTotal: null, excelTotal: null, note: null, parts: null }));
      if (Object.keys(values).length > 0) {
        setValues((prev) => ({ ...prev, ...values }));
        if (add.length) setExtra(add);
        setRestored(Object.keys(values).length);
      }
    }
    setHydrated(true);
    // 開いたときに 1 回だけ（月が変われば画面ごと作り直す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 入力のたびに下書きを残す（変えたところが無くなれば消す）
  const draft = draftText(
    signature,
    Object.fromEntries(dirty.map((r): [string, DraftValue] => [r.driverId, valueOf(r.driverId)])),
    extra.filter((r) => dirty.includes(r)).map((r) => ({ driverId: r.driverId, name: r.name, code: r.code })),
  );
  useEffect(() => {
    if (hydrated) writeDraftStorage(draftKey(month), draft);
  }, [hydrated, month, draft]);

  const discardDraft = () => {
    setValues(initialValues(rows));
    setExtra([]);
    setRestored(0);
    writeDraftStorage(draftKey(month), null);
  };

  const set = (id: string, patch: Partial<Value>) => setValues((prev) => ({ ...prev, [id]: { ...valueOf(id), ...prev[id], ...patch } }));

  const read = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startReading(async () => {
      const res = await readParallelAction(undefined, form);
      setReadResult(res);
      if (!res?.ok || !res.data) return;
      const listed = new Set(all.map((r) => r.driverId));
      const add: EditorRow[] = [];
      const patch: Record<string, Value> = {};
      for (const r of res.data.rows) {
        if (!r.driverId || r.amount === null || r.problem) continue;
        patch[r.driverId] = { excel: String(r.amount), note: valueOf(r.driverId).note };
        if (!listed.has(r.driverId)) {
          listed.add(r.driverId);
          add.push({ driverId: r.driverId, name: r.driverName ?? r.rawName, code: null, ours: null, source: null, stale: false, draftTotal: null, excelTotal: null, note: null, parts: null });
        }
      }
      setValues((prev) => ({ ...prev, ...patch }));
      if (add.length) setExtra((prev) => [...prev, ...add]);
    });
  };

  const save = () => {
    const form = new FormData();
    form.set("month", month);
    form.set("entries", JSON.stringify(dirty.map((r) => ({ driverId: r.driverId, excelTotal: valueOf(r.driverId).excel, note: valueOf(r.driverId).note }))));
    startTransition(() => saveAction(form));
  };

  const addDriver = () => {
    const d = otherDrivers.find((x) => x.id === addId);
    if (!d || all.some((r) => r.driverId === d.id)) return;
    setExtra((prev) => [...prev, { driverId: d.id, name: d.name, code: d.code, ours: null, source: null, stale: false, draftTotal: null, excelTotal: null, note: null, parts: null }]);
    setAddId("");
  };

  const table = readResult?.ok ? readResult.data : undefined;
  const remaining = otherDrivers.filter((d) => !all.some((r) => r.driverId === d.id));

  return (
    <div className="space-y-6">
      {restored > 0 && dirty.length > 0 && (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1">前にこの画面で入れて、保存していなかった額（{restored}人ぶん）を戻しました。まだ保存していません。</p>
          <Button variant="ghost" onClick={discardDraft}>
            戻した入力を捨てる
          </Button>
        </div>
      )}
      <section aria-labelledby="import-heading" className="rounded-card border border-border bg-card p-4">
        <h2 id="import-heading" className="font-bold">
          Excel から貼り付ける・ファイルを置く
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Excel の「名前」と「振込額」の 2 列を選んでコピーし、貼り付けてください。振込の一覧のファイル（列がたくさんある表）を置いても、名前と振込額の列を探して読みます。
        </p>
        <form onSubmit={read} className="mt-3 space-y-3">
          <textarea
            name="paste"
            value={paste}
            onChange={(e) => {
              setPaste(e.target.value);
              setReadResult(undefined);
            }}
            rows={5}
            spellCheck={false}
            aria-label="名前と振込額を貼り付ける"
            placeholder={"青木 翔太\t357,555\n井上 美咲\t357,720"}
            className="block w-full rounded-lg border border-border bg-card p-3 font-mono text-sm text-foreground focus:border-foreground"
          />
          <label className="flex min-h-12 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-border p-3 text-center text-sm hover:bg-muted">
            <span>{fileName ?? "または、ここを押して Excel・CSV のファイルを選ぶ（5MB まで）"}</span>
            <input type="file" name="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" className="sr-only" onChange={(e) => {
                setFileName(e.currentTarget.files?.[0]?.name ?? null);
                setReadResult(undefined);
              }}
            />
          </label>
          {fileName && <p className="text-xs text-muted-foreground">ファイルを選んだときは、貼り付けよりファイルを先に読みます。</p>}
          {table && table.columns.length > 1 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-bold">名前の列</span>
                <Select name="nameCol" defaultValue={String(table.nameCol)} key={`n${table.nameCol}`}>
                  {table.columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {colLabel(c.index, c.header)}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="block text-sm">
                <span className="font-bold">振込額の列</span>
                <Select name="amountCol" defaultValue={String(table.amountCol)} key={`a${table.amountCol}`}>
                  {table.columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {colLabel(c.index, c.header)}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          )}
          <Button type="submit" variant="secondary" disabled={reading || (!paste.trim() && !fileName)} className="w-full sm:w-auto">
            {reading ? "読んでいます…" : table ? "この列で読み直す" : "読み込んで下の表に入れる"}
          </Button>
        </form>
        {readResult && !readResult.ok && (
          <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {readResult.error}
          </p>
        )}
        {table && (
          <div role="status" className="mt-3 space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-bold">
              {table.source}
              {table.sheetName ? `（${table.sheetName}）` : ""}：{table.matched}人ぶんを下の表に入れました（まだ保存していません）
            </p>
            <p className="text-muted-foreground">
              名前は{colLabel(table.nameCol, table.columns[table.nameCol]?.header ?? "")}、振込額は{colLabel(table.amountCol, table.columns[table.amountCol]?.header ?? "")}を読みました。違うときは、上で列を選んで読み直してください。
            </p>
            {table.problem && <p className="text-danger">{table.problem}</p>}
            {table.unmatched > 0 && (
              <details>
                <summary className="min-h-11 cursor-pointer py-2">入れなかった行（{table.unmatched}）</summary>
                <ul className="space-y-1">
                  {table.rows
                    .filter((r) => r.problem)
                    .map((r) => (
                      <li key={r.rowNo}>
                        {r.rowNo}行目「{r.rawName || "（空）"}」{r.rawAmount && `・${r.rawAmount}`}：{r.problem}
                      </li>
                    ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="rows-heading" className="space-y-3">
        <h2 id="rows-heading" className="text-lg font-bold">
          ドライバーごとの振込額
        </h2>
        <ul className="space-y-3">
          {all.map((r) => {
            const v = valueOf(r.driverId);
            const amount = amountOf(v.excel);
            const diff = typeof amount === "number" ? (r.ours ?? 0) - amount : null;
            const explanations = diff === null ? [] : explainDiff(r.parts, diff);
            const changed = dirty.includes(r);
            return (
              <li key={r.driverId} id={`row-${r.driverId}`} className={`rounded-card border bg-card p-3 ${diff !== null && diff !== 0 ? "border-warning/60" : "border-border"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-bold">
                    {r.name}
                    {r.code && <span className="ml-1 text-xs font-normal text-muted-foreground">{r.code}</span>}
                  </span>
                  {changed && <Badge tone="yellow">未保存</Badge>}
                  {diff === null ? <Badge>{amount === undefined ? "数を確かめて" : "未入力"}</Badge> : diff === 0 ? <Badge tone="green">一致</Badge> : <Badge tone="red">差 {signedYen(diff)}</Badge>}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-[1fr_1fr_1fr]">
                  <div>
                    <p className="text-xs text-muted-foreground">しめ日ラボ{r.source === "saved" ? "（明細）" : r.source === "draft" ? "（見込み）" : ""}</p>
                    <p className="text-base font-bold">{r.ours === null ? "明細なし" : <Money value={r.ours} />}</p>
                    {r.stale && r.draftTotal !== null && <p className="text-xs text-warning">稼働が変わっています。作り直すと {r.draftTotal.toLocaleString("ja-JP")}円</p>}
                  </div>
                  <label className="block">
                    <span className="text-xs text-muted-foreground">Excel の振込額</span>
                    <NumberInput value={v.excel} onChange={(e) => set(r.driverId, { excel: e.target.value })} placeholder="例：357,555" aria-label={`${r.name}さんの Excel の振込額`} />
                  </label>
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-xs text-muted-foreground">差（しめ日ラボ − Excel）</p>
                    <p className="text-base font-bold">{diff === null ? "—" : <Money value={diff} />}</p>
                  </div>
                </div>
                {amount === undefined && <p className="mt-1 text-sm text-danger">1 円単位の数で入れてください（全角・カンマ入りでも読めます）</p>}
                {diff !== null && diff !== 0 && (
                  <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-2">
                    <Explanations items={explanations} />
                    {r.parts && (
                      <Button variant="ghost" onClick={() => setOpen((p) => ({ ...p, [r.driverId]: !p[r.driverId] }))} aria-expanded={!!open[r.driverId]}>
                        {open[r.driverId] ? "内訳を閉じる" : "しめ日ラボの内訳を見る"}
                      </Button>
                    )}
                    {r.parts && open[r.driverId] && <Breakdown parts={r.parts} excelTotal={amount ?? null} />}
                  </div>
                )}
                <label className="mt-2 block text-xs">
                  <span className="text-muted-foreground">メモ（どちらに合わせたか など。Excel の額と一緒に保存します）</span>
                  <Input value={v.note} onChange={(e) => set(r.driverId, { note: e.target.value })} maxLength={200} placeholder="例：Excel の端数を切り捨てに直した" />
                </label>
                {diff !== null && diff !== 0 && !v.note.trim() && (
                  <p className="mt-1 text-xs text-warning">差の理由のメモがまだありません。本番に切り替える前に、どちらに合わせるかを書いてください。</p>
                )}
              </li>
            );
          })}
        </ul>
        {remaining.length > 0 && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="block flex-1 text-sm">
              <span className="font-bold">一覧にいない人を足す（しめ日ラボにこの月の稼働が無い人）</span>
              <Select value={addId} onChange={(e) => setAddId(e.target.value)}>
                <option value="">選んでください</option>
                {remaining.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.code ? `（${d.code}）` : ""}
                  </option>
                ))}
              </Select>
            </label>
            <Button variant="secondary" onClick={addDriver} disabled={!addId}>
              足す
            </Button>
          </div>
        )}
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-border bg-background/95 p-4 backdrop-blur sm:mx-0 sm:rounded-card sm:border">
        {saveState && !saveState.ok && (
          <p role="alert" className="text-sm text-danger">
            {saveState.error}
            {saveState.fieldErrors && Object.values(saveState.fieldErrors)[0] ? `：${Object.values(saveState.fieldErrors)[0]}` : ""}
          </p>
        )}
        {saveState?.ok && dirty.length === 0 && (
          <p role="status" className="text-sm text-success">
            保存しました（{saveState.data?.saved ?? 0}人{saveState.data?.removed ? `・消した ${saveState.data.removed}人` : ""}）。
          </p>
        )}
        {invalid.length > 0 && <p className="text-sm text-danger">数として読めない額が {invalid.length}人ぶんあります。直してから保存してください。</p>}
        <Button onClick={save} disabled={saving || dirty.length === 0 || invalid.length > 0} className="w-full sm:w-auto">
          {saving ? "保存しています…" : dirty.length ? `保存する（${dirty.length}人）` : "変えたところはありません"}
        </Button>
      </div>

      {rows.some((r) => r.excelTotal !== null) && (
        <div className="text-sm">
          {askClear ? (
            <form action={clearAction} className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <input type="hidden" name="month" value={month} />
              <p>この月に入れた Excel の額を、すべて消します。明細や稼働は変わりません。消しますか？</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={clearing}>
                  {clearing ? "消しています…" : "すべて消す"}
                </Button>
                <Button variant="secondary" onClick={() => setAskClear(false)} disabled={clearing}>
                  やめる
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" onClick={() => setAskClear(true)}>
              この月の Excel の額を消して、やり直す
            </Button>
          )}
          {clearState && !clearState.ok && <p className="text-danger">{clearState.error}</p>}
        </div>
      )}
    </div>
  );
}
