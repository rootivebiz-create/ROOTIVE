import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:text-sm",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

/** 数値入力（スマホはテンキー）。値は文字列で扱い、保存時に正規化する */
const NumberInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { decimal?: boolean }>(
  ({ className, decimal = true, ...props }, ref) => (
    <Input ref={ref} type="text" inputMode={decimal ? "decimal" : "numeric"} autoComplete="off" className={cn("num", className)} {...props} />
  ),
);
NumberInput.displayName = "NumberInput";

export { Input, NumberInput };
