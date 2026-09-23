"use client";

import { useActionState, useState } from "react";
import { Button, Field, Input, buttonClass } from "@/components/ui";
import { yenText } from "@/lib/format";
import { adjustForBankHoliday, isBankHoliday, isDateString, shortDate } from "@/lib/tools/torihiki-joken";
import { createTransferAction, type CreateTransferState } from "~/app/(app)/transfer/actions";
import { daysBetween, todayJst } from "~/components/close/format";

type Props = {
  month: string;
  defaultDate: string;
  promisedPayDate: string;
  /** この月にすでに作った振込データの数 */
  earlierBatches: number;
  /** そのうち、振り込んだ日が記録されているもの（あれば全員ぶんは作れない） */
  executedBatches: number;
  all: { count: number; total: number };
  /** まだ振込データに入っていない人 */
  remaining: { count: number; total: number };
  /** 全銀のファイルを出せるか（振込依頼人の設定がそろっているか） */
  zenginReady: boolean;
  /** 前回の振込から口座が変わった人の数（全員・まだの人だけ）。いれば確かめた印が要る */
  bankChanged?: { all: number; remaining: number };
  /** 確かめた印に添えて送る値（画面を開いたあとに口座がまた変わったら、サーバーが断る） */
  bankKeys?: { all: string; remaining: string };
};

/** 振込データを作る（振込指定日を選んで作る。作ったらすぐダウンロードできる） */
export function CreateTransferForm({
  month,
  defaultDate,
  promisedPayDate,
  earlierBatches,
  executedBatches,
  all,
  remaining,
  zenginReady,
  bankChanged = { all: 0, remaining: 0 },
  bankKeys = { all: "", remaining: "" },
}: Props) {
  const [state, action, pending] = useActionState<CreateTransferState, FormData>(createTransferAction, undefined);
  const [date, setDate] = useState(defaultDate);
  const [scope, setScope] = useState<"all" | "remaining">(earlierBatches > 0 ? "remaining" : "all");
  const [confirmed, setConfirmed] = useState(false);
  const [bankChecked, setBankChecked] = useState(false);
  // 作ったあと（前のデータの数が変わったとき）は「まだの人だけ」に戻す（二重に作らないように）
  const [seenEarlier, setSeenEarlier] = useState(earlierBatches);
  if (seenEarlier !== earlierBatches) {
    setSeenEarlier(earlierBatches);
    setScope(earlierBatches > 0 ? "remaining" : "all");
    setConfirmed(false);
    setBankChecked(false);
  }
  const target = scope === "all" ? all : remaining;
  const changedCount = scope === "all" ? bankChanged.all : bankChanged.remaining;
  const reviewKey = scope === "all" ? bankKeys.all : bankKeys.remaining;
  const m = month.slice(0, 7);

  // 選んだ日についての注意（送る前に見せる。最後の判断はサーバーでも行う）
  const notes: { tone: "red" | "yellow"; text: string }[] = [];
  if (isDateString(date)) {
    if (isBankHoliday(date)) {
      notes.push({ tone: "red", text: `${shortDate(date)} は銀行の休みの日です。${shortDate(adjustForBankHoliday(date, "before"))} など、前の営業日にしてください。` });
    }
    const late = daysBetween(promisedPayDate, date);
    if (late > 0) notes.push({ tone: "red", text: `約束した支払日（${shortDate(promisedPayDate)}）より ${late} 日あとです。支払が遅れるおそれがあります。` });
    if (date < todayJst()) notes.push({ tone: "yellow", text: "過ぎた日付です。銀行が受け付けないことがあります。" });
  }
  const blocked =
    target.count === 0 || (scope === "all" && earlierBatches > 0 && (executedBatches > 0 || !confirmed)) || (changedCount > 0 && !bankChecked);
  const fe = state && !state.ok ? state.fieldErrors ?? {} : {};

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="month" value={month} />
      <Field label="振込指定日（お金が相手に届く日）" hint={fe.transferDate}>
        <Input type="date" name="transferDate" value={date} onChange={(e) => setDate(e.target.value)} required className="max-w-xs" />
      </Field>
      <p className="text-sm text-muted-foreground">
        明細に書いた支払日は <strong className="text-foreground">{shortDate(promisedPayDate)}</strong> です。
        {defaultDate !== promisedPayDate
          ? `銀行の休みの日なので、前の営業日の ${shortDate(defaultDate)} にしています。前にずらせば、約束の日までに届きます。`
          : "この日を初期値にしています。"}
        土日と年末年始は見ていますが、祝日は見ていません。祝日に当たるときは、前の営業日に直してください。
      </p>
      {notes.map((n) => (
        <p key={n.text} role="alert" className={`rounded-lg border p-3 text-sm ${n.tone === "red" ? "border-danger/40 bg-danger/10 text-danger" : "border-warning/40 bg-warning/10 text-warning"}`}>
          {n.text}
        </p>
      ))}

      {earlierBatches > 0 && (
        <fieldset className="space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-bold">だれを入れるか</legend>
          <p className="text-sm text-muted-foreground">この月の振込データはすでに {earlierBatches} 件あります。同じ人に二重に振り込まないよう気をつけてください。</p>
          <label className="flex min-h-11 items-start gap-3 py-1">
            <input type="radio" name="scope" value="remaining" checked={scope === "remaining"} onChange={() => setScope("remaining")} className="mt-1 h-5 w-5" />
            <span className="text-sm">
              <span className="font-bold">まだ振込データに入っていない人だけ</span>（{remaining.count}人・{yenText(remaining.total)}）
            </span>
          </label>
          <label className={`flex min-h-11 items-start gap-3 py-1 ${executedBatches > 0 ? "opacity-60" : ""}`}>
            <input
              type="radio"
              name="scope"
              value="all"
              checked={scope === "all"}
              onChange={() => setScope("all")}
              disabled={executedBatches > 0}
              className="mt-1 h-5 w-5"
            />
            <span className="text-sm">
              <span className="font-bold">全員ぶんを作り直す</span>（{all.count}人・{yenText(all.total)}）
              {executedBatches > 0 && (
                <span className="block text-muted-foreground">振り込んだ日が記録された振込データがあるため選べません（二重の振込になります）。</span>
              )}
            </span>
          </label>
          {scope === "all" && executedBatches === 0 && (
            <label className="flex min-h-11 items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3">
              <input type="checkbox" name="replaceConfirmed" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-5 w-5" />
              <span className="text-sm text-danger">前に作った振込データは、銀行に出していません（出していたら二重の振込になります）。</span>
            </label>
          )}
        </fieldset>
      )}
      {earlierBatches === 0 && <input type="hidden" name="scope" value="all" />}

      {changedCount > 0 && <input type="hidden" name="bankReviewKey" value={reviewKey} />}
      {changedCount > 0 && (
        <label className="flex min-h-11 items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3">
          <input
            type="checkbox"
            name="bankChangesConfirmed"
            checked={bankChecked}
            onChange={(e) => setBankChecked(e.target.checked)}
            className="mt-1 h-5 w-5"
          />
          <span className="text-sm text-danger">
            <span className="font-bold">口座が変わった人を確かめました（{changedCount}人）。</span>
            上の「前回の振込から口座が変わった人」を見て、ご本人に電話などで口座を確かめました。
          </span>
        </label>
      )}

      {state && !state.ok && (
        <p role="alert" className="whitespace-pre-line rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state?.ok && state.data && (
        <div role="status" className="space-y-3 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
          <p className="font-bold text-success">{state.message}</p>
          <p>
            {state.data.fileName}（{state.data.count}人・{yenText(state.data.total)}）
            {state.data.excluded > 0 && `。振込データに入らなかった人が ${state.data.excluded}人います（下の一覧を見てください）`}
          </p>
          {state.data.lateDays > 0 && (
            <p className="font-bold text-danger">
              振込指定日が、明細に書いた支払日（{shortDate(promisedPayDate)}）より {state.data.lateDays} 日あとです。支払が遅れるおそれがあります。
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {zenginReady && (
              <a href={`/api/transfer/${state.data.batchId}?m=${m}`} className={buttonClass("primary")}>
                全銀の振込データをダウンロード
              </a>
            )}
            <a href={`/api/transfer/${state.data.batchId}?format=csv&m=${m}`} className={buttonClass("secondary")}>
              振込の一覧（CSV）
            </a>
          </div>
        </div>
      )}

      <Button type="submit" disabled={pending || blocked} className="w-full sm:w-auto">
        {pending ? "作っています…" : `振込データを作る（${target.count}人・${yenText(target.total)}）`}
      </Button>
      {target.count === 0 && (
        <p className="text-sm text-muted-foreground">
          {scope === "remaining" && all.count > 0
            ? "全員、振込データに入っています。下の「作った振込データ」からダウンロードできます。"
            : "入れられる人がいません。下の「振込データに入らない人」を確かめてください。"}
        </p>
      )}
    </form>
  );
}
