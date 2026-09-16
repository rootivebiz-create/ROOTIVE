import * as React from "react";
import { cn } from "@/lib/utils";

/** ネイティブ select（スマホでの操作性を優先） */
const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
export { Select };
