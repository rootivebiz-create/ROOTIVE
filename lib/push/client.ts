/**
 * ブラウザ側の購読処理（"use client" から呼ぶ）。
 *
 * 通知は許可を求める前に必ず説明する。許可を一度断られると、
 * ブラウザの設定から戻すまで聞き直せないため、押した人だけに出す。
 */

/** VAPID の公開鍵（base64url）を、購読 API が求めるバイト列に直す */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** 購読から、サーバーへ渡す 3 つの値を取り出す */
export function subscriptionToInput(sub: PushSubscription): { endpoint: string; p256dh: string; auth: string } {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  };
}

/** この端末の呼び名（一覧で見分けるため。細かい判定はしない） */
export function deviceLabel(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "この端末";
}

/** iOS か（ホーム画面に追加しないと通知を使えない） */
export function isIos(ua: string): boolean {
  return /iPhone|iPad|iPod/i.test(ua);
}

/** ブラウザがプッシュ通知に対応しているか */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** ホーム画面に追加した状態で開いているか（iOS の通知にはこれが必要） */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

/** いまの許可の状態 */
export function permissionState(): NotificationPermission | "unsupported" {
  if (!pushSupported()) return "unsupported";
  return Notification.permission;
}

/** いまの購読（無ければ null） */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** 許可を求めて購読する（すでに購読していればそれを返す） */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error("この端末では通知を使えません。");
  if (!vapidPublicKey) throw new Error("通知の設定がされていません（管理者にお問い合わせください）。");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("通知が許可されませんでした。ブラウザの設定から許可してください。");
  }

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
}

/** 購読をやめる（送信先を返す。サーバー側の行を消すのに使う） */
export async function unsubscribeFromPush(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    /* 端末側で消せなくても、サーバー側の行は消す */
  }
  return endpoint;
}
