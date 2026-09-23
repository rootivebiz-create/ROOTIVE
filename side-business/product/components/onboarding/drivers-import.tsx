"use client";

import Link from "next/link";
import { startTransition, useActionState, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui";
import {
  createDriversAction,
  previewDriversAction,
  type CreateDriversState,
  type DriverPreviewState,
} from "~/app/(app)/onboarding/actions";
import { Badge } from "~/components/page";
import type { DriverPreviewRow } from "~/server/features/onboarding/drivers-parse";

/** 貼り付けの見本（見出しつき・タブ区切り）。見出しが無いときも、この順で読む */
const EXAMPLE = [
  ["氏名", "フリガナ", "番号", "登録番号", "銀行コード", "支店コード", "口座番号", "口座名義"].join("\t"),
  ["山田 太郎", "ヤマダ タロウ", "101", "T1234567890123", "0001", "001", "1234567", "ヤマダ タロウ"].join("\t"),
  ["佐々木 花子", "ササキ ハナコ", "102", "", "0005", "123", "7654321", "ササキ ハナコ"].join("\t"),
].join("\n");

const STATUS: Record<DriverPreviewRow["status"], { label: string; tone: "green" | "gray" | "red" }> = {
  new: { label: "登録できます", tone: "green" },
  duplicate: { label: "すでにいます", tone: "gray" },
  error: { label: "直すところがあります", tone: "red" },
};

function ErrorLine({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      {text}
    </p>
  );
}

function RowCard({ row, checked, onToggle }: { row: DriverPreviewRow; checked: boolean; onToggle: () => void }) {
  const d = row.draft;
  const st = STATUS[row.status];
  return (
    <li className={`rounded-lg border p-3 ${row.status === "error" ? "border-danger/50" : "border-border"} bg-card`}>
      <div className="flex flex-wrap items-center gap-2">
        {row.status === "new" ? (
          <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
            <input type="checkbox" checked={checked} onChange={onToggle} className="h-5 w-5 shrink-0" aria-label={`${row.name}を登録する`} />
            <span className="min-w-0 font-bold">{row.name}</span>
          </label>
        ) : (
          <span className="min-w-0 flex-1 font-bold">{row.name || "（名前なし）"}</span>
        )}
        <span className="text-xs text-muted-foreground">{row.rowNo}行目</span>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      {d && (
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          {d.kana && (
            <>
              <dt className="text-muted-foreground">フリガナ</dt>
              <dd>{d.kana}</dd>
            </>
          )}
          {d.code && (
            <>
              <dt className="text-muted-foreground">番号</dt>
              <dd className="num">{d.code}</dd>
            </>
          )}
          <dt className="text-muted-foreground">インボイス</dt>
          <dd className="num">{d.registrationNo ? `登録済み ${d.registrationNo}` : "未登録（登録番号なし）"}</dd>
          <dt className="text-muted-foreground">口座</dt>
          <dd className="num break-all">
            {d.bank ? `${d.bank.bankCode}-${d.bank.branchCode} ${d.bank.accountType === "checking" ? "当座" : "普通"} ${d.bank.accountNumber} ${d.bank.holderKana}` : "入れません"}
          </dd>
        </dl>
      )}
      {(row.errors.length > 0 || row.warnings.length > 0) && (
        <ul className="mt-2 space-y-1 text-sm">
          {row.errors.map((e) => (
            <li key={e} className="text-danger">
              {e}
            </li>
          ))}
          {row.warnings.map((w) => (
            <li key={w} className="text-muted-foreground">
              {w}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * ドライバーの名簿をまとめて登録する：貼り付け（またはファイル）→ 1 行ずつ確かめ → 選んだ人だけ登録。
 * 同じ人は何度読み込んでも増えない。
 */
export function DriversImport() {
  // 登録が済んだあと「続けて読み込む」で、最初の状態からやり直す
  const [round, setRound] = useState(0);
  return <DriversImportForm key={round} onAgain={() => setRound((n) => n + 1)} />;
}

function DriversImportForm({ onAgain }: { onAgain: () => void }) {
  const [preview, previewAction, previewing] = useActionState<DriverPreviewState, FormData>(previewDriversAction, undefined);
  const [created, createAction, creating] = useActionState<CreateDriversState, FormData>(createDriversAction, undefined);
  const [paste, setPaste] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [shown, setShown] = useState<"all" | "problems">("all");

  const data = preview?.ok ? preview.data : undefined;
  const newRows = useMemo(() => (data?.rows ?? []).filter((r) => r.status === "new"), [data]);
  const chosen = newRows.filter((r) => !excluded.has(r.rowNo));
  const visible = (data?.rows ?? []).filter((r) => shown === "all" || r.status !== "new" || r.warnings.length > 0);

  const onPreview = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setExcluded(new Set());
    startTransition(() => previewAction(form));
  };
  const onCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData();
    form.set("drafts", JSON.stringify(chosen.map((r) => r.draft)));
    startTransition(() => createAction(form));
  };
  const toggle = (rowNo: number) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(rowNo)) next.delete(rowNo);
      else next.add(rowNo);
      return next;
    });

  if (created?.ok && created.data) {
    const r = created.data;
    return (
      <div role="status" className="space-y-3 rounded-card border border-success/40 bg-success/10 p-4">
        <p className="text-lg font-bold text-success">{r.created}人を登録しました</p>
        {r.skipped.length > 0 && <p className="text-sm">すでにいた {r.skipped.length}人（{r.skipped.join("、")}）は登録していません。</p>}
        {r.rejected.length > 0 && (
          <div className="text-sm">
            <p className="font-bold text-danger">登録できなかった人がいます</p>
            <ul className="list-disc pl-5">
              {r.rejected.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-sm">口座や取引条件を明示した日などは、あとでメニューの「設定」→ ドライバーから足せます。</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href="/onboarding/projects" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground no-underline">
            次の手順「元請と案件」へ →
          </Link>
          <Button variant="secondary" onClick={onAgain}>
            続けて読み込む
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onPreview} className="space-y-4">
        <div>
          <label htmlFor="drivers-paste" className="block font-bold">
            Excel の名簿を貼り付ける
          </label>
          <p className="mt-1 text-sm text-muted-foreground">
            Excel で見出しの行ごと範囲を選んでコピーし、下の枠に貼り付けます。列の順番は今の名簿のままで読めます。
          </p>
          <textarea
            id="drivers-paste"
            name="paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={8}
            spellCheck={false}
            placeholder={"氏名\tフリガナ\t番号\t登録番号\t銀行コード\t支店コード\t口座番号\t口座名義\n山田 太郎\tヤマダ タロウ\t101\tT1234567890123\t0001\t001\t1234567\tヤマダ タロウ"}
            className="mt-2 block w-full rounded-lg border border-border bg-card p-3 font-mono text-sm text-foreground focus:border-foreground"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setPaste(EXAMPLE)}>
              見本を入れてみる
            </Button>
            {paste && (
              <Button variant="ghost" onClick={() => setPaste("")}>
                枠を空にする
              </Button>
            )}
          </div>
        </div>
        <div>
          <p className="font-bold">または、ファイルを選ぶ（CSV・Excel）</p>
          <label className="mt-2 flex min-h-14 cursor-pointer items-center justify-center rounded-card border-2 border-dashed border-border bg-card p-3 text-center text-sm hover:bg-muted">
            <span>{fileName ?? "ここを押して、名簿のファイルを選ぶ（5MB まで）"}</span>
            <input
              type="file"
              name="file"
              accept=".xlsx,.xlsm,.csv,.tsv,.txt"
              className="sr-only"
              onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? null)}
            />
          </label>
          <p className="mt-1 text-xs text-muted-foreground">ファイルを選んだときは、貼り付けよりファイルを先に読みます。</p>
        </div>
        <details className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-bold">読める見出し（列の名前）</summary>
          <p className="mt-2">
            氏名（名前）・フリガナ・番号（コード）・登録番号（インボイス）・銀行コード・銀行名・支店コード・支店名・預金種目・口座番号・口座名義・メール・電話・委託開始日。
            見出しが無いときは「氏名・フリガナ・番号・登録番号・銀行コード・支店コード・口座番号・口座名義」の順として読みます。
          </p>
          <p className="mt-2">全角の数字・ハイフン入りの番号・先頭の 0 が消えた銀行コード（1 → 0001）も読めます。</p>
        </details>
        <ErrorLine text={preview && !preview.ok ? preview.error : undefined} />
        <Button type="submit" disabled={previewing || (!paste.trim() && !fileName)} className="w-full sm:w-auto">
          {previewing ? "読んでいます…" : "読み込んで確かめる（まだ登録しません）"}
        </Button>
      </form>

      {data && (
        <section aria-labelledby="preview-heading" className="space-y-3">
          <h2 id="preview-heading" className="text-lg font-bold">
            確かめてください（{data.source}
            {data.sheetName ? `・${data.sheetName}` : ""}）
          </h2>
          {data.problem ? (
            <ErrorLine text={data.problem} />
          ) : (
            <>
              <p className="text-sm">
                登録できる {data.counts.new}人・すでにいる {data.counts.duplicate}人・直すところがある {data.counts.error}人
              </p>
              <p className="text-xs text-muted-foreground">
                {data.headerRow ? `${data.headerRow}行目を見出しとして読みました：` : "見出しが無いので、決まった順で読みました："}
                {data.columns
                  .filter((c) => c.label)
                  .map((c) => (c.header && c.header !== c.label ? `${c.label}（${c.header}）` : c.label))
                  .join("・")}
              </p>
              {data.counts.error > 0 && (
                <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                  直すところがある人は登録しません。Excel で直してから、もう一度読み込んでください（登録済みの人は増えません）。
                </p>
              )}
              <div className="flex flex-wrap gap-2" role="group" aria-label="表示の切り替え">
                <Button variant={shown === "all" ? "primary" : "secondary"} onClick={() => setShown("all")}>
                  全員（{data.rows.length}）
                </Button>
                <Button variant={shown === "problems" ? "primary" : "secondary"} onClick={() => setShown("problems")}>
                  気になるところだけ
                </Button>
              </div>
              <ul className="space-y-2">
                {visible.map((r) => (
                  <RowCard key={r.rowNo} row={r} checked={!excluded.has(r.rowNo)} onToggle={() => toggle(r.rowNo)} />
                ))}
              </ul>
              <form onSubmit={onCreate} className="sticky bottom-0 -mx-4 space-y-2 border-t border-border bg-background/95 p-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
                <ErrorLine text={created && !created.ok ? created.error : undefined} />
                <Button type="submit" disabled={creating || chosen.length === 0} className="w-full sm:w-auto">
                  {creating ? "登録しています…" : `${chosen.length}人を登録する`}
                </Button>
                <p className="text-xs text-muted-foreground">登録したあとも、設定のドライバーから直したり、使わない人を外したりできます。</p>
              </form>
            </>
          )}
        </section>
      )}
    </div>
  );
}
