"use client";

import { Button } from "@/components/ui";

/** 印刷の画面を開く（そこで「PDFに保存」を選べば PDF になる） */
export function PrintButton({ label = "印刷する・PDFにする" }: { label?: string }) {
  return (
    <Button type="button" variant="accent" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
