/**
 * Service Worker（`public/sw.js`）の登録
 *
 * - 登録できない環境（未対応のブラウザ・http・権限なし）では何もしない（例外は握りつぶす）
 * - 新しい版が待っていたら `SKIP_WAITING` を送って入れ替える（再読み込みの強制はしない）
 * - **版（build）を `?v=` で付けて登録する**。URL が変わるとブラウザは別のスクリプトとして
 *   入れ直すので、新しい版を出したときに古いキャッシュが確実に捨てられる
 *   （「更新したのに変わらない」を防ぐ）
 */
export const SERVICE_WORKER_URL = "/sw.js";

function isSupported(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** 版を付けた Service Worker の URL */
export function serviceWorkerUrl(build?: string): string {
  return build ? `${SERVICE_WORKER_URL}?v=${encodeURIComponent(build)}` : SERVICE_WORKER_URL;
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
export function registerServiceWorker(build?: string): void {
  if (!isSupported()) return;
  const run = () => {
    navigator.serviceWorker
      .register(serviceWorkerUrl(build), { scope: "/" })
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

/**
 * 新しい版へ入れ替えてから読み直す（「更新する」ボタン）。
 * 端末が握っているキャッシュと古い Service Worker を捨ててから読み直すので、
 * ホーム画面に追加した PWA でも確実に新しい版になる。
 */
export async function updateToLatest(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (typeof caches !== "undefined") {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    /* キャッシュを消せなくても読み直しは行う */
  }
  try {
    if (isSupported()) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* 解除できなくても読み直しは行う */
  }
  window.location.reload();
}
