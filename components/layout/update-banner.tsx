"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { updateToLatest } from "@/lib/offline/register-sw";

/** 何分おきに確かめるか（タブに戻ったときにも確かめる） */
const CHECK_MS = 5 * 60 * 1000;

/**
 * 新しい版が出ていたら知らせる帯。
 *
 * 端末（とくにホーム画面に追加した PWA）は、古い版を握ったままになることがある。
 * 「更新したのに変わらない」を自分で確かめられるように、
 * いま読み込んでいる版とサーバーの版を比べて、違えば 1 タップで入れ替える。
 */
export function UpdateBanner({ build }: { build: string }) {
  const [latest, setLatest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function check() {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { build?: string };
        if (!stopped && json.build) setLatest(json.build);
      } catch {
        // 電波が無いときは何もしない
      }
    }
    const onFocus = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const id = window.setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (!latest || latest === build) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-primary px-3 py-2 text-sm text-primary-foreground no-print">
      <span>新しい版があります（{build} → {latest}）</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          // 端末が握っている古い中身と古い Service Worker を捨ててから読み直す
          void updateToLatest();
        }}
        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary-foreground/15 px-3 font-medium hover:bg-primary-foreground/25 disabled:opacity-60"
      >
        <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
        {busy ? "更新中…" : "更新する"}
      </button>
    </div>
  );
}
