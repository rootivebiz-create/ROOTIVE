import { describe, expect, it } from "vitest";
import {
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
  maskEmail,
  signLicense,
  verifyLicense,
  type LicensePayload,
} from "@/lib/license";

const payload: LicensePayload = { v: 1, p: "pro", s: "cs_test_123", t: 1_790_000_000, m: "t***@example.com" };

describe("ライセンス", () => {
  it("署名したものは公開鍵で確かめられる", async () => {
    const keys = await generateKeyPair();
    const token = await signLicense(payload, await importPrivateKey(keys.privateKey));
    expect(token.startsWith("KL1.")).toBe(true);
    const res = await verifyLicense(token, await importPublicKey(keys.publicKey));
    expect(res).toEqual({ ok: true, payload });
  });

  it("貼り付けたときの前後の空白や改行は無視する", async () => {
    const keys = await generateKeyPair();
    const token = await signLicense(payload, await importPrivateKey(keys.privateKey));
    const messy = `  ${token.slice(0, 20)}\n${token.slice(20)}  \n`;
    const res = await verifyLicense(messy, await importPublicKey(keys.publicKey));
    expect(res.ok).toBe(true);
  });

  it("別の鍵で作ったものは通さない", async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    const token = await signLicense(payload, await importPrivateKey(a.privateKey));
    const res = await verifyLicense(token, await importPublicKey(b.publicKey));
    expect(res.ok).toBe(false);
  });

  it("中身を書き換えたものは通さない", async () => {
    const keys = await generateKeyPair();
    const token = await signLicense(payload, await importPrivateKey(keys.privateKey));
    const [prefix, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, s: "cs_forged" })).toString("base64url");
    const res = await verifyLicense(`${prefix}.${forged}.${sig}`, await importPublicKey(keys.publicKey));
    expect(res.ok).toBe(false);
  });

  it("形式が違うものは理由を返す", async () => {
    const keys = await generateKeyPair();
    const pub = await importPublicKey(keys.publicKey);
    expect(await verifyLicense("", pub)).toEqual({ ok: false, reason: "形式が違います" });
    expect(await verifyLicense("XX.a.b", pub)).toEqual({ ok: false, reason: "形式が違います" });
    expect(await verifyLicense("KL1.!!!.b", pub)).toEqual({ ok: false, reason: "形式が違います" });
  });

  it("メールは先頭の 1 文字とドメインだけ残す", () => {
    expect(maskEmail("taro@example.com")).toBe("t***@example.com");
    expect(maskEmail("")).toBeUndefined();
    expect(maskEmail("no-at-mark")).toBeUndefined();
    expect(maskEmail(null)).toBeUndefined();
  });
});
