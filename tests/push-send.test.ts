import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";

/**
 * 端末への通知の送信そのもののテスト。
 *
 * 本物のプッシュサービス（FCM など）には出られないので、**同じ口をローカルに立てて**確かめる。
 * Web Push は必ず HTTPS で送るため、使い捨ての自己署名証明書を作ってテスト用のサーバーを立てる。
 * 見るのは「暗号化された本文と VAPID の署名が届くか」と「404 / 410 なら購読を消すか」。
 */

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** VAPID の鍵（サーバー側） */
function vapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  let priv = ecdh.getPrivateKey();
  if (priv.length < 32) priv = Buffer.concat([Buffer.alloc(32 - priv.length), priv]);
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(priv) };
}

/** 端末側の鍵（購読が持つ p256dh / auth） */
function clientKeys(): { p256dh: string; auth: string } {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(crypto.randomBytes(16)) };
}

interface Received {
  path: string;
  authorization: string;
  encoding: string;
  ttl: string;
  body: Buffer;
}

let server: https.Server | null = null;
let baseUrl = "";
let ready = false;
const received: Received[] = [];

beforeAll(async () => {
  // 使い捨ての自己署名証明書（openssl が無い環境ではこの節を飛ばす）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rootive-push-"));
  const keyFile = path.join(dir, "key.pem");
  const certFile = path.join(dir, "cert.pem");
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=127.0.0.1"],
      { stdio: "ignore" },
    );
  } catch {
    return;
  }

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // 自己署名なので検証しない（このテストの中だけ）
  server = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      received.push({
        path: req.url ?? "",
        authorization: String(req.headers.authorization ?? ""),
        encoding: String(req.headers["content-encoding"] ?? ""),
        ttl: String(req.headers.ttl ?? ""),
        body: Buffer.concat(chunks),
      });
      const url = req.url ?? "";
      res.writeHead(url.includes("gone") ? 410 : url.includes("boom") ? 500 : 201);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const keys = vapidKeys();
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:test@example.com";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  ready = true;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

/** 消された購読の id を記録するだけの、最小限のスタブ */
function stubAdmin(): { admin: unknown; deleted: string[] } {
  const deleted: string[] = [];
  const result = Promise.resolve({ data: null, error: null });
  const chain = {
    delete: () => chain,
    update: () => chain,
    eq(col: string, value: string) {
      if (col === "id") deleted.push(value);
      return chain;
    },
    in: () => chain,
    then: (onOk: (v: unknown) => void, onErr?: (e: unknown) => void) => result.then(onOk, onErr),
  };
  return { admin: { from: () => chain }, deleted };
}

async function send(subs: { id: string; endpoint: string }[]) {
  const { sendPush } = await import("@/lib/push/send");
  const { admin, deleted } = stubAdmin();
  const withKeys = subs.map((s) => ({ ...s, ...clientKeys() }));
  const result = await sendPush(
    admin as Parameters<typeof sendPush>[0],
    "company-1",
    withKeys,
    { title: "テスト", body: "こんにちは", url: "/chat/c1", tag: "chat:c1" },
  );
  return { result, deleted };
}

describe("sendPush", () => {
  it("暗号化した本文と VAPID の署名を送信先へ届ける", async () => {
    if (!ready) return;
    received.length = 0;
    const { result } = await send([{ id: "sub-1", endpoint: `${baseUrl}/ok` }]);

    expect(result.sent).toBe(1);
    expect(result.removed).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0].path).toBe("/ok");
    expect(received[0].authorization.startsWith("vapid ")).toBe(true);
    expect(received[0].encoding).toBe("aes128gcm");
    expect(received[0].ttl).toBe("43200");
    // 本文は暗号化されている（中身がそのまま出ていないこと）
    expect(received[0].body.length).toBeGreaterThan(0);
    expect(received[0].body.toString("utf8")).not.toContain("こんにちは");
    expect(received[0].body.toString("utf8")).not.toContain("chat/c1");
  });

  it("410 が返った購読はその場で消す", async () => {
    if (!ready) return;
    received.length = 0;
    const { result, deleted } = await send([{ id: "sub-gone", endpoint: `${baseUrl}/gone` }]);

    expect(result.sent).toBe(0);
    expect(result.removed).toBe(1);
    expect(deleted).toContain("sub-gone");
  });

  it("一時的な失敗（500）では購読を消さない", async () => {
    if (!ready) return;
    received.length = 0;
    const { result, deleted } = await send([{ id: "sub-boom", endpoint: `${baseUrl}/boom` }]);

    expect(result.failed).toBe(1);
    expect(result.removed).toBe(0);
    expect(deleted).toHaveLength(0);
  });

  it("1 台が失敗しても、ほかの端末には送る", async () => {
    if (!ready) return;
    received.length = 0;
    const { result } = await send([
      { id: "sub-boom", endpoint: `${baseUrl}/boom` },
      { id: "sub-ok", endpoint: `${baseUrl}/ok` },
    ]);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("鍵が無ければ何も送らない", async () => {
    if (!ready) return;
    received.length = 0;
    const saved = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const { result } = await send([{ id: "sub-1", endpoint: `${baseUrl}/ok` }]);
    process.env.VAPID_PRIVATE_KEY = saved;

    expect(result.sent).toBe(0);
    expect(received).toHaveLength(0);
  });
});
