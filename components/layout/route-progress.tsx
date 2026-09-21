"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** 進まなかったときに自動で消す（通信が詰まっても棒が残らないように） */
const SAFETY_MS = 12000;

/**
 * 画面の上に出る読み込みバー。
 *
 * 「タップしたのに何も起きない」をなくすためのもの。
 * ナビだけでなく**カードや表の行も含めたすべてのリンク**を拾うので、
 * どこを押しても押した瞬間に反応が返る。
 *
 * 判定は素直に：同じサイトの `<a>` を普通に押したら開始、
 * URL（パス or ?m= などのクエリ）が変わったら終了。
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [active, setActive] = useState(false);

  // URL が変わったら終わり
  useEffect(() => {
    setActive(false);
  }, [pathname, searchParams]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // 出力（CSV・PDF）は画面が変わらないので出さない
      if (url.pathname.startsWith("/api/")) return;
      // 同じ URL なら何も起きない
      if (url.pathname + url.search === window.location.pathname + window.location.search) return;
      setActive(true);
    }
    function onPopState() {
      setActive(true);
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setActive(false), SAFETY_MS);
    return () => window.clearTimeout(id);
  }, [active]);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden no-print" role="presentation" aria-hidden>
      <div className="route-progress-bar h-full w-1/3 bg-primary" />
    </div>
  );
}
