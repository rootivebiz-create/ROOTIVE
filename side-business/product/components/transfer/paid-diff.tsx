"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { yenText } from "@/lib/format";
import { settlePaidDifferenceAction, undoSettlementAction, type SettleState, type SimpleState } from "~/app/(app)/transfer/actions";
import { todayJst } from "~/components/close/format";

/** 差の向き（＋：払い足りない／−：払いすぎ）を言葉と額で */
export function diffText(n: number): string {
  if (n === 0) return "差なし";
  return n > 0 ? `払い足りない ${yenText(n)}` : `払いすぎ ${yenText(-n)}`;
}

function signedYen(n: number): string {
  return `${n < 0 ? "−" : "＋"}${yenText(Math.abs(n))}`;
}

/**
 * 振り込んだ額と明細の額の差を、どう精算したか記録する（1 人ぶん）。
 * 翌月の明細の調整で精算する／別の方法で精算したと記録する（別に振り込んだ・返してもらった など）。
 */
export function SettleForm({
  month,
  driverId,
  driverName,
  outstanding,
  nextMonthLabel,
  nextMonthClosed,
}: {
  month: string;
  driverId: string;
  driverName: string;
  /** まだ精算していない差（＋：払い足りない／−：払いすぎ） */
  outstanding: number;
  nextMonthLabel: string;
  nextMonthClosed: boolean;
}) {
  const [state, action, pending] = useActionState<SettleState, FormData>(settlePaidDifferenceAction, undefined);
  const [method, setMethod] = useState<"next_month" | "outside">(nextMonthClosed ? "outside" : "next_month");
  const [date, setDate] = useState("");
  const done = state?.ok === true;
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="driverId" value={driverId} />
      <input type="hidden" name="expected" value={outstanding} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">
          {driverName}さんの差（{diffText(outstanding)}）をどう精算しますか
        </legend>
        <label className={`flex min-h-11 items-start gap-2 text-sm ${nextMonthClosed ? "text-muted-foreground" : ""}`}>
          <input
            type="radio"
            name="method"
            value="next_month"
            checked={method === "next_month"}
            disabled={nextMonthClosed || done}
            onChange={() => setMethod("next_month")}
            className="mt-1 size-5"
          />
          <span>
            翌月（{nextMonthLabel}分）の明細で精算する（調整を 1 行足します：{signedYen(outstanding)}。消費税・源泉の対象にはしません）
            {nextMonthClosed && <span className="block text-xs">{nextMonthLabel}は締めてあるため選べません。</span>}
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input type="radio" name="method" value="outside" checked={method === "outside"} disabled={done} onChange={() => setMethod("outside")} className="mt-1 size-5" />
          <span>別の方法で精算したと記録する（差額だけ別に振り込んだ・返してもらった など）</span>
        </label>
      </fieldset>
      {method === "next_month" && outstanding < 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          払いすぎの分を{nextMonthLabel}分の明細から差し引くときは、先に{driverName}さんと話して、書面で合意した記録を残してください（足した調整は「書面の合意なし」で入るので、見張り番が確かめを出します）。
        </p>
      )}
      {method === "outside" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="精算した日" hint={state && !state.ok ? state.fieldErrors?.settledOn : undefined}>
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" name="settledOn" value={date} onChange={(e) => setDate(e.target.value)} required className="w-auto min-w-0 flex-1" />
              {!date && (
                <Button variant="ghost" onClick={() => setDate(todayJst())} className="px-2">
                  今日
                </Button>
              )}
            </div>
          </Field>
          <Field label="メモ（任意・200 文字まで）" hint={state && !state.ok ? state.fieldErrors?.note : undefined}>
            <Input name="note" maxLength={200} placeholder="例：12/10 に差額だけ振り込んだ" />
          </Field>
        </div>
      )}
      {state && !state.ok && (
        <p role="alert" className="whitespace-pre-line text-sm text-danger">
          {state.error}
        </p>
      )}
      {done && (
        <p role="status" className="text-sm text-success">
          {state.message}
          {state.data?.method === "next_month" && state.data.nextMonth && (
            <>
              {" "}
              <Link href={`/work?m=${state.data.nextMonth.slice(0, 7)}`} className="font-bold">
                {nextMonthLabel}の稼働と調整を見る →
              </Link>
            </>
          )}
        </p>
      )}
      {!done && (
        <Button type="submit" variant="primary" disabled={pending || (method === "outside" && !date)}>
          {pending ? "記録しています…" : "この仕方で記録する"}
        </Button>
      )}
    </form>
  );
}

/** 「別の方法で精算した」記録を取り消す（2 段階） */
export function UndoSettlementButton({ month, settleId }: { month: string; settleId: number }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(undoSettlementAction, undefined);
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <span>
        <Button variant="ghost" onClick={() => setAsking(true)} className="px-2 text-danger">
          この記録を取り消す
        </Button>
        {state && !state.ok && (
          <span role="alert" className="block text-sm text-danger">
            {state.error}
          </span>
        )}
      </span>
    );
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="settleId" value={settleId} />
      <span className="text-sm">取り消すと、まだ精算していない差に戻ります（取り消したことも記録に残ります）。</span>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "取り消しています…" : "取り消す"}
      </Button>
      <Button variant="secondary" onClick={() => setAsking(false)}>
        やめる
      </Button>
      {state && !state.ok && (
        <span role="alert" className="block text-sm text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
