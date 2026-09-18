"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** ブラウザの印刷ダイアログを開く（印刷時は no-print で非表示） */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      印刷
    </Button>
  );
}
