import { describe, expect, it } from "vitest";
import { deviceLabel, isIos, urlBase64ToUint8Array } from "@/lib/push/client";

/** ブラウザ側の純関数（鍵の変換・端末の見分け）のテスト */

describe("urlBase64ToUint8Array", () => {
  it("base64url を復号できる（- と _ を戻し、= を補う）", () => {
    // "Hello" を base64url にしたもの（パディング無し）
    expect(Array.from(urlBase64ToUint8Array("SGVsbG8"))).toEqual([72, 101, 108, 108, 111]);
  });

  it("VAPID の公開鍵は 65 バイトになる", () => {
    // 65 バイト（0x04 ＋ X 32 ＋ Y 32）を base64url にしたもの
    const bytes = new Uint8Array(65);
    bytes[0] = 4;
    for (let i = 1; i < 65; i += 1) bytes[i] = i;
    const b64url = Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const back = urlBase64ToUint8Array(b64url);
    expect(back).toHaveLength(65);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });
});

describe("deviceLabel", () => {
  it("よくある端末を見分ける", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("iPhone");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("Android");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows");
  });

  it("分からなければ「この端末」", () => {
    expect(deviceLabel("something else")).toBe("この端末");
  });
});

describe("isIos", () => {
  it("iPhone / iPad を見分ける（ホーム画面に追加の案内を出すため）", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIos("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIos("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
  });
});
