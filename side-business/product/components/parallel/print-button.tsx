"use client";

import { Button } from "@/components/ui";

/** 印刷（紙・PDF にする） */
export function PrintButton({ label = "印刷・PDF にする" }: { label?: string }) {
  return (
    <Button variant="primary" onClick={() => window.print()} className="w-full sm:w-auto">
      {label}
    </Button>
  );
}
