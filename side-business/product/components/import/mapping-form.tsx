"use client";

import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { F } from "~/components/form-field";
import { ResultLine, useFormAction, type FormAction } from "~/components/import/action-form";
import { ROLE_LABEL, SINGLE_ROLES, type ColumnRole } from "~/server/features/import/types";

export type MappingColumn = { index: number; letter: string; header: string; samples: string[]; role: ColumnRole; isDay: boolean };

const ORDER: ColumnRole[] = ["driver", "driverCode", "project", "qty", "value", "driverValue", "date", "note", "ignore"];

export type DriverMode = "column" | "fixed" | "sheets";

/** 列の役目を選ぶ。1 列ずつ「この列は何か」を選ぶだけ */
export function MappingForm({
  action,
  batchId,
  columns,
  projects,
  fixedProjectId,
  useDates,
  drivers = [],
  driverMode = "column",
  fixedDriverId = null,
  sheetCount = 1,
  marks = "",
}: {
  action: FormAction;
  batchId: string;
  columns: MappingColumn[];
  projects: { id: string; name: string }[];
  fixedProjectId: string | null;
  useDates: boolean;
  /** 「この表はすべて同じ人」で選ぶドライバー */
  drivers?: { id: string; name: string }[];
  driverMode?: DriverMode;
  fixedDriverId?: string | null;
  /** ファイルのシートの数（2 枚以上なら「シートごとに別の人」を出す） */
  sheetCount?: number;
  /** 印（○・出・休）の数え方（「○=1, 休=0」の形） */
  marks?: string;
}) {
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const [roles, setRoles] = useState<ColumnRole[]>(columns.map((c) => c.role));
  const [fixed, setFixed] = useState(fixedProjectId ?? "");
  const [mode, setMode] = useState<DriverMode>(driverMode);

  const count = (r: ColumnRole) => roles.filter((x) => x === r).length;
  const doubled = SINGLE_ROLES.filter((r) => count(r) > 1);
  const hasDate = roles.includes("date");
  const hasProject = roles.includes("project");
  const valueCols = columns.filter((c, i) => roles[i] === "value");
  const dayValues = valueCols.some((c) => c.isDay);
  const byDriver = roles.includes("driverValue");
  const needsFixed = !hasProject && (roles.includes("qty") || dayValues || byDriver);
  const hasDriverCol = roles.includes("driver") || roles.includes("driverCode") || byDriver;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="width" value={columns.length} />
      <ul className="divide-y divide-border rounded-card border border-border bg-card">
        {columns.map((c, i) => (
          <li key={c.index} className="grid gap-2 p-3 sm:grid-cols-[1fr_16rem] sm:items-center">
            <div className="min-w-0">
              <p className="font-bold">
                <span className="mr-2 inline-flex min-w-8 justify-center rounded bg-muted px-1.5 text-xs leading-6 text-muted-foreground">{c.letter}列</span>
                {c.header ? `「${c.header}」` : <span className="text-muted-foreground">（見出しなし）</span>}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{c.samples.length ? `例：${c.samples.join("、")}` : "（中身なし）"}</p>
            </div>
            <Select
              name={`role-${c.index}`}
              aria-label={`${c.letter}列の役目`}
              value={roles[i]}
              onChange={(e) => {
                const next = [...roles];
                next[i] = e.currentTarget.value as ColumnRole;
                setRoles(next);
              }}
            >
              {ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>

      {doubled.length > 0 && (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {doubled.map((r) => `「${ROLE_LABEL[r]}」`).join("・")}が 2 つ以上の列に付いています。1 つの列にしてください。
        </p>
      )}

      <F
        label="この表はすべて同じ案件"
        error={fe.fixedProjectId}
        hint={
          needsFixed ? "案件の列が無い表です。どの案件の数か選んでください" : "案件の列が無いファイル（1 つの元請の 1 つの仕事だけの表など）のときに選びます"
        }
      >
        <Select name="fixedProjectId" value={fixed} onChange={(e) => setFixed(e.currentTarget.value)}>
          <option value="">{hasProject || valueCols.length > 0 ? "選ばない（列から読む）" : "選んでください"}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </F>

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">だれの数か</legend>
        <div className="grid gap-2">
          {(
            [
              ["column", "列から読む（ドライバーの名前・番号の列、または見出しがドライバーの名前の列）"],
              ["fixed", "この表はすべて同じ人（1 人 1 枚の表）"],
              ...(sheetCount > 1 ? [["sheets", "シートごとに別の人（シートの名前か、表の上の「氏名」が人の名前）。同じ形のシートをすべて読む"]] : []),
            ] as [DriverMode, string][]
          ).map(([v, label]) => (
            <label
              key={v}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${mode === v ? "border-foreground bg-muted font-bold" : "border-border"}`}
            >
              <input type="radio" name="driverMode" value={v} checked={mode === v} onChange={() => setMode(v)} className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {mode === "fixed" && (
          <F label="この表の人" error={fe.fixedDriverId} hint="台帳にまだいない人なら、先に設定の「ドライバー」で登録してください">
            <Select name="fixedDriverId" defaultValue={fixedDriverId ?? ""} required>
              <option value="" disabled>
                選んでください
              </option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </F>
        )}
        {mode !== "column" && hasDriverCol && (
          <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
            人の列（ドライバーの名前・番号・見出しが名前の列）を「使わない」にしてください。
          </p>
        )}
      </fieldset>

      <F
        label="印の数え方（○・出・休 などが入っている表だけ）"
        error={fe.marks}
        hint="「○=1, 出=1, 休=0」のように、印と数を「=」でつなぎます。空なら、数だけを読みます"
      >
        <Input name="marks" defaultValue={marks} maxLength={500} placeholder="例：○=1, 出=1, 休=0" />
      </F>

      {hasDate && (
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input type="checkbox" name="useDates" defaultChecked={useDates} className="mt-1 h-5 w-5 shrink-0" />
          <span>
            日付を行ごとに残す
            <span className="block text-xs text-muted-foreground">
              1 日 1 行の表なら付けます（「稼働と調整」で日ごとの内訳が見られます）。日付がすべて同じ（集計した日・締め日）なら外します。どちらでも、明細の金額は同じです。
            </span>
          </span>
        </label>
      )}

      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input type="checkbox" name="remember" defaultChecked className="mt-1 h-5 w-5 shrink-0" />
        <span>
          次から同じ形のファイルは、この読み方で読む
          <span className="block text-xs text-muted-foreground">見出しの並びが同じファイルを置くと、この画面を飛ばせます。</span>
        </span>
      </label>

      <Button type="submit" disabled={pending || doubled.length > 0}>
        {pending ? "読み直しています…" : "この読み方で読み直す"}
      </Button>
      <ResultLine state={state} />
    </form>
  );
}
