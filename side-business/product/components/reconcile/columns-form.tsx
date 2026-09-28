"use client";

/**
 * お支払通知の「どの列が何か」を選び直す。上げたファイルの中身（文字の表）は保存してあるので、ファイルをもう一度上げなくてよい。
 * 選んだ対応は元請ごとに覚え、翌月からは同じ形のファイルに自動で当てる。
 */
import { useActionState, useMemo, useState } from "react";
import { Button, Field, Select } from "@/components/ui";
import { updateColumnsAction } from "~/app/(app)/reconcile/actions";
import { FormMessage } from "~/components/reconcile/bits";
import { COLUMN_ROLES, ROLE_LABEL, type ColumnMap, type ColumnRole } from "~/server/features/reconcile/roles";

const ROLE_HINT: Record<ColumnRole, string> = {
  item: "案件・コース・品目の名前の列（必ず選ぶ）",
  qty: "個数・日数・件数・時間",
  unitPrice: "1 つあたりの金額（税抜）",
  amount: "行の金額（税抜）。無ければ 数量 × 単価 で出します",
  driver: "ドライバーの名前（無ければ「使わない」）",
  date: "日付（無ければ「使わない」）",
};

function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function ColumnsForm({
  noticeId,
  fileId,
  rows,
  headerIndex,
  columns,
}: {
  noticeId: string;
  /** 何通かを足したお支払通知で、どのファイルの列か（無ければ、いちばん新しいファイル） */
  fileId?: string;
  rows: string[][];
  headerIndex: number;
  columns: ColumnMap;
}) {
  const [state, action, pending] = useActionState(updateColumnsAction, undefined);
  const [header, setHeader] = useState(headerIndex);
  const [cols, setCols] = useState<ColumnMap>(columns);
  const headRows = rows.slice(0, 30);
  const headerCells = rows[header] ?? [];
  const width = useMemo(() => Math.max(0, ...rows.slice(header, header + 50).map((r) => r.length)), [rows, header]);
  const firstData = rows.slice(header + 1).find((r) => r.some((c) => c.trim())) ?? [];
  const preview = rows
    .slice(header + 1)
    .filter((r) => r.some((c) => c.trim()))
    .slice(0, 5);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="noticeId" value={noticeId} />
      {fileId && <input type="hidden" name="fileId" value={fileId} />}
      <Field label="見出しの行" hint="「品目」「数量」などの見出しが並んでいる行">
        <Select name="headerRow" value={String(header + 1)} onChange={(e) => setHeader(Number(e.target.value) - 1)}>
          {headRows.map((r, i) => (
            <option key={i} value={String(i + 1)}>
              {i + 1}行目：{r.filter(Boolean).join("｜").slice(0, 40) || "（空の行）"}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {COLUMN_ROLES.map((role) => (
          <Field key={role} label={ROLE_LABEL[role]} hint={ROLE_HINT[role]}>
            <Select
              name={role}
              value={cols[role] === null ? "" : String(cols[role])}
              onChange={(e) => setCols({ ...cols, [role]: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">使わない</option>
              {Array.from({ length: width }, (_, i) => (
                <option key={i} value={String(i)}>
                  {colName(i)}列：{headerCells[i] || "（見出しなし）"}
                  {firstData[i] ? `（例：${firstData[i].slice(0, 12)}）` : ""}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      {preview.length > 0 && (
        <div>
          <p className="text-sm font-bold">この選び方で読むと（最初の {preview.length} 行）</p>
          <ul className="mt-2 space-y-1 text-sm">
            {preview.map((r, i) => (
              <li key={i} className="rounded-md bg-muted px-3 py-2">
                <span className="font-bold">{cols.item !== null ? r[cols.item] || "（品目が空）" : "（品目の列を選んでください）"}</span>
                {cols.driver !== null && r[cols.driver] ? `・${r[cols.driver]}` : ""}
                <span className="num text-muted-foreground">
                  {cols.qty !== null ? `　数量 ${r[cols.qty] || "−"}` : ""}
                  {cols.unitPrice !== null ? `　単価 ${r[cols.unitPrice] || "−"}` : ""}
                  {cols.amount !== null ? `　金額 ${r[cols.amount] || "−"}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "読み直しています…" : "この対応で読み直す"}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
