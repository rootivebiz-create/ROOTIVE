"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, Card, Field, Input } from "@/components/ui";
import { Notice } from "~/components/page";
import { bulkCreateTermsAction, type BulkTermsState } from "~/app/(app)/terms/actions";

/**
 * 「未作成の人の明示書をまとめて作る」。押す前に、作る人数と名前・入る中身を見せてから作る。
 * 案件は直近の稼働・その人だけの単価から、控除と支払日は台帳から入る。1 人ずつの直しは、あとで版 2 として作れる。
 * 作り終わると未作成の人がいなくなるので、枠ごと消さずに結果を出したままにする（一覧の画面は、事務には必ずこれを置く）。
 */
export function TermsBulkForm({
  names,
  today,
  defaultPlace,
}: {
  names: { name: string; workedRecently: boolean }[];
  today: string;
  defaultPlace: string;
}) {
  const [state, dispatch, pending] = useActionState(bulkCreateTermsAction, undefined);
  // 確かめの箱は、開いたときの結果のままのあいだだけ出す（作り終わったら閉じる）
  const [opened, setOpened] = useState<{ at: BulkTermsState } | null>(null);
  const confirming = opened !== null && opened.at === state;
  const fe: Record<string, string> = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const worked = names.filter((n) => n.workedRecently).length;
  if (names.length === 0 && !state) return null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // 入力欄で Enter を押したときも、先に確かめの箱を出す
    if (!confirming) {
      setOpened({ at: state });
      return;
    }
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  }

  return (
    <Card>
      <h2 className="font-bold">未作成の人の明示書をまとめて作る</h2>
      {names.length === 0 ? (
        <div className="mt-2 space-y-2">
          {state && (state.ok ? <Notice tone="ok">{state.message}</Notice> : <Notice tone="error">{state.error}</Notice>)}
          <p className="text-sm">
            次は 1 人ずつ開いて中身を確かめ、リンクを送ってください。
            <Link href="/terms?f=unreceived" className="ml-1">
              まだ受け取りの無い人を見る
            </Link>
          </p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            案件は直近の稼働とその人だけの単価から、控除と支払日は台帳から入ります。作ったあと 1 人ずつ開いて、中身を確かめてから送ってください。
          </p>
          <form onSubmit={onSubmit} className="mt-3 space-y-3">
            <p className="text-sm">
              明示書がまだ無い人：<strong>{names.length}人</strong>
              {worked > 0 && <span className="ml-1 text-danger">（うち {worked}人は最近の稼働があります）</span>}
            </p>
            <p className="break-words text-sm text-muted-foreground">{names.map((n) => n.name).join("、")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Field label="明示した日（全員）" hint="ドライバーに渡す日。今日送るなら今日のまま">
                  <Input type="date" name="issuedOn" defaultValue={today} max={today} required />
                </Field>
                {fe.issuedOn && <p className="mt-1 text-xs font-bold text-danger">{fe.issuedOn}</p>}
              </div>
              <div>
                <Field label="給付を受け取る場所（全員に同じ文）" hint="1 人ずつの画面で、あとから直せます">
                  <Input name="place" defaultValue={defaultPlace} maxLength={300} required />
                </Field>
                {fe.place && <p className="mt-1 text-xs font-bold text-danger">{fe.place}</p>}
              </div>
            </div>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
              <input type="checkbox" name="deemed" value="1" className="mt-1 size-5 shrink-0" />
              <span>
                <span className="block font-bold">明細のみなし確認の条項を入れる</span>
                <span className="mt-1 block text-xs text-muted-foreground">入れた人だけ、支払明細の「みなし確認」が出るようになります</span>
              </span>
            </label>

            {confirming ? (
              <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" role="alertdialog" aria-label="まとめて作る前の確認">
                <p className="font-bold text-warning">{names.length}人分の明示書（版 1）を作ります</p>
                <p className="mt-1">
                  中身は台帳（案件の単価・控除・支払日）から入ります。作っただけではドライバーに届きません。作ったあと 1 人ずつ開いて中身を確かめ、リンクを送ってください。
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="submit" disabled={pending}>
                    {pending ? "作っています…" : `${names.length}人分を作る`}
                  </Button>
                  <Button variant="secondary" onClick={() => setOpened(null)} disabled={pending}>
                    やめる
                  </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setOpened({ at: state })} disabled={pending}>
                未作成の人の明示書をまとめて作る（{names.length}人）
              </Button>
            )}
            {state && (state.ok ? <Notice tone="ok">{state.message}</Notice> : <Notice tone="error">{state.error}</Notice>)}
          </form>
        </>
      )}
    </Card>
  );
}
