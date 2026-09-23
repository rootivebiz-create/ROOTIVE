"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { saveCompanyAction, type CompanyState } from "~/app/(app)/onboarding/actions";
import { CLOSING_CHOICES, dayText, deadlineHint, OFFSET_LABEL, PAY_DAY_CHOICES, payRuleText, TAX_METHODS } from "~/server/features/onboarding/company";

const SOURCES = {
  toriteki: "https://www.jftc.go.jp/file/toriteki_leaflet.pdf",
  flQa: "https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html",
  registry: "https://www.invoice-kohyo.nta.go.jp/",
};

export type CompanyInitial = {
  closingDay: number;
  payMonthOffset: number;
  payDay: number;
  transferFeeBearer: "company" | "driver" | null;
  registrationNo: string | null;
  taxMethod: string;
  paymentTermsText: string | null;
};

/** 項目の下の誤り（赤）。Field の hint は灰色なので、誤りは別に出す */
function FieldError({ text }: { text?: string }) {
  return text ? <p className="mt-1 text-sm text-danger">{text}</p> : null;
}

function withCurrent(choices: readonly number[], current: number): number[] {
  return choices.includes(current) ? [...choices] : [...choices, current].sort((a, b) => (a === 0 ? 99 : a) - (b === 0 ? 99 : b));
}

/** 会社の基本（オーナーだけ）。選ぶと、支払までの日数の目安がすぐ出る */
export function CompanyForm({ initial, today }: { initial: CompanyInitial; today: string }) {
  const [state, action, pending] = useActionState<CompanyState, FormData>(saveCompanyAction, undefined);
  const [closingDay, setClosingDay] = useState(String(initial.closingDay));
  const [offset, setOffset] = useState(String(initial.payMonthOffset));
  const [payDay, setPayDay] = useState(String(initial.payDay));
  const [fee, setFee] = useState<string>(initial.transferFeeBearer ?? "");
  const [regNo, setRegNo] = useState(initial.registrationNo ?? "");
  const [tax, setTax] = useState(TAX_METHODS.some((t) => t.value === initial.taxMethod) ? initial.taxMethod : "general");
  const [terms, setTerms] = useState(initial.paymentTermsText ?? "");
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  const rule = payRuleText(Number(closingDay), Number(offset), Number(payDay));
  const hint = deadlineHint(Number(closingDay), Number(offset), Number(payDay), today);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => action(data));
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-lg font-bold">ドライバーへの支払の締め日と支払日</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Field label="締め日">
              <Select name="closingDay" value={closingDay} onChange={(e) => setClosingDay(e.target.value)}>
                {withCurrent(CLOSING_CHOICES, Number(initial.closingDay)).map((d) => (
                  <option key={d} value={d}>
                    {dayText(d)}
                  </option>
                ))}
              </Select>
            </Field>
            <FieldError text={fe.closingDay} />
          </div>
          <div>
            <Field label="支払う月">
              <Select name="payMonthOffset" value={offset} onChange={(e) => setOffset(e.target.value)}>
                {[0, 1, 2].map((o) => (
                  <option key={o} value={o}>
                    {OFFSET_LABEL[o]}
                  </option>
                ))}
              </Select>
            </Field>
            <FieldError text={fe.payMonthOffset} />
          </div>
          <div>
            <Field label="支払日">
              <Select name="payDay" value={payDay} onChange={(e) => setPayDay(e.target.value)}>
                {withCurrent(PAY_DAY_CHOICES, Number(initial.payDay)).map((d) => (
                  <option key={d} value={d}>
                    {dayText(d)}
                  </option>
                ))}
              </Select>
            </Field>
            <FieldError text={fe.payDay} />
          </div>
        </div>
        <p className="text-sm">
          いまの設定：<span className="font-bold">{rule}</span>
        </p>
        {hint && (
          <p
            className={`rounded-lg border p-3 text-sm ${
              hint.tone === "ok" ? "border-success/40 bg-success/10" : hint.tone === "caution" ? "border-warning/40 bg-warning/10" : "border-danger/40 bg-danger/10"
            }`}
          >
            {hint.text}
            {hint.tone !== "ok" && (
              <>
                {" "}
                <a href={SOURCES.flQa} target="_blank" rel="noopener noreferrer">
                  公正取引委員会 フリーランス法 Q&amp;A
                </a>
              </>
            )}
          </p>
        )}
        <div>
          <Field label="取引条件（契約書）に書いてある支払期日の文言（任意）" hint="書いてあるとおりに写してください。見張り番が「期間で書いていないか」などを確かめます。">
            <Input name="paymentTermsText" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={`例：${rule}`} maxLength={200} />
          </Field>
          <FieldError text={fe.paymentTermsText} />
        </div>
        {!terms && (
          <Button variant="ghost" onClick={() => setTerms(rule)} className="w-full sm:w-auto">
            「{rule}」と入れる
          </Button>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-lg font-bold">振込手数料はどちらが持ちますか</legend>
        {fe.transferFeeBearer && <p className="text-sm text-danger">{fe.transferFeeBearer}</p>}
        {(
          [
            ["company", "会社が持つ", "振込額をそのまま振り込みます。"],
            ["driver", "ドライバーが持つ（振込額から差し引く）", "この設定のあいだは、見張り番が毎月お知らせします。"],
          ] as const
        ).map(([value, label, note]) => (
          <label key={value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
            <input type="radio" name="transferFeeBearer" value={value} checked={fee === value} onChange={() => setFee(value)} className="mt-1 h-5 w-5" />
            <span>
              <span className="block font-bold">{label}</span>
              <span className="block text-sm text-muted-foreground">{note}</span>
            </span>
          </label>
        ))}
        {fee === "driver" && (
          <p className="text-sm">
            振込手数料をドライバーの負担にして振込額から差し引くと、報酬の減額にあたるおそれがあります（取適法の対象になる取引では、合意があっても）。取引条件と、会社の負担にする設定の確認をおすすめします（
            <a href={SOURCES.toriteki} target="_blank" rel="noopener noreferrer">
              公正取引委員会 取適法リーフレット
            </a>
            ）。
          </p>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-lg font-bold">インボイスと消費税</legend>
        <div>
          <Field label="会社の登録番号（T と 13 桁。登録していなければ空のまま）" hint="明細（仕入明細書）に載ります。全角・ハイフン入りでも読めます。">
            <Input
              name="registrationNo"
              value={regNo}
              onChange={(e) => setRegNo(e.target.value)}
              placeholder="T と 13 桁の数字"
              autoComplete="off"
              inputMode="text"
              aria-invalid={fe.registrationNo ? true : undefined}
            />
          </Field>
          <FieldError text={fe.registrationNo} />
        </div>
        <p className="text-xs text-muted-foreground">
          番号が合っているかは{" "}
          <a href={SOURCES.registry} target="_blank" rel="noopener noreferrer">
            国税庁 適格請求書発行事業者 公表サイト
          </a>{" "}
          で確かめられます。
        </p>
        <div className="space-y-2">
          <p className="text-sm font-bold">会社の消費税の計算方法</p>
          {fe.taxMethod && <p className="text-sm text-danger">{fe.taxMethod}</p>}
          {TAX_METHODS.map((t) => (
            <label key={t.value} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3">
              <input type="radio" name="taxMethod" value={t.value} checked={tax === t.value} onChange={() => setTax(t.value)} className="mt-1 h-5 w-5" />
              <span>
                <span className="block font-bold">{t.label}</span>
                <span className="block text-sm text-muted-foreground">{t.hint}</span>
              </span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">どちらか分からないときは、顧問の税理士さんに確かめてください。あとで設定から変えられます。</p>
        </div>
      </fieldset>

      {state && !state.ok && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <div role="status" className="space-y-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
          <p className="text-success">{state.message}</p>
          <Link href="/onboarding/drivers" className="inline-flex min-h-11 items-center font-bold">
            次の手順「ドライバー」へ →
          </Link>
        </div>
      )}
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "保存しています…" : "保存する"}
      </Button>
    </form>
  );
}
