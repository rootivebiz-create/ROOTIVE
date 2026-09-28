"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { cx } from "@/lib/cx";
import { Check, ResultLine, useFormAction, type FormAction } from "./form-kit";

/**
 * 元請の「取引をやめる（無効にする）」と「戻す」。押したあとに、何が起きるかを見せてから送る。
 * 案件も一緒に切り替えるかを選べる（既定は一緒に）。
 */
export function ClientActiveForm({
  action,
  id,
  name,
  active,
  activeProjects,
  restorableProjects,
}: {
  action: FormAction;
  id: string;
  name: string;
  /** いま有効か（有効なら「取引をやめる」、無効なら「戻す」を出す） */
  active: boolean;
  /** この元請の「使っている」案件の数（やめるときに一緒に「使わない」にできる） */
  activeProjects: number;
  /** やめたときに一緒に「使わない」にした案件の数（戻すときに一緒に戻せる） */
  restorableProjects: number;
}) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (state?.ok) setAsking(false);
  }, [state]);
  const projects = active ? activeProjects : restorableProjects;

  return (
    <form onSubmit={onSubmit} className="min-w-0 space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      {asking ? (
        <div className={cx("space-y-3 rounded-lg border p-3 text-sm", active ? "border-warning/40 bg-warning/10" : "border-border bg-muted")}>
          {active ? (
            <p>
              「{name}」を取引をやめた元請にします。案件の元請を選ぶところに出なくなります。過去の案件・お支払通知・明細はそのまま残り、「戻す」でいつでも元に戻せます。
            </p>
          ) : (
            <p>「{name}」を、また取引している元請に戻します。</p>
          )}
          {projects > 0 && (
            <Check
              name="withProjects"
              defaultChecked
              label={active ? `この元請の案件（使っている ${projects}件）も「使わない」にする` : `やめたときに一緒に「使わない」にした案件 ${projects}件も戻す`}
              hint={active ? "取り込みの候補に出なくなります。記録は残ります" : "それより前から「使わない」だった案件は、そのままにします"}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "送っています…" : active ? "取引をやめる" : "戻す"}
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)} disabled={pending}>
              やめる
            </Button>
          </div>
        </div>
      ) : (
        <Button variant={active ? "secondary" : "primary"} onClick={() => setAsking(true)}>
          {active ? "取引をやめる（無効にする）" : "戻す"}
        </Button>
      )}
      <ResultLine state={state} />
    </form>
  );
}
