"use client";

/**
 * 流入元（utm_* ・前のサイトのホスト名・最初のページ）を、タブを開いている間だけ覚える。
 * 覚えるのは最初に開いたときの 1 回だけ。相談フォームを送るときに一緒に送る（送らなければどこにも出ない）。
 * 画面には何も出さない。保存が使えない端末では何もしない。
 * app/layout.tsx に置いてあるので、どのページから入っても拾える（FAX の QR は /tools/* に来る）。
 */
import { useEffect } from "react";
import { captureSource, type LeadSource } from "@/lib/contact";

/** 使える sessionStorage（使えない・読めないときは null） */
export function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** いまのページから流入元を覚えて、覚えている値を返す */
export function captureCurrentSource(): LeadSource | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return captureSource(sessionStore(), {
      search: window.location.search,
      pathname: window.location.pathname,
      host: window.location.host,
      referrer: document.referrer,
    });
  } catch {
    return undefined;
  }
}

export function SourceCapture() {
  useEffect(() => {
    captureCurrentSource();
  }, []);
  return null;
}
