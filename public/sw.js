/*
 * ROOTIVE 利益管理システム — オフライン対応の Service Worker
 *
 * 方針
 * - ナビゲーション（HTML）：network first。失敗したらキャッシュ、それも無ければオフライン用の画面を返す
 * - 静的アセット（/_next/static・/icons・/fonts）：cache first
 * - GET 以外（Server Action の POST を含む）・/api/*・外部（Supabase など）・RSC（?_rsc=）は一切触らない
 *   ＝ 送信データを書き換えたり、古い応答を返したりしない
 * - キャッシュ名にバージョンを付け、activate で古いものを消す
 */

/**
 * 版（デプロイごとに変わる）
 * 登録するときに `/sw.js?v=<版>` と付けてもらう。URL が変わると
 * ブラウザは別のスクリプトとして入れ直すので、
 * 新しい版を出したときに確実に入れ替わり、activate で古いキャッシュを捨てられる。
 */
var BUILD = "v1";
try {
  BUILD = new URL(self.location.href).searchParams.get("v") || "v1";
} catch (e) {
  BUILD = "v1";
}

var VERSION = "rootive-" + BUILD;
var STATIC_CACHE = VERSION + "-static";
var PAGE_CACHE = VERSION + "-pages";
var KEEP = [STATIC_CACHE, PAGE_CACHE];

/** ページのキャッシュに残す最大件数（古いものから消す） */
var PAGE_CACHE_LIMIT = 40;

/** インストール時に入れておくもの（失敗しても続行する） */
var PRECACHE_URLS = ["/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest"];

/** 認証まわりはキャッシュしない（別の利用者に古い画面を見せない） */
var NO_PAGE_CACHE = ["/login", "/auth", "/invite", "/api"];

/**
 * 開発サーバー（localhost）では /_next/ を触らない
 * 本番のビルドはファイル名にハッシュが付くので安全だが、開発中は同じ URL で中身が変わるため
 */
var IS_LOCAL =
  self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1" || self.location.hostname === "[::1]";

var OFFLINE_HTML =
  '<!doctype html><html lang="ja"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  "<title>オフライン | ROOTIVE 利益管理</title><style>" +
  ":root{color-scheme:light dark;--bg:#f7f7f8;--fg:#16181d;--card:#fff;--muted:#5f6673;--border:#dfe3e8;--primary:#1f5eff}" +
  "@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e8eaef;--card:#171a21;--muted:#9aa3b2;--border:#2b303b;--primary:#5b8cff}}" +
  "*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;" +
  'background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;line-height:1.7}' +
  ".card{width:100%;max-width:343px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center}" +
  ".mark{width:48px;height:48px;margin:0 auto 12px;border-radius:12px;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:20px}" +
  "h1{font-size:17px;margin:0 0 8px}p{font-size:14px;color:var(--muted);margin:0 0 8px}" +
  "button{margin-top:12px;width:100%;min-height:48px;border:0;border-radius:10px;background:var(--primary);color:#fff;font-size:15px;font-weight:600}" +
  "</style></head><body><div class=\"card\"><div class=\"mark\">R</div>" +
  "<h1>いまオフラインです</h1>" +
  "<p>電波が戻ると自動で送信します。入力した内容は端末に保存されているため、消えません。</p>" +
  "<p>電波の届く場所に移動してから、もう一度お試しください。</p>" +
  '<button type="button" onclick="location.reload()">再読み込み</button>' +
  "</div></body></html>";

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function isStaticAsset(url) {
  return (
    url.pathname.indexOf("/_next/static/") === 0 ||
    url.pathname.indexOf("/icons/") === 0 ||
    url.pathname.indexOf("/fonts/") === 0
  );
}

function isCacheablePage(url) {
  for (var i = 0; i < NO_PAGE_CACHE.length; i += 1) {
    var p = NO_PAGE_CACHE[i];
    if (url.pathname === p || url.pathname.indexOf(p + "/") === 0) return false;
  }
  return true;
}

/** 古いページのキャッシュを減らす */
function trimCache(name, limit) {
  return caches.open(name).then(function (cache) {
    return cache.keys().then(function (keys) {
      if (keys.length <= limit) return null;
      return Promise.all(keys.slice(0, keys.length - limit).map(function (key) { return cache.delete(key); }));
    });
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then(function (cache) {
        return Promise.all(
          PRECACHE_URLS.map(function (url) {
            return cache.add(new Request(url, { cache: "reload" })).catch(function () { return null; });
          }),
        );
      })
      .catch(function () { return null; }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            if (KEEP.indexOf(name) >= 0) return null;
            return caches.delete(name);
          }),
        );
      })
      .then(function () { return self.clients.claim(); })
      .catch(function () { return null; }),
  );
});

/** 静的アセット：あればキャッシュから、無ければ取りに行って貯める */
function cacheFirst(request) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request)
      .then(function (res) {
        if (res && res.ok && res.type !== "opaque") {
          var copy = res.clone();
          caches.open(STATIC_CACHE).then(function (cache) { return cache.put(request, copy); }).catch(function () {});
        }
        return res;
      })
      .catch(function () {
        return new Response("", { status: 504, statusText: "offline" });
      });
  });
}

/** ページ：まず取りに行き、だめならキャッシュ、それも無ければオフライン画面 */
function networkFirst(request) {
  var url = new URL(request.url);
  return fetch(request)
    .then(function (res) {
      // 転送された応答（ログインへの遷移など）はキャッシュしない（再生すると画面が壊れる）
      if (res && res.ok && !res.redirected && isCacheablePage(url)) {
        var copy = res.clone();
        caches
          .open(PAGE_CACHE)
          .then(function (cache) {
            return cache.put(request, copy).then(function () { return trimCache(PAGE_CACHE, PAGE_CACHE_LIMIT); });
          })
          .catch(function () {});
      }
      return res;
    })
    .catch(function () {
      return caches.match(request, { ignoreSearch: true }).then(function (hit) {
        return hit || offlineResponse();
      });
    });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;

  // GET 以外（Server Action の POST を含む）は素通し：絶対にキャッシュしない・書き換えない
  if (request.method !== "GET") return;

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // 外部（Supabase・LINE など）は素通し
  if (url.origin !== self.location.origin) return;
  // API・Service Worker 自身は素通し
  if (url.pathname.indexOf("/api/") === 0 || url.pathname === "/sw.js") return;
  // RSC（クライアント遷移・プリフェッチ）は素通し：古い画面を返さない
  if (url.searchParams.has("_rsc")) return;
  if (request.headers.get("RSC") === "1" || request.headers.get("Next-Router-Prefetch") === "1") return;

  if (isStaticAsset(url)) {
    if (IS_LOCAL && url.pathname.indexOf("/_next/") === 0) return;
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  }
});

/**
 * 通知を受け取る（Web Push）
 * サーバーから届いた JSON（title / body / url / tag）をそのまま出す。
 * **必ず通知を出す**（黙って受け取るだけにすると、iOS が購読を止めてしまう）。
 */
self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  var title = data.title || "ROOTIVE 利益管理";
  var options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "rootive",
    renotify: true,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/** 通知を押したら、開いているタブがあればそこへ、無ければ新しく開く */
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (list) {
        for (var i = 0; i < list.length; i += 1) {
          var client = list[i];
          if (client.url.indexOf(self.location.origin) === 0) {
            if ("navigate" in client) {
              return client.navigate(url).then(function (c) {
                return c && c.focus ? c.focus() : null;
              });
            }
            if ("focus" in client) return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
      .catch(function () {
        return null;
      }),
  );
});

self.addEventListener("message", function (event) {
  var data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  // ログアウト時などにページのキャッシュを捨てる
  if (data.type === "CLEAR_CACHE") {
    event.waitUntil(
      caches
        .keys()
        .then(function (names) {
          return Promise.all(names.map(function (name) { return caches.delete(name); }));
        })
        .catch(function () { return null; }),
    );
  }
});
