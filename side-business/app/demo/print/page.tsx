import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoPrint } from "@/components/demo/print-view";

export const metadata: Metadata = {
  title: "支払明細書（デモ・印刷）",
  robots: { index: false, follow: false },
};

export default function DemoPrintPage() {
  return (
    <Suspense fallback={<p className="py-16 text-center text-muted-foreground">読み込み中…</p>}>
      <DemoPrint />
    </Suspense>
  );
}
