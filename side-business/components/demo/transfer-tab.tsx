"use client";

import { useMemo, useState } from "react";
import { Button, Card, Field, Input, Money, Select } from "@/components/ui";
import { cx } from "@/lib/cx";
import { jpDate } from "@/lib/format";
import type { MonthSummary } from "@/lib/payroll/calc";
import type { AccountType, MonthData } from "@/lib/payroll/types";
import { buildZenginRecords, toZenginKana, validateTransfers, zenginBytes, type Requester } from "@/lib/payroll/zengin";
import { toMMDD, zenginFileName } from "./format";
import { ACCOUNT_TYPES, Issues, KanaPreview, SectionTitle, textButton } from "./parts";
import type { DemoActions } from "./state";
import { groupIssues, transferRows } from "./transfers";

type Props = {
  data: MonthData;
  summary: MonthSummary;
  actions: DemoActions;
  requester: Requester;
  setRequester: (patch: Partial<Requester>) => void;
  onGoSettings: () => void;
};

export function TransferTab({ data, summary, actions, requester, setRequester, onGoSettings }: Props) {
  const [error, setError] = useState<string | null>(null);
  const { rows, transfers } = useMemo(() => transferRows(summary.statements), [summary.statements]);
  const issues = useMemo(() => groupIssues(validateTransfers(requester, transfers)), [requester, transfers]);
  const mmdd = toMMDD(data.settings.payDate);
  const ok = transfers.length > 0 && mmdd !== null && issues.requester.length === 0 && issues.byIndex.size === 0;
  const records = useMemo(() => {
    if (!ok || !mmdd) return null;
    try {
      return buildZenginRecords(requester, mmdd, transfers);
    } catch {
      return null;
    }
  }, [ok, mmdd, requester, transfers]);
  const total = transfers.reduce((a, t) => a + t.amount, 0);

  const download = () => {
    setError(null);
    if (!records) return;
    try {
      const bytes = zenginBytes(records);
      const blob = new Blob([new Uint8Array(bytes)], { type: "text/plain;charset=shift_jis" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zenginFileName(data.settings.month);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ファイルを作れませんでした");
    }
  };

  const field = (
    key: Exclude<keyof Requester, "accountType">,
    label: string,
    opts: { hint?: string; numeric?: boolean; max?: number; kana?: boolean } = {},
  ) => (
    <Field label={label} hint={opts.hint}>
      <Input
        value={requester[key]}
        onChange={(e) => setRequester({ [key]: e.target.value } as Partial<Requester>)}
        inputMode={opts.numeric ? "numeric" : undefined}
        maxLength={opts.max}
        autoComplete="off"
        className={opts.numeric ? "num" : undefined}
      />
      {opts.kana && <KanaPreview value={requester[key]} />}
    </Field>
  );

  return (
    <div className="space-y-8">
      <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
        支払明細の振込額から、銀行のネットバンキングに取り込む<strong>総合振込のファイル（全銀協の形式・120 桁）</strong>
        {"を作ります。デモのデータは架空です。実際の銀行には取り込まないでください。"}
      </p>

      <section>
        <SectionTitle>振込元（会社の口座）</SectionTitle>
        <Card className="mt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("code", "振込依頼人コード（10 桁）", { numeric: true, max: 10, hint: "銀行から知らされる番号です" })}
            {field("nameKana", "依頼人名（カナ）", { kana: true })}
            {field("bankCode", "金融機関コード（4 桁）", { numeric: true, max: 4 })}
            {field("bankNameKana", "金融機関名（カナ）", { kana: true })}
            {field("branchCode", "支店コード（3 桁）", { numeric: true, max: 3 })}
            {field("branchNameKana", "支店名（カナ）", { kana: true })}
            <Field label="預金種目">
              <Select value={requester.accountType} onChange={(e) => setRequester({ accountType: e.target.value as AccountType })}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
            {field("accountNumber", "口座番号（7 桁まで）", { numeric: true, max: 7 })}
            <Field label="振込日" hint="支払明細の振込予定日と同じです">
              <Input
                type="date"
                value={data.settings.payDate}
                onChange={(e) => actions.setSettings({ payDate: e.target.value })}
              />
            </Field>
          </div>
          <Issues messages={[...issues.requester, ...(mmdd ? [] : ["振込日を入れてください"])]} />
        </Card>
      </section>

      <section>
        <SectionTitle>振込先</SectionTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {jpDate(data.settings.payDate)}に振り込む分：{transfers.length} 件・合計 <Money value={total} className="font-bold text-foreground" />
        </p>
        <ul className="mt-3 divide-y divide-border rounded-card border border-border bg-card">
          {rows.map((row) => {
            const st = row.statement;
            const b = st.driver.bank;
            const rowIssues = row.kind === "transfer" ? (issues.byIndex.get(row.index) ?? []) : [];
            return (
              <li key={st.driver.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{st.driver.name || "（名前なし）"}</p>
                  {b && row.kind === "transfer" && (
                    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {b.bankNameKana}（{b.bankCode}）{b.branchNameKana}（{b.branchCode}）
                      </span>
                      <span>
                        {b.accountType === "checking" ? "当座" : "普通"} <span className="num">{b.accountNumber}</span>
                      </span>
                      <span className="font-mono">{toZenginKana(b.holderKana).value}</span>
                    </p>
                  )}
                  {row.kind === "no-bank" && (
                    <>
                      <p className="text-sm font-bold text-warning">口座未登録</p>
                      <button type="button" className={cx(textButton(), "-ml-3")} onClick={onGoSettings}>
                        設定で口座を入れる
                      </button>
                    </>
                  )}
                  {row.kind === "no-amount" && <p className="text-sm text-muted-foreground">振込額が 0 円以下のため振り込みません</p>}
                  <Issues messages={rowIssues} />
                </div>
                <Money value={st.total} className={cx("text-lg font-bold", row.kind !== "transfer" && "opacity-50")} />
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">支払明細がまだありません。</li>}
        </ul>
      </section>

      <section>
        <SectionTitle>振込データ</SectionTitle>
        <Card className="mt-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={download} disabled={!records} className="w-full sm:w-auto">
              振込データをダウンロード
            </Button>
            <span className="text-sm text-muted-foreground">
              {records
                ? zenginFileName(data.settings.month)
                : transfers.length === 0
                  ? "振り込む方がいません（口座があり、振込額が 1 円以上の方が対象です）"
                  : "赤字のところを直すと作れます"}
            </span>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          {records && (
            <>
              <p className="mt-4 text-xs text-muted-foreground">
                中身（全 {records.length} 行{records.length > 10 ? "のうち最初の 10 行" : ""}
                {"）：1 行目が振込元、続く行が振込先、最後の 2 行が件数・合計と終わりの印です。"}
              </p>
              <pre className="mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs leading-relaxed">
                {records.slice(0, 10).join("\n")}
              </pre>
            </>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            銀行ごとの細かい違い（最後の改行の有無など）は導入のときに合わせます。
          </p>
        </Card>
      </section>
    </div>
  );
}
