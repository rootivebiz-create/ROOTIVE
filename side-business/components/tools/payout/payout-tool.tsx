"use client";

/**
 * 無料ツール：業務委託の報酬・源泉徴収・振込額の計算（業種別の見本つき）。
 * 入れた内容はこの画面の中だけで計算し、送信も保存もしない。計算はすべて lib/engine の buildPayout に任せる。
 * 見本の人名・会社名はすべて架空。
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Card, Money, buttonClass } from "@/components/ui";
import { PRESETS, getPreset, type PresetId } from "@/lib/engine/presets";
import { buildPayout } from "@/lib/engine/statement";
import { DEFAULT_CONSUMPTION_TAX_RATE, en, percent } from "@/lib/engine/types";
import { WITHHOLDING_CATEGORIES, withholdingRateFor } from "@/lib/engine/withholding";
import { AddButton, Check, Choice, DateField, NumField, RemoveButton, SelectField, TextField } from "./fields";
import { LineEditor } from "./line-editor";
import { PayoutResultView } from "./result";
import {
  DEDUCTION_KIND_LABELS,
  DEDUCTION_KIND_ORDER,
  ORDER_SIDE_METHODS,
  YEAR_CHOICES,
  blankLine,
  formForPreset,
  isEarningModel,
  presetFromSearch,
  toPayoutInput,
  withServiceMonth,
  type DeductionForm,
  type LineForm,
  type PayeeForm,
  type PayoutForm,
  type ReimbursementForm,
  type TermsForm,
} from "./state";

const MAX_LINES = 12;
const MAX_ROWS = 8;

const MONTH_CHOICES = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` }));

export function PayoutTool({ initialPreset }: { initialPreset: PresetId }) {
  const [form, setForm] = useState<PayoutForm>(() => formForPreset(initialPreset));
  // 行・区分・段階の id。見本を読み込むたびに、見本の続きの番号から配る
  const idRef = useRef(form.nextId);
  const takeId = () => idRef.current++;
  const presetName = useId();

  const preset = getPreset(form.presetId);
  const { terms } = preset;
  const { input, errors } = useMemo(() => toPayoutInput(form), [form]);
  const result = useMemo(() => buildPayout(input), [input]);

  function load(next: PayoutForm) {
    idRef.current = next.nextId;
    setForm(next);
  }

  // 戻るボタンで戻ったとき、前に表示した見本（サーバーが最初に描いたもの）が残ることがあるので、
  // 表示したあとで URL の ?preset= に合わせ直す（サーバーの出力は変えないので、ハイドレーションはずれない）
  const shownPreset = useRef(form.presetId);
  useEffect(() => {
    shownPreset.current = form.presetId;
  }, [form.presetId]);
  useEffect(() => {
    function syncWithUrl() {
      const id = presetFromSearch(window.location.search);
      if (id === shownPreset.current) return;
      const next = formForPreset(id);
      idRef.current = next.nextId;
      setForm(next);
    }
    syncWithUrl();
    window.addEventListener("popstate", syncWithUrl);
    window.addEventListener("pageshow", syncWithUrl);
    return () => {
      window.removeEventListener("popstate", syncWithUrl);
      window.removeEventListener("pageshow", syncWithUrl);
    };
  }, []);

  function choosePreset(id: PresetId) {
    load(formForPreset(id));
    try {
      window.history.replaceState(null, "", `${window.location.pathname}?preset=${id}`);
    } catch {
      // URL を変えられなくても計算には関係ない
    }
  }

  const patchPayee = (patch: Partial<PayeeForm>) => setForm((f) => ({ ...f, payee: { ...f.payee, ...patch } }));
  const patchTerms = (patch: Partial<TermsForm>) => setForm((f) => ({ ...f, terms: { ...f.terms, ...patch } }));
  const patchLine = (id: number, patch: Partial<LineForm>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const patchReimbursement = (id: number, patch: Partial<ReimbursementForm>) =>
    setForm((f) => ({ ...f, reimbursements: f.reimbursements.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const patchDeduction = (id: number, patch: Partial<DeductionForm>) =>
    setForm((f) => ({ ...f, deductions: f.deductions.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));

  function addLine() {
    const line = blankLine(preset, takeId);
    setForm((f) => ({ ...f, lines: [...f.lines, line] }));
  }
  function addReimbursement() {
    const row: ReimbursementForm = { id: takeId(), label: "交通費", amount: "", paidWithFee: true };
    setForm((f) => ({ ...f, reimbursements: [...f.reimbursements, row] }));
  }
  function addDeduction() {
    const row: DeductionForm = { id: takeId(), label: "", amount: "", kind: "fee", agreed: false, basis: "" };
    setForm((f) => ({ ...f, deductions: [...f.deductions, row] }));
  }

  const [serviceYear, serviceMonthNo] = form.serviceMonth.split("-").map(Number);
  const setServiceMonth = (y: number, m: number) =>
    setForm((f) => withServiceMonth(f, `${y}-${String(m).padStart(2, "0")}`));

  // 行ごとの結果（buildPayout は行を入れた順に返す）と、差し引きの元の額を自動にするときの「上の行の合計」
  let running = 0;
  const lineInfo = form.lines.map((line, i) => {
    const computed = result.lines[i] ? { amount: result.lines[i].amount, detail: result.lines[i].detail } : null;
    const precedingTotal = running;
    if (isEarningModel(line.model) && computed) running += computed.amount;
    return { computed, precedingTotal };
  });

  const hasGaikoin = form.lines.some((l) => isEarningModel(l.model) && l.withholding === "ko4_gaikoin");
  const gaikoinAllowance = withholdingRateFor(input.paymentTerms?.payOn ?? input.serviceDate).gaikoinMonthlyDeduction;
  const sample = preset.samples.find((s) => s.id === form.sampleId) ?? preset.samples[0];

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <Card>
          <h2 className="text-lg font-bold">業種の見本を選ぶ</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            見本の人名・会社名はすべて架空です。選ぶと、下の入力欄が見本に置きかわります。
          </p>
          <fieldset className="mt-3 min-w-0">
            <legend className="sr-only">業種</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESETS.map((p) => (
                <label
                  key={p.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold has-checked:border-foreground has-checked:bg-accent has-checked:text-accent-foreground"
                >
                  <input
                    type="radio"
                    name={presetName}
                    value={p.id}
                    checked={form.presetId === p.id}
                    onChange={() => choosePreset(p.id)}
                    className="size-5 shrink-0 accent-primary"
                  />
                  {p.shortLabel}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="mt-3 text-sm">
            <span className="font-bold">{preset.label}</span>
            <span className="block text-xs text-muted-foreground">
              {terms.payeeGroup}への支払。数量の例：{terms.qty}。発注する側：{preset.sampleCompany}
            </span>
          </p>
          <div className="mt-3 grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <SelectField
              label="見本（架空）"
              value={sample.id}
              options={preset.samples.map((s) => ({ value: s.id, label: s.title }))}
              onChange={(id) => load(formForPreset(form.presetId, id))}
            />
            <Button type="button" variant="secondary" onClick={() => load(formForPreset(form.presetId, sample.id))}>
              見本に戻す
            </Button>
          </div>
          <p className="mt-2 rounded-lg bg-muted p-3 text-sm">この見本で見ること：{sample.point}</p>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">支払先（{terms.payee}）</h2>
          <div className="mt-3 space-y-4">
            <TextField
              label="名前"
              value={form.payee.name}
              onChange={(name) => patchPayee({ name })}
              hint="結果の見出しに出すだけです。送信・保存はしません。"
            />
            <Choice
              legend="インボイス登録"
              value={form.payee.invoiceRegistered ? "yes" : "no"}
              onChange={(v) => patchPayee({ invoiceRegistered: v === "yes" })}
              options={[
                { value: "yes", label: "登録している", note: "適格請求書発行事業者（課税事業者）" },
                { value: "no", label: "登録していない", note: "免税事業者など" },
              ]}
            />
            <Choice
              legend="個人か法人か"
              value={form.payee.isCorporation ? "corp" : "person"}
              onChange={(v) => patchPayee({ isCorporation: v === "corp" })}
              options={[
                { value: "person", label: "個人", note: "区分によっては源泉徴収をする" },
                { value: "corp", label: "法人", note: "ここで扱う報酬の源泉徴収はしない" },
              ]}
            />
            <Choice
              legend="消費税を上乗せするか"
              value={form.payee.paysTaxOnTop ? "yes" : "no"}
              onChange={(v) => patchPayee({ paysTaxOnTop: v === "yes" })}
              options={[
                {
                  value: "yes",
                  label: form.payee.invoiceRegistered ? "消費税を上乗せする" : "消費税相当額を上乗せする",
                  note: `税抜の報酬 × ${percent(DEFAULT_CONSUMPTION_TAX_RATE)} を足して払う`,
                },
                { value: "no", label: "上乗せしない", note: "はじめから総額で決めている" },
              ]}
              hint={
                form.payee.invoiceRegistered
                  ? undefined
                  : "免税であることを理由に、報酬や消費税相当額を一方的に下げると、フリーランス法の減額・買いたたきなどの問題になりえます。"
              }
            />
            {form.payee.paysTaxOnTop && (
              <Check
                checked={form.payee.taxShownSeparately}
                onChange={(taxShownSeparately) => patchPayee({ taxShownSeparately })}
                hint="分けて書いていなければ、源泉徴収は消費税を含めた額にかけます（原則）。インボイスでない請求書や、免税の方の請求書でも、分けて書いてあれば税抜でかまいません。"
              >
                請求書（支払明細）で、消費税をはっきり分けて書いている
              </Check>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">報酬の行</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            同じ人への1回の支払にまとめる報酬を、行ごとに入れます。金額は、消費税を上乗せするなら税抜で、上乗せしないなら消費税（相当額）も含めた総額で入れます。1円未満は切り捨てます。
          </p>
          <ol className="mt-3 space-y-3">
            {form.lines.map((line, i) => (
              <LineEditor
                key={line.id}
                line={line}
                index={i}
                preset={preset}
                computed={lineInfo[i].computed}
                precedingTotal={lineInfo[i].precedingTotal}
                onPatch={(patch) => patchLine(line.id, patch)}
                onRemove={
                  form.lines.length > 1 ? () => setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.id !== line.id) })) : null
                }
                takeId={takeId}
              />
            ))}
          </ol>
          <div className="mt-3">
            <AddButton onClick={addLine} disabled={form.lines.length >= MAX_LINES}>
              行を足す
            </AddButton>
          </div>
          {preset.withholdingHints.length > 0 && (
            <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
              <p className="font-bold">{preset.shortLabel}での源泉の区分の目安（最終判断は税理士へ）</p>
              <ul className="mt-1 space-y-1">
                {preset.withholdingHints.map((h) => (
                  <li key={h.item}>
                    {h.item}：{h.category === "none" ? WITHHOLDING_CATEGORIES.none.label : WITHHOLDING_CATEGORIES[h.category].short}
                    {h.note && <span className="text-xs text-muted-foreground">（{h.note}）</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-bold">立替（交通費など）</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            報酬と一緒に本人へ払う交通費などは、源泉徴収の元に入ります。発注者が交通機関や宿へ直接払ったものは入りません（振込額にも入れず、参考として出します）。
          </p>
          {form.reimbursements.length > 0 && (
            <ul className="mt-3 space-y-3">
              {form.reimbursements.map((r, i) => (
                <li key={r.id} className="rounded-card border border-border p-3">
                  <div className="flex items-end gap-2">
                    <TextField
                      label={`立替${i + 1}`}
                      value={r.label}
                      onChange={(label) => patchReimbursement(r.id, { label })}
                      className="flex-1"
                    />
                    <RemoveButton
                      what={`立替${i + 1}（${r.label || "名前なし"}）`}
                      onClick={() => setForm((f) => ({ ...f, reimbursements: f.reimbursements.filter((x) => x.id !== r.id) }))}
                    />
                  </div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <NumField label="額" suffix="円" value={r.amount} onChange={(amount) => patchReimbursement(r.id, { amount })} integer />
                    <SelectField
                      label="払い方"
                      value={r.paidWithFee ? "with" : "direct"}
                      options={[
                        { value: "with", label: "報酬と一緒に本人へ払う" },
                        { value: "direct", label: "発注者が直接払った" },
                      ]}
                      onChange={(v) => patchReimbursement(r.id, { paidWithFee: v === "with" })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <AddButton onClick={addReimbursement} disabled={form.reimbursements.length >= MAX_ROWS}>
              立替を足す
            </AddButton>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">控除（報酬から差し引くもの）</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            控除は、源泉徴収を計算したあとで差し引きます（源泉の元は減りません）。取引条件として書面で明示し、合意したものだけにします。振込手数料は、支払う側の負担が基本です。
          </p>
          {form.deductions.length > 0 && (
            <ul className="mt-3 space-y-3">
              {form.deductions.map((d, i) => (
                <li key={d.id} className="rounded-card border border-border p-3">
                  <div className="flex items-end gap-2">
                    <TextField
                      label={`控除${i + 1}`}
                      value={d.label}
                      onChange={(label) => patchDeduction(d.id, { label })}
                      placeholder="教室の使用料 など"
                      className="flex-1"
                    />
                    <RemoveButton
                      what={`控除${i + 1}（${d.label || "名前なし"}）`}
                      onClick={() => setForm((f) => ({ ...f, deductions: f.deductions.filter((x) => x.id !== d.id) }))}
                    />
                  </div>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <NumField label="額" suffix="円" value={d.amount} onChange={(amount) => patchDeduction(d.id, { amount })} integer />
                    <SelectField
                      label="種類"
                      value={d.kind}
                      options={DEDUCTION_KIND_ORDER.map((k) => ({ value: k, label: DEDUCTION_KIND_LABELS[k] }))}
                      onChange={(kind) => patchDeduction(d.id, { kind })}
                    />
                  </div>
                  <TextField
                    label="根拠"
                    value={d.basis}
                    onChange={(basis) => patchDeduction(d.id, { basis })}
                    placeholder="業務委託契約 第○条"
                    className="mt-3"
                  />
                  <Check
                    checked={d.agreed}
                    onChange={(agreed) => patchDeduction(d.id, { agreed })}
                    hint="書面に書いていない・合意していない差し引きは、フリーランス法の「減額」にあたるおそれがあります"
                  >
                    取引条件で書面に明示・合意している
                  </Check>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <AddButton onClick={addDeduction} disabled={form.deductions.length >= MAX_ROWS}>
              控除を足す
            </AddButton>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">月と、発注する側の消費税</h2>
          <div className="mt-3 space-y-4">
            <fieldset className="min-w-0">
              <legend className="text-sm font-bold">役務の提供を受けた月（仕事をしてもらった月）</legend>
              <div className="mt-1 grid grid-cols-2 gap-3">
                <SelectField
                  label="年"
                  value={serviceYear}
                  options={YEAR_CHOICES.map((y) => ({ value: y, label: `${y}年` }))}
                  onChange={(y) => setServiceMonth(y, serviceMonthNo)}
                />
                <SelectField label="月" value={serviceMonthNo} options={MONTH_CHOICES} onChange={(m) => setServiceMonth(serviceYear, m)} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                インボイスの経過措置の割合は、請求書の日付や支払日ではなく、この月（課税仕入れの日）で決まります。
              </p>
            </fieldset>
            <Choice
              legend="発注する側の消費税の計算方法"
              value={form.orderSideTaxMethod}
              onChange={(orderSideTaxMethod) => setForm((f) => ({ ...f, orderSideTaxMethod }))}
              options={ORDER_SIDE_METHODS}
              columns={3}
              hint="免税の方への支払で控除できない負担が出るのは、原則課税のときだけです。分からなければ顧問の税理士に確かめてください。"
            />
            {hasGaikoin && (
              <NumField
                label="外交員に同じ月に払う給与（固定の部分）"
                suffix="円"
                value={form.gaikoinSalary}
                onChange={(gaikoinSalary) => setForm((f) => ({ ...f, gaikoinSalary }))}
                hint={`控除額（月${en(gaikoinAllowance)}）から先に引きます。固定の部分は給与として、給与の源泉を別に計算してください。`}
                integer
              />
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">支払日（任意）</h2>
          <Check
            checked={form.terms.enabled}
            onChange={(enabled) => patchTerms({ enabled })}
            hint="給付を受け取った日から60日以内か（フリーランス法）と、源泉税の納付期限を出します"
          >
            支払日も入れて確かめる
          </Check>
          {form.terms.enabled && (
            <div className="mt-2 space-y-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <DateField
                  label="給付を受け取った日"
                  value={form.terms.receivedOn}
                  onChange={(receivedOn) => patchTerms({ receivedOn })}
                />
                <DateField label="支払日" value={form.terms.payOn} onChange={(payOn) => patchTerms({ payOn })} />
              </div>
              <p className="text-xs text-muted-foreground">月単位で締めるときは、受け取った日に締切日を入れます。</p>
              <Check
                checked={form.terms.monthlyClosing}
                onChange={(monthlyClosing) => patchTerms({ monthlyClosing })}
                hint="月単位で締めてまとめて払うことを合意し、明示書に書いているとき"
              >
                月単位で締めて払う
              </Check>
              <Check
                checked={form.terms.basedOnInvoiceReceipt}
                onChange={(basedOnInvoiceReceipt) => patchTerms({ basedOnInvoiceReceipt })}
              >
                支払期日を「請求書を受け取った日」から数えている
              </Check>
            </div>
          )}
        </Card>

        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-card px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_12px_rgba(0,0,0,0.08)] sm:mx-0 sm:rounded-card sm:border">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 leading-tight">
              <span className="block text-xs text-muted-foreground">振込額</span>
              <Money value={result.payout} className="text-xl font-bold" />
            </p>
            <p className="min-w-0 text-right text-xs leading-tight text-muted-foreground">
              <span className="block">源泉</span>
              <Money value={result.withholding} />
            </p>
            <a href="#payout-result" className={buttonClass("secondary", "shrink-0")}>
              内訳を見る
            </a>
          </div>
        </div>
      </div>

      <section id="payout-result" aria-labelledby="payout-result-title" className="scroll-mt-16 pt-4">
        <h2 id="payout-result-title" className="mb-3 text-xl font-bold">
          計算の結果
        </h2>
        <PayoutResultView input={input} result={result} errors={errors} preset={preset} serviceMonth={form.serviceMonth} />
      </section>
    </div>
  );
}
