import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/contact/route";
import {
  CONTACT_TEXT,
  DEFAULT_FROM_EMAIL,
  DISCORD_CONTENT_MAX,
  SOURCE_MAX,
  SOURCE_STORAGE_KEY,
  captureSource,
  clientIp,
  createRateLimiter,
  escapeSlack,
  formatInquiry,
  formatJst,
  formatSource,
  hasDelivery,
  inquirySubject,
  isHoneypotFilled,
  mailtoHref,
  normalizePhone,
  notReadyMessage,
  readDeliveryConfig,
  readStoredSource,
  sourceFromLocation,
  truncateChars,
  validateInquiry,
  webhookPayload,
  type Inquiry,
} from "@/lib/contact";
import { SITE } from "@/site.config";

const valid = {
  company: "  株式会社テスト運送  ",
  name: "山田 太郎",
  email: " taro@example.com ",
  phone: "０３−１２３４−５６７８",
  drivers: "6〜15人",
  topics: ["振込データ", "支払明細", "支払明細"],
  message: "明細は Excel で作っています。\r\n月末に2日かかります。",
  agree: true,
  website: "",
};

function ok(input: unknown): Inquiry {
  const r = validateInquiry(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.data;
}

function errors(input: unknown) {
  const r = validateInquiry(input);
  if (r.ok) throw new Error("通ってしまった");
  return r.errors;
}

describe("相談フォームの入力を確かめる", () => {
  it("正しい入力は整えて通す（空白・全角の電話番号・相談の重なりと順番・改行）", () => {
    const d = ok(valid);
    expect(d.company).toBe("株式会社テスト運送");
    expect(d.email).toBe("taro@example.com");
    expect(d.phone).toBe("03-1234-5678");
    expect(d.topics).toEqual(["支払明細", "振込データ"]);
    expect(d.message).toBe("明細は Excel で作っています。\n月末に2日かかります。");
    expect(d.agree).toBe(true);
  });

  it("任意の欄は無くてもよい（電話・相談したいこと・内容）", () => {
    const d = ok({ company: "A運送", name: "山田", email: "a@example.jp", drivers: "〜5人", agree: true });
    expect(d.phone).toBe("");
    expect(d.topics).toEqual([]);
    expect(d.message).toBe("");
  });

  it("必須の欄が空なら、欄ごとに日本語で返す", () => {
    const e = errors({ company: " ", name: "", email: "", drivers: "", topics: [], agree: false, website: "" });
    expect(e.company).toBe("会社名を入れてください");
    expect(e.name).toBe("お名前を入れてください");
    expect(e.email).toBe("メールアドレスを入れてください");
    expect(e.drivers).toBe("業務委託の方の人数を選んでください");
    expect(e.agree).toBe("プライバシーポリシーへの同意が必要です");
    expect(e.phone).toBeUndefined();
    expect(e.topics).toBeUndefined();
  });

  it("何も送られていなくても、欄ごとの言葉で返す", () => {
    const e = errors({});
    expect(Object.keys(e).sort()).toEqual(["agree", "company", "drivers", "email", "name"]);
    expect(e.company).toBe("会社名を入れてください");
  });

  it("長さの上限", () => {
    expect(ok({ ...valid, company: "あ".repeat(100) }).company).toHaveLength(100);
    expect(errors({ ...valid, company: "あ".repeat(101) }).company).toBe("会社名は100文字までにしてください");
    expect(ok({ ...valid, name: "あ".repeat(50) }).name).toHaveLength(50);
    expect(errors({ ...valid, name: "あ".repeat(51) }).name).toBe("お名前は50文字までにしてください");
    expect(ok({ ...valid, message: "あ".repeat(2000) }).message).toHaveLength(2000);
    expect(errors({ ...valid, message: "あ".repeat(2001) }).message).toBe("ご相談の内容は2000文字までにしてください");
  });

  it("メールアドレスの形", () => {
    expect(errors({ ...valid, email: "taro@" }).email).toContain("形が正しくありません");
    expect(errors({ ...valid, email: "taro example.com" }).email).toContain("形が正しくありません");
    expect(ok({ ...valid, email: "t.yamada+form@sub.example.co.jp" }).email).toBe("t.yamada+form@sub.example.co.jp");
  });

  it("電話番号は数字とハイフンだけ、10〜11桁", () => {
    expect(ok({ ...valid, phone: "09012345678" }).phone).toBe("09012345678");
    expect(ok({ ...valid, phone: "090 1234 5678" }).phone).toBe("09012345678");
    expect(ok({ ...valid, phone: "" }).phone).toBe("");
    expect(errors({ ...valid, phone: "03(1234)5678" }).phone).toContain("数字とハイフン");
    expect(errors({ ...valid, phone: "+81-3-1234-5678" }).phone).toContain("数字とハイフン");
    expect(errors({ ...valid, phone: "03-1234" }).phone).toContain("桁が合いません");
    expect(normalizePhone("０９０ー１２３４ー５６７８")).toBe("090-1234-5678");
  });

  it("ドライバーの人数と相談したいことは一覧にあるものだけ", () => {
    expect(errors({ ...valid, drivers: "100人" }).drivers).toBe("業務委託の方の人数を選んでください");
    expect(errors({ ...valid, topics: ["採用"] }).topics).toBe("相談したいことは一覧から選んでください");
    expect(errors({ ...valid, topics: "支払明細" }).topics).toBe("相談したいことは一覧から選んでください");
  });

  it("同意は true のときだけ（文字の \"true\" は不可）", () => {
    expect(errors({ ...valid, agree: "true" }).agree).toBe("プライバシーポリシーへの同意が必要です");
    expect(errors({ ...valid, agree: undefined }).agree).toBe("プライバシーポリシーへの同意が必要です");
  });

  it("1 行の欄の改行は空白にする", () => {
    expect(ok({ ...valid, company: "テスト\n運送" }).company).toBe("テスト 運送");
  });

  it("おとりの欄", () => {
    expect(isHoneypotFilled(valid)).toBe(false);
    expect(isHoneypotFilled({ ...valid, website: undefined })).toBe(false);
    expect(isHoneypotFilled({ ...valid, website: "  " })).toBe(false);
    expect(isHoneypotFilled({ ...valid, website: "https://spam.example" })).toBe(true);
    expect(isHoneypotFilled({ ...valid, website: 1 })).toBe(true);
    expect(isHoneypotFilled(null)).toBe(false);
    expect(errors({ ...valid, website: "x" }).website).toBe("この欄は空のままにしてください");
    // isHoneypotFilled が「空」とみなすものは、確かめる側でも通す（400 で黙って止まらない）
    expect(ok({ ...valid, website: "  " }).company).toBe("株式会社テスト運送");
    expect(ok({ ...valid, website: null }).company).toBe("株式会社テスト運送");
  });
});

describe("通知の文面", () => {
  const inquiry = ok(valid);
  // 2026-09-23 05:05 UTC = 日本時間 14:05（水）
  const receivedAt = new Date("2026-09-23T05:05:00Z");

  it("日本時間の日時", () => {
    expect(formatJst(receivedAt)).toBe("2026年9月23日（水）14:05");
    // UTC の前日 15:00 を過ぎると日本では翌日
    expect(formatJst(new Date("2026-12-31T15:30:00Z"))).toBe("2027年1月1日（金）00:30");
  });

  it("本文", () => {
    expect(formatInquiry(inquiry, receivedAt)).toBe(
      [
        `${SITE.name}の相談フォームから申し込みがありました。`,
        "",
        "受付日時：2026年9月23日（水）14:05（日本時間）",
        "会社名：株式会社テスト運送",
        "お名前：山田 太郎",
        "メール：taro@example.com",
        "電話：03-1234-5678",
        "業務委託の方の人数：6〜15人",
        "相談したいこと：支払明細、振込データ",
        "流入元：（記録なし：直接の入力・ブックマークなど）",
        "",
        "■ ご相談の内容",
        "明細は Excel で作っています。",
        "月末に2日かかります。",
      ].join("\n"),
    );
  });

  it("任意の欄が空なら「なし」と書く", () => {
    const text = formatInquiry({ ...inquiry, phone: "", topics: [], message: "" }, receivedAt);
    expect(text).toContain("電話：（なし）");
    expect(text).toContain("相談したいこと：（選択なし）");
    expect(text.endsWith("■ ご相談の内容\n（なし）")).toBe(true);
  });

  it("件名", () => {
    expect(inquirySubject(inquiry)).toBe("【相談の申し込み】株式会社テスト運送（山田 太郎 様）");
  });

  it("Webhook：Discord は 2000 文字まで、Slack の特別な記号は無害にする、メンションは効かない", () => {
    const long = formatInquiry({ ...inquiry, message: "あ".repeat(2000) + " <!channel> @everyone" }, receivedAt);
    const p = webhookPayload(long);
    expect(p.content.length).toBeLessThanOrEqual(DISCORD_CONTENT_MAX);
    expect(p.content.endsWith("…（長いため途中までです）")).toBe(true);
    expect(p.text).toContain("&lt;!channel&gt;");
    expect(p.text).not.toContain("<!channel>");
    expect(p.allowed_mentions).toEqual({ parse: [] });

    const short = webhookPayload("A & B");
    expect(short.content).toBe("A & B");
    expect(short.text).toBe("A &amp; B");
  });

  it("切り詰めは length で数え、絵文字を割らない", () => {
    // 🚚 は length 2。上限 3 なら「🚚」＋「…」で 3
    expect(truncateChars("🚚🚚🚚", 3, "…")).toBe("🚚…");
    expect(truncateChars("🚚🚚🚚", 2, "…")).toBe("…");
    expect(truncateChars("abc", 3)).toBe("abc");
    expect(truncateChars("abcd", 3)).toBe("ab…");
    expect(escapeSlack("<a>&")).toBe("&lt;a&gt;&amp;");
  });

  it("Webhook：絵文字が多くても Discord の上限を length でも超えない", () => {
    const text = formatInquiry({ ...inquiry, message: "🚚".repeat(1000) }, receivedAt);
    expect(text.length).toBeGreaterThan(DISCORD_CONTENT_MAX);
    const p = webhookPayload(text);
    expect(p.content.length).toBeLessThanOrEqual(DISCORD_CONTENT_MAX);
    expect(p.content.endsWith("…（長いため途中までです）")).toBe(true);
    // サロゲートペアの片割れが残っていない
    expect(p.content).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("メールで送るリンク（入力を下書きに入れる）", () => {
    const href = mailtoHref("owner@example.com", { ...inquiry, message: "い".repeat(500) });
    expect(href.startsWith("mailto:owner@example.com?subject=")).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe("【相談の申し込み】株式会社テスト運送（山田 太郎 様）");
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("業務委託の方の人数：6〜15人");
    expect(body).toContain("い".repeat(299) + "…");
    expect(body).not.toContain("い".repeat(301));
  });

  it("準備中の文言は、メールの予備があるかで変える", () => {
    expect(notReadyMessage(true)).toContain("メールでご連絡ください");
    expect(notReadyMessage(false)).not.toContain("メール");
    expect(notReadyMessage(false).startsWith("ただいまフォームの準備中です。")).toBe(true);
  });
});

describe("流入元（FAX・メール・紹介の効果を数える）", () => {
  const loc = (over: Partial<Parameters<typeof sourceFromLocation>[0]> = {}) => ({
    search: "",
    pathname: "/",
    host: "shimebi.example",
    referrer: "",
    ...over,
  });

  /** テスト用の sessionStorage */
  function memoryStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: vi.fn((k: string, v: string) => void map.set(k, v)),
      map,
    };
  }

  it("URL の utm と、前のサイトのホスト名だけを取る（パス・検索語は持たない）", () => {
    expect(
      sourceFromLocation(
        loc({
          search: "?utm_source=fax&utm_medium=print&utm_campaign=2026-10-a&x=1",
          pathname: "/tools/invoice-cost",
          referrer: "https://www.google.com/search?q=%E6%94%AF%E6%89%95%E6%98%8E%E7%B4%B0",
        }),
      ),
    ).toEqual({
      utm_source: "fax",
      utm_medium: "print",
      utm_campaign: "2026-10-a",
      referrer: "www.google.com",
      landing: "/tools/invoice-cost",
    });
  });

  it("自分のサイトの中の移動は参照元にしない。壊れた referrer は捨てる", () => {
    expect(sourceFromLocation(loc({ referrer: "https://shimebi.example/demo" }))).toEqual({ landing: "/" });
    expect(sourceFromLocation(loc({ referrer: "not a url" }))).toEqual({ landing: "/" });
  });

  it("長い値・改行・制御文字は短い 1 行にする", () => {
    const s = sourceFromLocation(loc({ search: `?utm_source=${"a".repeat(300)}&utm_campaign=a%0Ab%00c` }));
    expect(s?.utm_source).toHaveLength(SOURCE_MAX);
    expect(s?.utm_campaign).toBe("a bc");
  });

  it("最初に開いたときだけ覚え、あとのページで上書きしない", () => {
    const store = memoryStorage();
    const first = captureSource(store, loc({ search: "?utm_source=fax", pathname: "/tools/invoice-cost" }));
    expect(first).toEqual({ utm_source: "fax", landing: "/tools/invoice-cost" });
    const later = captureSource(store, loc({ search: "?utm_source=other", pathname: "/contact", referrer: "https://x.example/" }));
    expect(later).toEqual(first);
    expect(store.setItem).toHaveBeenCalledTimes(1);
    expect(readStoredSource(store)).toEqual(first);
  });

  it("保存が使えない・壊れているときも止まらない", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(captureSource(throwing, loc({ search: "?utm_source=fax" }))).toBeUndefined();
    expect(readStoredSource(throwing)).toBeUndefined();
    expect(readStoredSource(null)).toBeUndefined();
    expect(captureSource(null, loc({ search: "?utm_source=mail" }))).toEqual({ utm_source: "mail", landing: "/" });
    expect(readStoredSource(memoryStorage({ [SOURCE_STORAGE_KEY]: "{not json" }))).toBeUndefined();
    expect(readStoredSource(memoryStorage({ [SOURCE_STORAGE_KEY]: "{}" }))).toBeUndefined();
  });

  it("申し込みに付けて送れる。知らない項目は落とし、形がおかしければ流入元だけ捨てる（申し込みは通す）", () => {
    const d = ok({ ...valid, source: { utm_source: " fax ", landing: "/tools/torihiki-joken", extra: "x", referrer: "" } });
    expect(d.source).toEqual({ utm_source: "fax", landing: "/tools/torihiki-joken" });
    expect(ok({ ...valid, source: { utm_source: "a".repeat(SOURCE_MAX + 1) } }).source).toBeUndefined();
    expect(ok({ ...valid, source: "fax" }).source).toBeUndefined();
    expect(ok({ ...valid, source: { utm_source: 1 } }).source).toBeUndefined();
    expect(ok({ ...valid, source: {} }).source).toBeUndefined();
    expect(ok(valid).source).toBeUndefined();
  });

  it("通知の文面に「流入元」を 1 行で入れる（本文より前）", () => {
    expect(formatSource(undefined)).toBe("（記録なし：直接の入力・ブックマークなど）");
    expect(formatSource({ utm_source: "fax", referrer: "www.google.com", landing: "/" })).toBe(
      "utm_source=fax, 参照元=www.google.com, 最初のページ=/",
    );
    const d = ok({ ...valid, source: { utm_source: "fax", utm_medium: "print", utm_campaign: "a", landing: "/tools/invoice-cost" } });
    const text = formatInquiry(d, new Date("2026-09-23T05:05:00Z"));
    expect(text).toContain("流入元：utm_source=fax, utm_medium=print, utm_campaign=a, 最初のページ=/tools/invoice-cost");
    expect(text.indexOf("流入元：")).toBeLessThan(text.indexOf("■ ご相談の内容"));
  });
});

describe("送り先の設定", () => {
  it("何も無ければ送れない", () => {
    const c = readDeliveryConfig({});
    expect(c).toEqual({ resend: null, webhookUrl: null });
    expect(hasDelivery(c)).toBe(false);
  });

  it("Resend はキーと宛先の両方が必要。差出人の既定は onboarding@resend.dev", () => {
    expect(readDeliveryConfig({ RESEND_API_KEY: "re_x" }).resend).toBeNull();
    expect(readDeliveryConfig({ CONTACT_TO_EMAIL: "a@example.com" }).resend).toBeNull();
    const c = readDeliveryConfig({ RESEND_API_KEY: " re_x ", CONTACT_TO_EMAIL: "a@example.com, b@example.com ," });
    expect(c.resend).toEqual({ apiKey: "re_x", to: ["a@example.com", "b@example.com"], from: DEFAULT_FROM_EMAIL });
    expect(hasDelivery(c)).toBe(true);
    expect(
      readDeliveryConfig({ RESEND_API_KEY: "re_x", CONTACT_TO_EMAIL: "a@example.com", CONTACT_FROM_EMAIL: "form@example.com" })
        .resend?.from,
    ).toBe("form@example.com");
  });

  it("Webhook は http(s) の URL だけ", () => {
    expect(readDeliveryConfig({ CONTACT_WEBHOOK_URL: "https://discord.com/api/webhooks/1/abc" }).webhookUrl).toBe(
      "https://discord.com/api/webhooks/1/abc",
    );
    expect(readDeliveryConfig({ CONTACT_WEBHOOK_URL: "not a url" }).webhookUrl).toBeNull();
    expect(readDeliveryConfig({ CONTACT_WEBHOOK_URL: "javascript:alert(1)" }).webhookUrl).toBeNull();
    expect(hasDelivery(readDeliveryConfig({ CONTACT_WEBHOOK_URL: "https://hooks.slack.com/services/x" }))).toBe(true);
  });
});

describe("送信の回数の制限", () => {
  const MIN = 60 * 1000;

  it("10 分に 5 回まで。6 回目は断り、待つ秒数を返す", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 10 * MIN });
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) expect(limiter.take("1.2.3.4", t0 + i * MIN).ok).toBe(true);
    const sixth = limiter.take("1.2.3.4", t0 + 5 * MIN);
    expect(sixth).toEqual({ ok: false, retryAfterSec: 5 * 60 });
    // ほかの人は数えない
    expect(limiter.take("5.6.7.8", t0 + 5 * MIN).ok).toBe(true);
    // 最初の 1 回が 10 分を過ぎれば、また 1 回送れる
    expect(limiter.take("1.2.3.4", t0 + 10 * MIN + 1).ok).toBe(true);
    expect(limiter.take("1.2.3.4", t0 + 10 * MIN + 2).ok).toBe(false);
  });

  it("覚えておく相手の数に上限がある", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 10 * MIN, maxKeys: 3 });
    for (let i = 0; i < 10; i++) limiter.take(`ip-${i}`, 1000 + i);
    expect(limiter.size()).toBeLessThanOrEqual(3);
  });

  it("送信元の IP", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(h({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({}))).toBe("unknown");
  });
});

describe("受け付けの API（/api/contact）", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let ipSeq = 0;

  /** テストごとに別の IP から送る（回数の制限を持ち越さない） */
  function post(body: unknown, ip = `198.51.100.${++ipSeq}`) {
    return POST(
      new Request("http://localhost/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  }

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    errorLog.mockClear();
    for (const k of ["RESEND_API_KEY", "CONTACT_TO_EMAIL", "CONTACT_FROM_EMAIL", "CONTACT_WEBHOOK_URL"]) vi.stubEnv(k, "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterAll(() => errorLog.mockRestore());

  it("送り先が無ければ 503（準備中）", async () => {
    const res = await post(valid);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/^ただいまフォームの準備中です。/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("入力の誤りは 400 と欄ごとの日本語", async () => {
    vi.stubEnv("CONTACT_WEBHOOK_URL", "https://discord.com/api/webhooks/1/abc");
    const res = await post({ ...valid, email: "bad", agree: false });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe(CONTACT_TEXT.invalid);
    expect(data.fieldErrors.email).toContain("形が正しくありません");
    expect(data.fieldErrors.agree).toBe("プライバシーポリシーへの同意が必要です");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("JSON でなければ 400、大きすぎれば 413", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post("[1,2]")).status).toBe(400);
    expect((await post("")).status).toBe(400);
    expect((await post({ ...valid, message: "あ".repeat(40_000) })).status).toBe(413);
  });

  it("Content-Type が JSON でなければ 415（ほかのサイトのフォームから送らせない）", async () => {
    vi.stubEnv("CONTACT_WEBHOOK_URL", "https://discord.com/api/webhooks/1/abc");
    for (const type of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      const res = await POST(
        new Request("http://localhost/api/contact", {
          method: "POST",
          headers: type ? { "content-type": type } : {},
          body: JSON.stringify(valid),
        }),
      );
      expect(res.status).toBe(415);
    }
    const withCharset = await POST(
      new Request("http://localhost/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8", "x-forwarded-for": "192.0.2.60" },
        body: JSON.stringify(valid),
      }),
    );
    expect(withCharset.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Content-Length が無くても、読みながら上限で止めて 413", async () => {
    const chunk = new TextEncoder().encode("a".repeat(16_000));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 20) return controller.close();
        sent++;
        controller.enqueue(chunk);
      },
    });
    const res = await POST(
      new Request("http://localhost/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(20);
  });

  it("UTF-8 として読めない本文は 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("おとりの欄が埋まっていれば、送ったふり（200）だけで何も送らない", async () => {
    vi.stubEnv("CONTACT_WEBHOOK_URL", "https://discord.com/api/webhooks/1/abc");
    const res = await post({ ...valid, website: "https://spam.example" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Webhook に content と text を送る", async () => {
    vi.stubEnv("CONTACT_WEBHOOK_URL", "https://discord.com/api/webhooks/1/abc");
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/1/abc");
    const sent = JSON.parse(String(init?.body));
    expect(sent.content).toContain("会社名：株式会社テスト運送");
    expect(sent.text).toContain("会社名：株式会社テスト運送");
    expect(sent.allowed_mentions).toEqual({ parse: [] });
  });

  it("流入元を付けて送ると、通知に載る。流入元の形がおかしくても受け付ける", async () => {
    vi.stubEnv("CONTACT_WEBHOOK_URL", "https://discord.com/api/webhooks/1/abc");
    const res = await post({ ...valid, source: { utm_source: "fax", landing: "/tools/invoice-cost" } }, "192.0.2.89");
    expect(res.status).toBe(200);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).content).toContain(
      "流入元：utm_source=fax, 最初のページ=/tools/invoice-cost",
    );
    const bad = await post({ ...valid, source: { utm_source: "x".repeat(500) } }, "192.0.2.90");
    expect(bad.status).toBe(200);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).content).toContain("流入元：（記録なし");
  });

  it("Resend にメールを送る（返信先は申し込んだ人）", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("CONTACT_TO_EMAIL", "owner@example.com");
    fetchMock.mockResolvedValue(Response.json({ id: "x" }));
    const res = await post(valid);
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer re_test");
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({
      from: DEFAULT_FROM_EMAIL,
      to: ["owner@example.com"],
      subject: "【相談の申し込み】株式会社テスト運送（山田 太郎 様）",
      reply_to: "taro@example.com",
    });
    expect(sent.text).toContain("■ ご相談の内容");
  });

  it("片方に届けば 200、すべて失敗なら 502。ログに入力の中身は出さない", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("CONTACT_TO_EMAIL", "owner@example.com");
    vi.stubEnv("CONTACT_WEBHOOK_URL", "https://hooks.slack.com/services/secret-token");

    fetchMock.mockImplementation(async (url) =>
      String(url).includes("resend") ? new Response("{}", { status: 500 }) : new Response("ok", { status: 200 }),
    );
    expect((await post(valid)).status).toBe(200);
    expect(errorLog).toHaveBeenCalledTimes(1);

    errorLog.mockClear();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("resend")) return new Response("{}", { status: 422 });
      throw new TypeError("fetch failed");
    });
    const res = await post(valid);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(CONTACT_TEXT.failed);
    expect(errorLog).toHaveBeenCalledTimes(2);
    const logged = errorLog.mock.calls.flat().map(String).join("\n");
    expect(logged).not.toContain("株式会社テスト運送");
    expect(logged).not.toContain("taro@example.com");
    expect(logged).not.toContain("月末に2日");
    expect(logged).not.toContain("secret-token");

    // 誤りの文言に鍵や URL が混ざっていても伏せる
    errorLog.mockClear();
    fetchMock.mockImplementation(async (url) => {
      throw new TypeError(`request to ${String(url)} failed (Bearer re_test)`);
    });
    expect((await post(valid)).status).toBe(502);
    const leaked = errorLog.mock.calls.flat().map(String).join("\n");
    expect(leaked).toContain("[redacted]");
    expect(leaked).not.toContain("secret-token");
    expect(leaked).not.toContain("re_test");
  });

  it("同じ IP から 10 分に 6 回目は 429", async () => {
    vi.stubEnv("CONTACT_WEBHOOK_URL", "https://discord.com/api/webhooks/1/abc");
    for (let i = 0; i < 5; i++) expect((await post(valid, "192.0.2.77")).status).toBe(200);
    const res = await post(valid, "192.0.2.77");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error).toBe(CONTACT_TEXT.rateLimited);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
