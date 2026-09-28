/** 突合の画面で使う小さな表示の部品（サーバーでもブラウザでも使える） */
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { yen } from "@/lib/payroll/money";
import type { ActionResult } from "~/server/action";

/** 差の金額（マイナス＝受け取りが少ない可能性は赤、プラスは緑で ＋ を付ける） */
export function DiffAmount({ value, className }: { value: number; className?: string }) {
  const tone = value < 0 ? "text-danger" : value > 0 ? "text-success" : "text-muted-foreground";
  return (
    <span className={cx("num whitespace-nowrap font-bold", tone, className)}>
      {value > 0 ? "+" : ""}
      {yen(value)}
    </span>
  );
}

/** Server Action の結果を 1 行で（成功は緑、失敗は赤。入力の誤りは項目ごとに） */
export function FormMessage({ state }: { state: ActionResult<unknown> | undefined }) {
  if (!state) return null;
  if (state.ok) {
    return state.message ? (
      <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
        {state.message}
      </p>
    ) : null;
  }
  const details = Object.values(state.fieldErrors ?? {});
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      <p>{state.error}</p>
      {details.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 見出しつきの区切り */
export function Section({ id, title, description, children, className }: { id?: string; title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cx("mt-8", className)}>
      <h2 className="text-lg font-bold">{title}</h2>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** 「当社の記録」「お支払通知」のような、左に名前・右に値の 1 行 */
export function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="num text-right text-sm">{children}</span>
    </div>
  );
}
