import { Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ACCESS_DESCRIPTIONS, ACCESS_KEYS, ACCESS_LABELS, isAccessMoot, type Access, type AccessOverrides } from "@/lib/auth/access";
import { cn } from "@/lib/utils";

/**
 * 見せる範囲の一覧（読むだけ）。自分のアカウント画面と、ユーザーの詳細画面の見出しで使う。
 * 代表が個別に変えた項目には「個別の設定」を付ける
 */
export function AccessSummary({ access, overrides = {}, className }: { access: Access; overrides?: AccessOverrides; className?: string }) {
  return (
    <ul className={cn("divide-y rounded-md border", className)}>
      {ACCESS_KEYS.map((key) => {
        const on = access[key];
        const moot = on && isAccessMoot(key, access);
        return (
          <li key={key} className="flex items-start justify-between gap-3 px-3 py-2" data-access={key} data-state={on ? "on" : "off"}>
            <div className="min-w-0">
              <p className="text-sm font-medium">{ACCESS_LABELS[key]}</p>
              <p className="text-xs text-muted-foreground">{ACCESS_DESCRIPTIONS[key]}</p>
              {moot && <p className="text-xs text-muted-foreground">経営の数字が見えないため、見る画面がありません。</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {on ? (
                <Badge variant="success" className="gap-1">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  見える
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <Minus className="h-3 w-3" aria-hidden="true" />
                  見えない
                </Badge>
              )}
              {overrides[key] && <span className="text-[11px] text-muted-foreground">個別の設定</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
