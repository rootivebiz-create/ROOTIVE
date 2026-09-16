"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useMonth } from "@/lib/hooks/use-month";
import { ACTION_OPTIONS, TABLE_OPTIONS } from "./labels";

/** テーブル・操作のフィルタ（URL クエリ ?table=&action=&page= で管理。変更時は 1 ページ目へ） */
export function AuditFilters({ table, action }: { table?: string; action?: string }) {
  const router = useRouter();
  const { href } = useMonth();
  const [pending, startTransition] = useTransition();

  const navigate = (next: { table?: string; action?: string }) => {
    const extra: Record<string, string> = {};
    if (next.table) extra.table = next.table;
    if (next.action) extra.action = next.action;
    startTransition(() => router.push(href("/settings/audit", extra)));
  };

  return (
    <div className="mb-4 grid grid-cols-2 gap-2 md:flex md:flex-wrap md:items-end">
      <div className="space-y-1">
        <Label htmlFor="audit-table">テーブル</Label>
        <Select id="audit-table" value={table ?? ""} onChange={(e) => navigate({ table: e.target.value, action })} disabled={pending} className="md:w-48">
          <option value="">全て</option>
          {TABLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="audit-action">操作</Label>
        <Select id="audit-action" value={action ?? ""} onChange={(e) => navigate({ table, action: e.target.value })} disabled={pending} className="md:w-44">
          <option value="">全て</option>
          {ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      {(table || action) && (
        <Button variant="ghost" size="sm" className="col-span-2 justify-self-start md:col-span-1" onClick={() => navigate({})} disabled={pending}>
          絞り込みを解除
        </Button>
      )}
    </div>
  );
}
