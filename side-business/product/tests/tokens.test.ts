import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "~/server/password";
import { signStatementLink, verifyStatementLink } from "~/server/tokens";

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
