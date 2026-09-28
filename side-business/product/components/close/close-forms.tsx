"use client";

import { useState } from "react";
import { Button, NumberInput } from "@/components/ui";
import { yenText } from "@/lib/format";
import { closeMonthAction, reopenMonthAction, type CloseState, type ReopenState } from "~/app/(app)/close/actions";
import { F, fieldMessages, useFormAction, type FormState } from "~/components/form-field";

/** 誤りの帯（入力欄ごとの誤りも並べる） */
function ErrorBox({ state }: { state: FormState }) {
  if (!state || state.ok) return null;
  const lines = [state.error, ...fieldMessages(state).map((m) => `・${m}`)];
  return (
    <p role="alert" className="whitespace-pre-line rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      {lines.join("\n")}
    </p>
  );
}

/** 締めにかかった時間（任意）。導入の前と後で比べるのに使う */
function MinutesField({ defaultValue, error }: { defaultValue?: number | null; error?: string }) {
  return (
    <F
      label="この月の締めにかかった時間（分・任意）"
      error={error}
      hint="取り込みから締めるまで、だいたい何分かかりましたか。導入の前と後で比べるのに使います。空のままでもかまいません。"
    >
      <NumberInput name="minutesSpent" defaultValue={defaultValue ?? ""} inputMode="numeric" placeholder="例：90" className="max-w-40" />
    </F>
  );
}

type RedIssue = { key: string; title: string; subjectLabel?: string | null };

/**
 * 「締める」：押すと、締めたら何が起きるかを見せてから確定する（2 段階）。
 * 止める理由があるときは押せない（サーバーでも同じ確認をする）。
 * 見張り番の赤（未確認）だけが残っているときは、オーナーだけが理由を書いて締められる。
 */
export function CloseMonthForm({
  month,
  monthLabel,
  drivers,
  total,
  changes,
  transferBatches,
  blockers,
  isOwner = false,
  overridable = false,
  redIssues = [],
  overrideMin = 10,
  minutesDefault = null,
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
  /** 締める人がオーナーか */
  isOwner?: boolean;
  /** 止めている理由が見張り番の赤（未確認）だけか */
  overridable?: boolean;
  /** 残っている赤い指摘（オーナーが理由を書くときに見せる） */
  redIssues?: RedIssue[];
  overrideMin?: number;
  /** 前に締めたときに入れた分数（締め直すときの初期値） */
  minutesDefault?: number | null;
}) {
  // onSubmit から送る（断られたときも、締めにかかった時間などの入力を消さない）
  const { state, pending, onSubmit, fe } = useFormAction<NonNullable<CloseState>>(closeMonthAction);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const ownerOverride = blockers.length > 0 && overridable && isOwner;

  if (blockers.length && !ownerOverride) {
    return (
      <div className="space-y-3">
        <p className="font-bold">まだ締められません</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        {overridable && (
          <p className="text-sm text-muted-foreground">
            直せない事情があるときは、オーナーが理由を書いて締めることもできます（理由は操作の記録に残ります）。オーナーに相談してください。
          </p>
        )}
        <Button disabled className="w-full sm:w-auto">
          {monthLabel}を締める
        </Button>
      </div>
    );
  }

  if (!asking) {
    return (
      <div className="space-y-3">
        {ownerOverride && (
          <div className="space-y-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
            <p className="font-bold text-danger">見張り番の赤い指摘が {redIssues.length} 件残っています</p>
            <p>
              ふだんは、直すか、内容を確かめて「確認済み」にしてから締めます。直せない事情があるときは、オーナーだけが理由を書いて、このまま締められます（理由と指摘は操作の記録に残ります）。
            </p>
          </div>
        )}
        <ErrorBox state={state} />
        <Button onClick={() => setAsking(true)} className="w-full sm:w-auto">
          {ownerOverride ? `赤い指摘が残ったまま${monthLabel}を締める…` : `${monthLabel}を締める…`}
        </Button>
      </div>
    );
  }

  const short = ownerOverride && reason.trim().length < overrideMin;
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border-2 border-foreground p-4">
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

      {ownerOverride && (
        <div className="space-y-2">
          <p className="text-sm font-bold text-danger">残っている赤い指摘</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
            {redIssues.map((i) => (
              <li key={i.key}>
                {i.title}
                {i.subjectLabel ? `（${i.subjectLabel}）` : ""}
              </li>
            ))}
          </ul>
          <F
            label={`赤い指摘が残ったまま締める理由（${overrideMin} 文字以上・操作の記録に残ります）`}
            error={fe.overrideReason}
            hint={`いま ${reason.trim().length} 文字`}
          >
            <textarea
              name="overrideReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              required
              placeholder="例：◯◯さんの件は、ご本人と話して来月の明細で直すことにした。支払日に間に合わせるため先に締める"
              className="block w-full rounded-lg border border-border bg-card p-3 text-base text-foreground focus:border-foreground"
            />
          </F>
        </div>
      )}

      <MinutesField defaultValue={minutesDefault} error={fe.minutesSpent} />

      <ErrorBox state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || short}>
          {pending ? "締めています…" : ownerOverride ? "理由を残して締める" : "締める"}
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
  const { state, pending, onSubmit, fe } = useFormAction<NonNullable<ReopenState>>(reopenMonthAction);
  const [reason, setReason] = useState("");
  const short = reason.trim().length < minLength;
  return (
    <form onSubmit={onSubmit} className="space-y-3">
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
              振り込んだ日が記録された振込データが {executedBatches} 件あります。金額を変えると、振り込んだ額と明細が合わなくなります。明細を作り直したあと、振込データの画面の「振り込んだ額と明細の額の差」に人ごとの差が出るので、翌月の明細で精算するか、別に精算したかを記録してください。精算の仕方は、ドライバーと話して決めてください。
            </li>
          )}
        </ul>
      )}
      <F label={`締めを外す理由（${minLength} 文字以上。操作の記録に残ります）`} error={fe.reason}>
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
      </F>
      <ErrorBox state={state} />
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
