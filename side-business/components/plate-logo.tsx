/** 屋号のロゴ（黒地に黄色の「締」。月末の締めを表す） */
export function PlateLogo({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-7 min-w-10 items-center justify-center rounded-md border-2 border-plate-foreground bg-plate px-1.5 text-sm font-bold leading-none text-plate-foreground ${className}`}
    >
      締
    </span>
  );
}
