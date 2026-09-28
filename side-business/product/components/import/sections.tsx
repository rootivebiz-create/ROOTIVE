import type { ReactNode } from "react";
import { Money, TableWrap } from "@/components/ui";
import { Badge } from "~/components/page";
import type { CompareRow, DriverTotal, ProjectTotal } from "~/server/features/import/resolve";
import type { DuplicateRow, StatementDiff } from "~/server/features/import/service";
import { ROLE_LABEL, type ColumnRole, type SkippedRow, type TotalCheck } from "~/server/features/import/types";

/** 取り込みの確認の画面の部品（表示だけ。サーバーで描く） */

export function qtyText(n: number): string {
  return n.toLocaleString("ja-JP", { maximumFractionDigits: 4 });
}

/** 取り込みの状態 */
export function StatusBadge({ status, reason }: { status: string; reason?: string | null }) {
  if (status === "applied") return <Badge tone="green">反映済み</Badge>;
  if (status === "draft") return <Badge tone="yellow">確認中</Badge>;
  if (reason === "replaced") return <Badge tone="gray">入れ替え済み</Badge>;
  if (reason === "undo") return <Badge tone="gray">取り消し</Badge>;
  return <Badge tone="gray">やめた</Badge>;
}

export function Section({ title, step, children, aside }: { title: string; step?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {step && (
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2 text-sm font-bold text-primary-foreground">
            {step}
          </span>
        )}
        <h2 className="text-lg font-bold">{title}</h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** 行番号を「3・16〜18行目」のように短く */
export function rowList(rows: number[]): string {
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}〜${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return `${parts.slice(0, 12).join("・")}${parts.length > 12 ? " ほか" : ""}行目`;
}

/** 取り込まない行：理由ごとにまとめる（読めない数は 1 つずつ） */
export function SkippedList({ skipped }: { skipped: SkippedRow[] }) {
  if (skipped.length === 0) return <p className="text-sm text-muted-foreground">取り込まない行はありません。</p>;
  const groups = new Map<string, number[]>();
  const singles: SkippedRow[] = [];
  for (const s of skipped) {
    if (s.reason.includes("は数字ではありません")) singles.push(s);
    else groups.set(s.reason, [...(groups.get(s.reason) ?? []), s.rowNo]);
  }
  return (
    <ul className="space-y-1 text-sm">
      {singles.map((s, i) => (
        <li key={`s${i}`} className="text-warning">
          {s.reason}
        </li>
      ))}
      {[...groups.entries()].map(([reason, rows]) => (
        <li key={reason}>
          <span className="font-bold">{reason}</span>
          <span className="text-muted-foreground">：{rowList(rows)}</span>
        </li>
      ))}
    </ul>
  );
}

/** ファイル自身の合計との照合 */
export function ChecksList({ checks }: { checks: TotalCheck[] }) {
  if (checks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        ファイルに合計の行・「計」の列が無いため、合計の照らし合わせはしていません。下の合計を Excel と見比べてください。
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {checks.map((c, i) => (
        <li key={i} className={`rounded-lg border p-3 text-sm ${c.ok ? "border-success/40 bg-success/10" : "border-danger/40 bg-danger/10"}`}>
          {c.ok ? (
            <p className="font-bold text-success">
              ✓ {c.label} {qtyText(c.expected)} と一致しました
            </p>
          ) : (
            <p className="font-bold text-danger">
              {c.label} は {qtyText(c.expected)}、読み取った数は {qtyText(c.actual)}（差 {qtyText(Math.round((c.actual - c.expected) * 1e4) / 1e4)}）
            </p>
          )}
          {c.note && <p className="mt-1 text-muted-foreground">{c.note}</p>}
        </li>
      ))}
    </ul>
  );
}

export function ProjectTotals({ rows }: { rows: ProjectTotal[] }) {
  if (rows.length === 0) return null;
  return (
    <TableWrap>
      <table className="w-full min-w-[20rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-2 font-normal">案件</th>
            <th className="py-2 pr-2 text-right font-normal">人数</th>
            <th className="py-2 text-right font-normal">数量</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.projectId} className="border-b border-border/60">
              <td className="py-2 pr-2">{p.name}</td>
              <td className="num py-2 pr-2 text-right">{p.drivers}人</td>
              <td className="num py-2 text-right font-bold">
                {qtyText(p.qty)}
                <span className="ml-0.5 text-xs font-normal">{p.unit}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function DriverTotals({ rows }: { rows: DriverTotal[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {rows.map((d) => (
        <li key={d.driverId} className="rounded-lg border border-border p-3 text-sm">
          <p className="font-bold">{d.name}</p>
          <ul className="mt-1 space-y-0.5">
            {d.lines.map((l) => (
              <li key={l.projectId} className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-muted-foreground">{l.name}</span>
                <span className="num whitespace-nowrap">
                  {qtyText(l.qty)}
                  <span className="ml-0.5 text-xs">{l.unit}</span>
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

const FLAG: Record<NonNullable<CompareRow["flag"]>, { label: string; tone: "red" | "yellow" | "gray" }> = {
  up: { label: "大きく増えた", tone: "yellow" },
  down: { label: "大きく減った", tone: "yellow" },
  new: { label: "先月は無し", tone: "gray" },
  gone: { label: "今月は無し", tone: "red" },
};

/** 先月との比べ（印の付いたものだけ表に出す） */
export function CompareTable({ rows, prevLabel }: { rows: CompareRow[]; prevLabel: string }) {
  const flagged = rows.filter((r) => r.flag);
  if (rows.length === 0) return null;
  if (flagged.length === 0) return <p className="text-sm text-muted-foreground">{prevLabel}と比べて、半分以下・1.5 倍以上になった所はありません。</p>;
  return (
    <>
      <p className="text-sm">
        {prevLabel}と比べて、数量が半分以下・1.5 倍以上になった所、片方の月にしか無い所です。打ち間違い・行の抜けが無いか確かめてください。
      </p>
      <TableWrap>
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-2 font-normal">ドライバー</th>
              <th className="py-2 pr-2 font-normal">案件</th>
              <th className="py-2 pr-2 text-right font-normal">{prevLabel}</th>
              <th className="py-2 pr-2 text-right font-normal">今月</th>
              <th className="py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {flagged.map((r) => (
              <tr key={`${r.driverId}:${r.projectId}`} className="border-b border-border/60">
                <td className="py-2 pr-2">{r.driverName}</td>
                <td className="py-2 pr-2">{r.projectName}</td>
                <td className="num py-2 pr-2 text-right">{qtyText(r.prev)}</td>
                <td className="num py-2 pr-2 text-right font-bold">
                  {qtyText(r.now)}
                  {r.change !== null && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      （{r.change > 0 ? "+" : ""}
                      {Math.round(r.change * 100)}%）
                    </span>
                  )}
                </td>
                <td className="py-2">{r.flag && <Badge tone={FLAG[r.flag].tone}>{FLAG[r.flag].label}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

/** 反映したら明細の金額がどう変わるか（計算は明細と同じ関数） */
export function StatementDiffTable({ rows, unchanged }: { rows: StatementDiff[]; unchanged: number }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm font-bold text-success">
        反映しても、明細の金額は{unchanged > 0 ? `全員（${unchanged}人）` : ""}変わりません。
      </p>
    );
  }
  return (
    <>
      <TableWrap>
        <table className="w-full min-w-[32rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-2 font-normal">ドライバー</th>
              <th className="py-2 pr-2 text-right font-normal">委託料（税抜）今 → 反映後</th>
              <th className="py-2 text-right font-normal">振込額 今 → 反映後</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.driverId} className="border-b border-border/60">
                <td className="py-2 pr-2">{r.name}</td>
                <td className="py-2 pr-2 text-right">
                  <Money value={r.beforeSubtotal} className="text-muted-foreground" /> → <Money value={r.afterSubtotal} className="font-bold" />
                </td>
                <td className="py-2 text-right">
                  <Money value={r.beforeTotal} className="text-muted-foreground" /> → <Money value={r.afterTotal} className="font-bold" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {unchanged > 0 && <p className="text-xs text-muted-foreground">ほかの {unchanged} 人は変わりません。</p>}
    </>
  );
}

export function DuplicateList({ rows, total }: { rows: DuplicateRow[]; total: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">
      <p className="font-bold text-danger">
        今ある稼働と重なる所が {rows.length} 件あります（二重なら、多く払ってしまう額の目安 <Money value={total} />）
      </p>
      <ul className="mt-2 space-y-1">
        {rows.slice(0, 8).map((d) => (
          <li key={`${d.driverId}:${d.projectId}`}>
            {d.driverName}・{d.projectName}：今ある {qtyText(d.existingQty)}
            {d.unit}（{d.sources.join("・")}）＋ 取り込む {qtyText(d.newQty)}
            {d.unit}
          </li>
        ))}
        {rows.length > 8 && <li>ほか {rows.length - 8} 件</li>}
      </ul>
    </div>
  );
}

/** 列の番号 → Excel の列の名前（0 → A、26 → AA） */
function letterOf(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** 表の最初の数行（どう読んだかを、列の役目つきで見せる） */
export function SheetPreview({
  rows,
  headerRow,
  headerDepth,
  roles,
  limit = 8,
}: {
  rows: string[][];
  headerRow: number;
  headerDepth: number;
  roles: ColumnRole[];
  limit?: number;
}) {
  const start = Math.max(0, headerRow - 1);
  const end = Math.min(rows.length, headerRow + headerDepth + limit);
  // 日付が横に並ぶ表（31 日＋名前の列）も最後まで見えるように、64 列まで出す（横にスクロール）
  const width = Math.min(
    rows.slice(start, end).reduce((w, r) => Math.max(w, r.length), 0),
    64,
  );
  const letters = Array.from({ length: width }, (_, i) => letterOf(i));
  return (
    <TableWrap>
      <table className="w-full min-w-max border-collapse text-xs">
        <thead>
          <tr>
            <th className="border border-border bg-muted px-2 py-1 font-normal text-muted-foreground" />
            {letters.map((l, i) => (
              <th key={l} className="border border-border bg-muted px-2 py-1 text-left font-normal">
                <span className="text-muted-foreground">{l}</span>
                {roles[i] && roles[i] !== "ignore" && <span className="ml-1 font-bold text-foreground">{ROLE_LABEL[roles[i]]}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(start, end).map((r, k) => {
            const i = start + k;
            const isHeader = i >= headerRow && i < headerRow + headerDepth;
            return (
              <tr key={i} className={isHeader ? "bg-accent/20 font-bold" : ""}>
                <td className="border border-border bg-muted px-2 py-1 text-right text-muted-foreground">{i + 1}</td>
                {letters.map((l, c) => (
                  <td
                    key={l}
                    className={`max-w-40 truncate border border-border px-2 py-1 ${roles[c] === "ignore" && !isHeader ? "text-muted-foreground" : ""}`}
                  >
                    {r[c] ?? ""}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
