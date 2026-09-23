import { createHmac, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH, hashPassword, MAX_PASSWORD_LENGTH, needsRehash, PASSWORD_PARAMS, passwordProblem, verifyPassword } from "~/server/password";
import { MAX_RATE_LIMIT_KEYS, rateLimitSize, resetRateLimit, tooMany } from "~/server/rate-limit";
import { derivedKey, ipFingerprint, ipMarker, keyedHash, sha256, signStatementLink, verifyStatementLink } from "~/server/tokens";

describe("パスワード", () => {
  it("正しいものだけ通す（全角・半角の違いは同じとみなす）", async () => {
    const h = await hashPassword("しめ日は毎月末です2026");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("しめ日は毎月末です2026", h)).toBe(true);
    expect(await verifyPassword("しめ日は毎月末です２０２６", h)).toBe(true);
    expect(await verifyPassword("しめ日は毎月末です2027", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", "broken")).toBe(false);
  });
  it("短すぎるものは断る", () => {
    expect(passwordProblem("short")).toMatch(/10 文字以上/);
    expect(passwordProblem("long enough pass")).toBeNull();
  });
});

describe("ドライバーの明細リンク", () => {
  const now = 1_790_000_000;
  it("署名が合い、期限内なら通す", () => {
    const t = signStatementLink("st-1", "nonce-1", now + 60);
    expect(verifyStatementLink(t, now)).toEqual({ ok: true, statementId: "st-1", nonce: "nonce-1", expiresAt: now + 60 });
  });
  it("期限切れ・改ざん・形の崩れは通さない", () => {
    const t = signStatementLink("st-1", "nonce-1", now + 60);
    expect(verifyStatementLink(t, now + 61)).toEqual({ ok: false, reason: "expired" });
    const [p, mac] = t.split(".");
    const forged = Buffer.from("st-2.nonce-1." + (now + 60)).toString("base64url");
    expect(verifyStatementLink(`${forged}.${mac}`, now)).toEqual({ ok: false, reason: "signature" });
    expect(verifyStatementLink(`${p}.AAAA`, now)).toEqual({ ok: false, reason: "signature" });
    expect(verifyStatementLink("garbage", now)).toEqual({ ok: false, reason: "format" });
    expect(verifyStatementLink("", now)).toEqual({ ok: false, reason: "format" });
  });
});

describe("用途の違う署名", () => {
  it("明細のリンクは取引条件のリンクとして通らない", async () => {
    const { signLink, verifyLink, signStatementLink } = await import("~/server/tokens");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const t = signStatementLink("abc", "n1", exp);
    expect(verifyLink("statement", t).ok).toBe(true);
    expect(verifyLink("terms", t)).toEqual({ ok: false, reason: "signature" });
    expect(verifyLink("terms", signLink("terms", "abc", "n1", exp))).toMatchObject({ ok: true, id: "abc" });
  });
});

describe("鍵つきの目印（APP_SECRET から用途ごとに作る鍵）", () => {
  it("口座の目印の鍵は、前の作り方（transfer.ts の bankStampKey）と同じ値になる（前の振込の目印と比べられる）", () => {
    const base = process.env.APP_SECRET?.trim() && process.env.APP_SECRET.trim().length >= 32 ? process.env.APP_SECRET.trim() : "dev-only-secret-dev-only-secret-dev-only";
    const old = createHmac("sha256", base).update("shimebi-lab:bank-stamp:v2").digest();
    expect(derivedKey("bank-stamp:v2").equals(old)).toBe(true);
    expect(keyedHash("bank-stamp:v2", "x")).toBe(createHmac("sha256", old).update("x").digest("hex"));
  });

  it("IP の目印は鍵つき（鍵なしの sha256 と違い、IP の総当たりで戻せない）。画面の 8 文字は、記録の先頭をそのまま出さない", () => {
    const fp = ipFingerprint("203.0.113.7");
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
    expect(fp).not.toBe(sha256("ip:203.0.113.7").slice(0, 32));
    expect(ipFingerprint("203.0.113.7")).toBe(fp);
    expect(ipFingerprint("203.0.113.8")).not.toBe(fp);
    expect(ipMarker(fp)).toMatch(/^[0-9a-f]{8}$/);
    expect(ipMarker(fp)).not.toBe(fp.slice(0, 8));
    expect(ipMarker(fp)).toBe(ipMarker(fp));
    // 用途が違えば値も違う
    expect(keyedHash("a", "v")).not.toBe(keyedHash("b", "v"));
  });
});

describe("パスワードの強さ", () => {
  it("いまの強さ（N=2^14・r=8・p=5）で作り、前の強さのハッシュは作り直しの対象にする", async () => {
    const h = await hashPassword("しめ日は毎月末です2026");
    expect(h.split("$").slice(0, 4)).toEqual(["scrypt", String(PASSWORD_PARAMS.N), String(PASSWORD_PARAMS.r), String(PASSWORD_PARAMS.p)]);
    expect(needsRehash(h)).toBe(false);
    expect(needsRehash("scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(needsRehash(null)).toBe(false);
    expect(needsRehash("broken")).toBe(false);
  });

  it("形だけのハッシュ（利用者がいないとき）は、いまの強さで作られ、どのパスワードとも合わない", async () => {
    expect(DUMMY_PASSWORD_HASH.split("$").slice(1, 4)).toEqual([PASSWORD_PARAMS.N, PASSWORD_PARAMS.r, PASSWORD_PARAMS.p].map(String));
    expect(await verifyPassword("しめ日は毎月末です2026", DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it("前の強さで作ったハッシュも今までどおり通る。重すぎる値は計算しない", async () => {
    const salt = Buffer.alloc(16, 7);
    const old = scryptSync("しめ日は毎月末です2026", salt, 32, { N: 16384, r: 8, p: 1 });
    const stored = ["scrypt", 16384, 8, 1, salt.toString("base64url"), old.toString("base64url")].join("$");
    expect(await verifyPassword("しめ日は毎月末です2026", stored)).toBe(true);
    expect(await verifyPassword("しめ日は毎月末です2026", ["scrypt", 2 ** 24, 8, 1, salt.toString("base64url"), old.toString("base64url")].join("$"))).toBe(false);
    expect(passwordProblem("x".repeat(MAX_PASSWORD_LENGTH + 1))).toMatch(/長すぎ/);
  });
});

describe("回数の制限", () => {
  it("長いキーは短い目印にして覚える。窓を過ぎた記録は消える", () => {
    resetRateLimit();
    const long = `login:${"a".repeat(5_000_000)}`;
    const t0 = Date.UTC(2026, 9, 1);
    for (let i = 0; i < 3; i++) expect(tooMany(long, 3, 60_000, t0 + i)).toBe(false);
    expect(tooMany(long, 3, 60_000, t0 + 10)).toBe(true);
    // 同じ長さの別の値は別に数える
    expect(tooMany(`login:${"a".repeat(4_999_999)}b`, 3, 60_000, t0 + 11)).toBe(false);
    expect(rateLimitSize()).toBe(2);
    // 窓を過ぎてから次に数えるとき、古い記録は消える
    expect(tooMany("other", 3, 60_000, t0 + 10 * 60_000)).toBe(false);
    expect(rateLimitSize()).toBe(1);
    resetRateLimit();
  });

  it("覚えておく数には上限がある", () => {
    resetRateLimit();
    const t0 = Date.UTC(2026, 9, 1);
    for (let i = 0; i < MAX_RATE_LIMIT_KEYS + 50; i++) tooMany(`k${i}`, 5, 15 * 60_000, t0);
    expect(rateLimitSize()).toBeLessThanOrEqual(MAX_RATE_LIMIT_KEYS);
    resetRateLimit();
  });
});
