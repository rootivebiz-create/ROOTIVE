"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { F, ResultLine, useFormAction, type FormAction } from "~/components/form-field";

/**
 * 調整をまとめて入れる：Excel の「名前・内容・金額」の列を選んでコピーし、貼り付ける。
 * 燃料・高速代・立替・事故の負担など、人ごとに額が変わるものを 1 件ずつ打たなくてよいように。
 */
export function AdjustmentPasteForm({ action, month }: { action: FormAction; month: string }) {
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const formRef = useRef<HTMLFormElement>(null);
  const [text, setText] = useState("");
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;

  // 入れたら空に戻す（続けて入れられるように）
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setText("");
    }
  }, [state]);

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="month" value={month} />
      <F
        label="Excel から貼り付け（名前・内容・金額）"
        error={fe.text}
        hint={`名前は台帳の名前か番号。金額の−は支払を減らします（△1,000・(1,000) も読めます）。いま ${lines} 行`}
      >
        <textarea
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          required
          placeholder={"山田 太郎\t燃料代\t-12,400\n佐藤 花子\t高速代の立替\t3,280"}
          className="block w-full rounded-lg border border-border bg-card p-3 font-mono text-sm text-foreground focus:border-foreground"
        />
      </F>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="内容（全員同じとき・任意）" error={fe.defaultLabel} hint="貼り付けた表が「名前・金額」の 2 列だけのとき、この名前にします">
          <Input name="defaultLabel" maxLength={60} placeholder="例：燃料代" />
        </F>
        <F label="金額の向き" error={fe.sign}>
          <Select name="sign" defaultValue="asIs">
            <option value="asIs">書いてある符号のまま（−は減らす）</option>
            <option value="minus">すべて支払から引く</option>
            <option value="plus">すべて支払に足す</option>
          </Select>
        </F>
      </div>
      <F label="根拠（任意）" error={fe.basis} hint="領収書・事故の報告・合意書 など（全員に同じものを付けます）">
        <Input name="basis" maxLength={200} />
      </F>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="taxable" className="mt-1 h-5 w-5 shrink-0" />
        <span>
          消費税の対象にする
          <span className="block text-xs text-muted-foreground">立替の精算などは対象にしないことが多いです。迷うときは、税理士の先生に確かめることをおすすめします。</span>
        </span>
      </label>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="agreedInWriting" className="mt-1 h-5 w-5 shrink-0" />
        <span>
          書面で合意している
          <span className="block text-xs text-muted-foreground">
            合意の記録が無い差し引きは、見張り番が「報酬の減額のおそれ（フリーランス法 第5条）」として知らせます。
          </span>
        </span>
      </label>
      <Button type="submit" disabled={pending || lines === 0}>
        {pending ? "入れています…" : `まとめて入れる（${lines} 行）`}
      </Button>
      <p className="text-xs text-muted-foreground">読めない行が 1 行でもあれば、何も入れずに、どの行がなぜかをお知らせします。</p>
      <ResultLine state={state} />
    </form>
  );
}
