"use client";

import { useActionState, useState } from "react";
import { Button, Field } from "@/components/ui";
import { yenText } from "@/lib/format";
import { closeMonthAction, reopenMonthAction, type CloseState, type ReopenState } from "~/app/(app)/close/actions";

function ErrorBox({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="whitespace-pre-line rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      {error}
    </p>
  );
}

/**
 * 「締める」：押すと、締めたら何が起きるかを見せてから確定する（2 段階）。
 * 止める理由があるときは押せない（サーバーでも同じ確認をする）。
 */
export function CloseMonthForm({
  month,
  monthLabel,
  drivers,
  total,
  changes,
  transferBatches,
  blockers,
}: {
  month: string;
  monthLabel: string;
  drivers: number;
  total: number;
  /** 締めるときの明細の変わり方（新しく作る・版が上がる・消える人数） */
  changes: { created: number; updated: number; removed: number };
  /** この月にすでに作った振込データの数 */
  transferBatches: number;
  blockers: string[];
}) {
  const [state, action, pending] = useActionState<CloseState, FormData>(closeMonthAction, undefined);
  const [asking, setAsking] = useState(false);

  if (blockers.length) {
    return (
      <div className="space-y-3">
        <p className="font-bold">まだ締められません</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <Button disabled className="w-full sm:w-auto">
          {monthLabel}を締める
        </Button>
      </div>
    );
  }

  if (!asking) {
    return (
      <div className="space-y-3">
        <ErrorBox error={state && !state.ok ? state.error : undefined} />
        <Button onClick={() => setAsking(true)} className="w-full sm:w-auto">
          {monthLabel}を締める…
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border-2 border-foreground p-4">
      <input type="hidden" name="month" value={month} />
      <p className="font-bold">{monthLabel}を締めます。よろしいですか？</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>明細を今の稼働・設定から最新にして保存します（{drivers}人・振込額の合計 {yenText(total)}）。</li>
        {changes.created > 0 && <li>まだ作っていない {changes.created}人ぶんの明細を、新しく作ります。</li>}
        {changes.updated > 0 && (
          <li>作ったあとに稼働や設定が変わった {changes.updated}人ぶんは版が上がります。送ってある人には、新しい版の確認をお願いすることになります。</li>
        )}
        {changes.removed > 0 && <li>稼働も調整も無くなった {changes.removed}人ぶんの明細は消します（操作の記録には残ります）。</li>}
        {transferBatches > 0 && changes.updated + changes.removed > 0 && (
          <li className="text-danger">明細が変わる人を含む振込データは使えなくなります。締めたあと、振込データの画面で作り直してください。</li>
        )}
        <li>締めたあとは、この月の稼働・調整・明細を、だれも変えられなくなります。</li>
        <li>実際に振り込んだ日の記録と、ドライバーの「確認しました」は、締めたあとでも残せます。</li>
        <li>締めを外せるのはオーナーだけです（理由を操作の記録に残します）。</li>
      </ul>
      <ErrorBox error={state && !state.ok ? state.error : undefined} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "締めています…" : "締める"}
        </Button>
        <Button variant="secondary" onClick={() => setAsking(false)} disabled={pending}>
          やめる
        </Button>
      </div>
    </form>
  );
}

/** 「締めを外す」（オーナーだけ・理由は必須） */
export function ReopenMonthForm({
  month,
  monthLabel,
  minLength,
  confirmed,
  executedBatches,
}: {
  month: string;
  monthLabel: string;
  minLength: number;
  /** 今の版を確認したドライバーの数 */
  confirmed: number;
  /** 振り込んだ日が記録されている振込データの数 */
  executedBatches: number;
}) {
  const [state, action, pending] = useActionState<ReopenState, FormData>(reopenMonthAction, undefined);
  const [reason, setReason] = useState("");
  const short = reason.trim().length < minLength;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="month" value={month} />
      <p className="text-sm">
        締めを外すと、{monthLabel}の稼働・調整・明細をまた直せるようになります。明細を作り直すと版が上がり、ドライバーにはもう一度「確認しました」をお願いすることになります。
        すでに作った振込データと金額が変わったときは、振込データも作り直しになります。
      </p>
      {(confirmed > 0 || executedBatches > 0) && (
        <ul className="list-disc space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 pl-8 text-sm">
          {confirmed > 0 && <li>{confirmed}人のドライバーが、この月の明細に「確認しました」を押しています。中身が変わると、その人たちにも確認をお願いし直すことになります。</li>}
          {executedBatches > 0 && (
            <li>
              振り込んだ日が記録された振込データが {executedBatches} 件あります。金額を変えると、振り込んだ額と明細が合わなくなります。差額の扱いは、ドライバーと話して決めてください。
            </li>
          )}
        </ul>
      )}
      <Field label={`締めを外す理由（${minLength} 文字以上。操作の記録に残ります）`} hint={state && !state.ok ? state.fieldErrors?.reason : undefined}>
        <textarea
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          required
          placeholder="例：28日のスポット便 2 件が稼働に入っていなかったため"
          className="block w-full rounded-lg border border-border bg-card p-3 text-base text-foreground focus:border-foreground"
        />
      </Field>
      <ErrorBox error={state && !state.ok ? state.error : undefined} />
      {state?.ok && (
        <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
          {state.message}
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={pending || short} className="w-full border-danger text-danger sm:w-auto">
        {pending ? "外しています…" : "締めを外す"}
      </Button>
    </form>
  );
}
