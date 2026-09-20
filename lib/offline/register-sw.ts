/**
 * Service Worker（`public/sw.js`）の登録
 *
 * - 登録できない環境（未対応のブラウザ・http・権限なし）では何もしない（例外は握りつぶす）
 * - 新しい版が待っていたら `SKIP_WAITING` を送って入れ替える（再読み込みの強制はしない）
 */
export const SERVICE_WORKER_URL = "/sw.js";

function isSupported(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

function activateWaiting(registration: ServiceWorkerRegistration): void {
  try {
    if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
    registration.addEventListener("updatefound", () => {
      const next = registration.installing;
      if (!next) return;
      next.addEventListener("statechange", () => {
        if (next.state === "installed" && navigator.serviceWorker.controller) next.postMessage({ type: "SKIP_WAITING" });
      });
    });
  } catch {
    /* 入れ替えに失敗しても既に動いている版で問題ない */
  }
}

/** Service Worker を登録する（失敗しても画面は動く） */
export function registerServiceWorker(): void {
  if (!isSupported()) return;
  const run = () => {
    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "/" })
      .then(activateWaiting)
      .catch(() => {
        /* 開発サーバー・プライベートモードなどでは登録できないことがある */
      });
  };
  if (document.readyState === "complete") run();
  else window.addEventListener("load", run, { once: true });
}

/** キャッシュを捨てる（ログアウト時などに使う） */
export function clearServiceWorkerCache(): void {
  if (!isSupported()) return;
  try {
    navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_CACHE" });
  } catch {
    /* 何もしない */
  }
}
