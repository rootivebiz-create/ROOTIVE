import type { ReactNode } from "react";

export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 font-bold">
        <span aria-hidden className="inline-flex h-8 min-w-11 items-center justify-center rounded-md border-2 border-plate-foreground bg-plate px-1.5 leading-none text-plate-foreground">
          締
        </span>
        <span>しめ日ラボ</span>
      </div>
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="mt-6">{children}</div>
    </main>
  );
}
