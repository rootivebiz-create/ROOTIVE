"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { F, ResultLine, useFormAction, type FormAction } from "~/components/form-field";
import { ADJUST_SIGN_LABEL as SIGN_LABEL, type AdjustColumn } from "~/server/features/import/types";

type AdjustSign = AdjustColumn["sign"];

const FL_QA = "https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html";

/**
 * 金額の列を、その月の調整（人ごとの足し引き）として入れる設定。
 * 名前・向き・消費税・書面の合意・根拠を決めると、反映のときに人ごとに 1 件ずつ調整を作る（覚えた読み方にも残す）
 */
export function AdjustColumnForm({
  action,
  batchId,
  col,
  initial,
  mixedSigns,
}: {
  action: FormAction;
  batchId: string;
  col: number;
  initial: { label: string; sign: AdjustSign; taxable: boolean; agreedInWriting: boolean; basis: string | null };
  mixedSigns: boolean;
}) {
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const [sign, setSign] = useState<AdjustSign>(initial.sign);
  const [agreed, setAgreed] = useState(initial.agreedInWriting);
  const signs: AdjustSign[] = mixedSigns ? ["asIs", "minus", "plus"] : ["minus", "plus", "asIs"];
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="col" value={col} />
      <input type="hidden" name="enabled" value="1" />
      <F label="明細に出す名前" error={fe.label} hint="例：燃料代・高速代の立替・事故の負担">
        <Input name="label" defaultValue={initial.label} required maxLength={60} />
      </F>
      <fieldset>
        <legend className="text-sm font-bold">支払を</legend>
        <div className="mt-1 grid gap-2">
          {signs.map((v) => (
            <label
              key={v}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${sign === v ? "border-foreground bg-muted font-bold" : "border-border"}`}
            >
              <input type="radio" name="sign" value={v} checked={sign === v} onChange={() => setSign(v)} className="h-4 w-4" />
              {SIGN_LABEL[v]}
            </label>
          ))}
        </div>
        {mixedSigns && <p className="mt-1 text-xs text-muted-foreground">この列には＋と−の両方があります。</p>}
        {fe.sign && <p className="mt-1 text-xs font-bold text-danger">{fe.sign}</p>}
      </fieldset>
      <F label="根拠（任意）" error={fe.basis} hint="空なら「取り込み：ファイル名の〇〇の列」と入れます">
        <Input name="basis" defaultValue={initial.basis ?? ""} maxLength={200} />
      </F>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="taxable" defaultChecked={initial.taxable} className="mt-1 h-5 w-5 shrink-0" />
        <span>
          消費税の対象にする
          <span className="block text-xs text-muted-foreground">
            立替の精算・実費の受け渡しは対象にしないことが多いです。迷うときは、税理士の先生に確かめることをおすすめします。
          </span>
        </span>
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="agreedInWriting"
          checked={agreed}
          onChange={(e) => setAgreed(e.currentTarget.checked)}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <span>
          書面で合意している
          <span className="block text-xs text-muted-foreground">契約書・合意書などに、この差し引き（または精算）の決まりが書いてあるとき。</span>
        </span>
      </label>
      {sign !== "plus" && !agreed && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          書面での合意の記録が無い差し引きは、見張り番が「報酬の減額のおそれ（フリーランス法 第5条）」として知らせます。合意の有無と内容の確認をおすすめします。
          <a href={FL_QA} target="_blank" rel="noopener noreferrer" className="ml-1">
            公正取引委員会の Q&amp;A
          </a>
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "保存しています…" : "この月の調整として入れる"}
      </Button>
      <p className="text-xs text-muted-foreground">
        反映すると、人ごとに 1 件ずつ「稼働と調整」の調整に入ります。取り消すと一緒に消えます。次から同じ形のファイルも、同じように入れます。
      </p>
      <ResultLine state={state} />
    </form>
  );
}
