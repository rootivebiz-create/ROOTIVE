"use client";

import { useMemo, useState } from "react";
import { Button, Card, Field, Input, Money, Select, TableWrap } from "@/components/ui";
import type { MonthSummary } from "@/lib/payroll/calc";
import { sum } from "@/lib/payroll/money";
import { parseWorkPaste } from "@/lib/payroll/paste";
import type { MonthData } from "@/lib/payroll/types";
import { jpDate, parseYen, qtyText, unitPrice } from "./format";
import { MonthField, NumberField, SectionTitle, commaDisplay, cx, td, tdNum, textButton, th, thNum } from "./parts";
import { pasteExample, qtyOf, type PasteMode } from "./reducer";
import type { DemoActions } from "./state";

type Props = { data: MonthData; summary: MonthSummary; actions: DemoActions };

export function WorkTab({ data, summary, actions }: Props) {
  const { drivers, projects, work, settings } = data;
  const subtotals = useMemo(() => new Map(summary.statements.map((st) => [st.driver.id, st.subtotal])), [summary.statements]);
  const projectTotals = useMemo(
    () => new Map(projects.map((p) => [p.id, sum(drivers.map((d) => qtyOf(work, d.id, p.id)))])),
    [drivers, projects, work],
  );

  return (
    <div className="space-y-8">
      <section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="対象の月" hint={`振込日：${jpDate(settings.payDate)}（月を変えると振込日も同じだけ動きます）`}>
            <MonthField value={settings.month} onValue={actions.setMonth} placeholder="2026-10" autoComplete="off" />
          </Field>
        </div>
      </section>

      <section>
        <SectionTitle>稼働の数量</SectionTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          ドライバーごとに、案件の数量（個・日・時間など）を入れます。支払明細と利益はすぐに計算し直されます。
        </p>
        {drivers.length === 0 || projects.length === 0 ? (
          <Card className="mt-3 text-sm text-muted-foreground">設定の画面で、ドライバーと案件を足してください。</Card>
        ) : (
          <>
            {/* パソコン：表（行＝ドライバー、列＝案件） */}
            <div className="mt-3 hidden md:block">
              <TableWrap>
                <table className="w-full min-w-max border-collapse rounded-card bg-card text-sm">
                  <thead>
                    <tr>
                      <th className={th} scope="col">
                        ドライバー
                      </th>
                      {projects.map((p) => (
                        <th key={p.id} className={thNum} scope="col">
                          <span className="block text-foreground">{p.name || "（名前なし）"}</span>
                          <span className="block font-normal">
                            {p.client ? `${p.client}・` : ""}
                            {unitPrice(p.payRate)}/{p.unit}
                          </span>
                        </th>
                      ))}
                      <th className={thNum} scope="col">
                        委託料（税抜）
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drivers.map((d) => (
                      <tr key={d.id}>
                        <th scope="row" className={cx(td, "whitespace-nowrap text-left font-bold")}>
                          {d.name || "（名前なし）"}
                        </th>
                        {projects.map((p) => (
                          <td key={p.id} className={cx(td, "text-right")}>
                            <div className="ml-auto w-24">
                              <NumberField
                                value={qtyOf(work, d.id, p.id)}
                                onValue={(q) => actions.setQty(d.id, p.id, q)}
                                display={commaDisplay}
                                placeholder="0"
                                aria-label={`${d.name}・${p.name}（${p.unit}）`}
                              />
                            </div>
                          </td>
                        ))}
                        <td className={tdNum}>
                          <Money value={subtotals.get(d.id) ?? 0} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" className={cx(td, "text-left text-xs text-muted-foreground")}>
                        合計
                      </th>
                      {projects.map((p) => (
                        <td key={p.id} className={cx(tdNum, "text-muted-foreground")}>
                          {qtyText(projectTotals.get(p.id) ?? 0)} {p.unit}
                        </td>
                      ))}
                      <td className={cx(tdNum, "font-bold")}>
                        <Money value={sum([...subtotals.values()])} />
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            </div>

            {/* スマホ：ドライバーごとのカード */}
            <ul className="mt-3 grid gap-3 md:hidden">
              {drivers.map((d) => (
                <li key={d.id}>
                  <Card>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-bold">{d.name || "（名前なし）"}</span>
                      <span className="text-sm text-muted-foreground">
                        委託料 <Money value={subtotals.get(d.id) ?? 0} className="text-foreground" />
                      </span>
                    </div>
                    <div className="mt-3 space-y-2">
                      {projects.map((p) => (
                        <label key={p.id} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 text-sm leading-snug">
                            <span className="block">{p.name || "（名前なし）"}</span>
                            <span className="block text-xs text-muted-foreground">
                              {p.client ? `${p.client}・` : ""}
                              {unitPrice(p.payRate)}/{p.unit}
                            </span>
                          </span>
                          <span className="block w-28 shrink-0">
                            <NumberField value={qtyOf(work, d.id, p.id)} onValue={(q) => actions.setQty(d.id, p.id, q)} display={commaDisplay} placeholder="0" />
                          </span>
                          <span className="w-9 shrink-0 text-sm text-muted-foreground">{p.unit}</span>
                        </label>
                      ))}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <PasteBox data={data} onApply={actions.applyPaste} />

      <AdjustmentsBox data={data} actions={actions} />
    </div>
  );
}

function PasteBox({ data, onApply }: { data: MonthData; onApply: DemoActions["applyPaste"] }) {
  const [text, setText] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const result = useMemo(
    () => (text.trim() ? parseWorkPaste(text, data.drivers, data.projects) : null),
    [text, data.drivers, data.projects],
  );

  const apply = (mode: PasteMode) => {
    if (!result || result.rows.length === 0) return;
    if (mode === "replace" && !window.confirm("今の稼働の数量をすべて消して、貼り付けた内容に置き換えますか？")) return;
    onApply(result.rows, mode);
    setDone(`${result.rows.length} 行を${mode === "replace" ? "置き換えました" : "足しました"}。`);
    setText("");
  };

  return (
    <section>
      <SectionTitle>Excel から貼り付け</SectionTitle>
      <Card className="mt-3">
        <p className="text-sm leading-relaxed">
          Excel やスプレッドシートで <strong>「ドライバー・案件・数量」の 3 列</strong>
          {"を選んでコピーし、下の欄に貼り付けます。1 行目の見出しはあってもなくても大丈夫です。"}
          名前は設定の画面の名前と同じにしてください（空白の違いは気にしません）。
        </p>
        <label className="mt-3 block">
          <span className="sr-only">貼り付ける稼働</span>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setDone(null);
            }}
            rows={6}
            spellCheck={false}
            placeholder={"ドライバー\t案件\t数量\n青木 翔太\t宅配（個建て）\t2310"}
            className="block w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-base text-foreground outline-none focus:border-foreground sm:text-sm"
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={textButton()} onClick={() => setText(pasteExample(data))}>
            例を入れる
          </button>
          {result && (
            <span className="text-sm text-muted-foreground">
              読めた行：<span className="num font-bold text-foreground">{result.rows.length}</span> 行
              {result.errors.length > 0 && (
                <>
                  ・直すところ：<span className="num font-bold text-danger">{result.errors.length}</span> か所
                </>
              )}
            </span>
          )}
        </div>
        {result && result.errors.length > 0 && (
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-3 text-sm text-danger">
            {result.errors.map((e, i) => (
              <li key={i}>
                <span className="num font-bold">{e.line} 行目</span>：{e.message}
              </li>
            ))}
          </ul>
        )}
        {result && result.errors.length > 0 && result.rows.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">直すところのある行は飛ばして、読めた行だけを反映します。</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" onClick={() => apply("replace")} disabled={!result || result.rows.length === 0}>
            置き換える
          </Button>
          <Button type="button" variant="secondary" onClick={() => apply("add")} disabled={!result || result.rows.length === 0}>
            足す
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          置き換える：今の数量を消して、貼り付けた内容にします。足す：今の数量に足します（同じ人・同じ案件は 1 つにまとめます）。
        </p>
        {done && (
          <p role="status" className="mt-2 text-sm font-bold text-success">
            {done}
          </p>
        )}
      </Card>
    </section>
  );
}

function AdjustmentsBox({ data, actions }: { data: MonthData; actions: DemoActions }) {
  const [driverId, setDriverId] = useState("");
  const [label, setLabel] = useState("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState(0);
  const names = new Map(data.drivers.map((d) => [d.id, d.name]));
  const selected = data.drivers.some((d) => d.id === driverId) ? driverId : (data.drivers[0]?.id ?? "");

  const add = () => {
    if (!selected || amount <= 0) return;
    actions.addAdjustment({ driverId: selected, label, amount: sign * amount });
    setLabel("");
    setAmount(0);
  };

  return (
    <section>
      <SectionTitle>調整（立替金・事故の負担など）</SectionTitle>
      <p className="mt-1 text-sm text-muted-foreground">消費税の対象外として、振込額に足したり引いたりします。</p>
      <Card className="mt-3">
        {data.adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだありません。</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.adjustments.map((a, i) => (
              <li key={i} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 text-sm leading-snug">
                  <span className="block font-bold">{names.get(a.driverId) ?? "（不明）"}</span>
                  <span className="block text-muted-foreground">{a.label}</span>
                </span>
                <Money value={a.amount} className="font-bold" />
                <button
                  type="button"
                  className={textButton("danger")}
                  aria-label={`${names.get(a.driverId) ?? ""}の「${a.label}」を消す`}
                  onClick={() => actions.removeAdjustment(i)}
                >
                  消す
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-border pt-4">
          <p className="text-sm font-bold">調整を足す</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="ドライバー">
              <Select value={selected} onChange={(e) => setDriverId(e.target.value)} disabled={data.drivers.length === 0}>
                {data.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name || "（名前なし）"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="内容">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例：高速代の立替" />
            </Field>
            <Field label="足す・引く">
              <Select value={sign} onChange={(e) => setSign(e.target.value === "-1" ? -1 : 1)}>
                <option value={1}>振込額に足す（＋）</option>
                <option value={-1}>振込額から引く（−）</option>
              </Select>
            </Field>
            <Field label="金額（円）">
              <NumberField value={amount} onValue={setAmount} parse={parseYen} display={commaDisplay} placeholder="0" />
            </Field>
          </div>
          <Button type="button" className="mt-3" onClick={add} disabled={!selected || amount <= 0}>
            追加する
          </Button>
        </div>
      </Card>
    </section>
  );
}
