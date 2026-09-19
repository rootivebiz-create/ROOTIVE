import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { lineSignature, verifyLineSignature } from "@/lib/integrations/line-signature";
import { buildDriveMultipart, driveMultipartContentType, DRIVE_BOUNDARY, driveTimestamp, withTimestamp } from "@/lib/integrations/multipart";
import { alertMessage, guideMessage, linkFailedMessage, linkedMessage, statementReadyMessage, testMessage, welcomeMessage } from "@/lib/integrations/messages";
import { LINE_LINK_CODE_RE, LINE_MAX_TEXT, maskSecret, parseDriveConfig, parseLineConfig, toIntegrationView } from "@/lib/integrations/types";
import type { Integration } from "@/lib/db/types";

const SECRET = "channel-secret-0123456789";
const BODY = JSON.stringify({ events: [{ type: "message", message: { type: "text", text: "123456" } }] });

describe("verifyLineSignature", () => {
  it("正しい署名を受け入れる", () => {
    const sig = createHmac("sha256", SECRET).update(BODY, "utf8").digest("base64");
    expect(lineSignature(BODY, SECRET)).toBe(sig);
    expect(verifyLineSignature(BODY, sig, SECRET)).toBe(true);
  });

  it("本文が 1 文字でも違えば拒否する", () => {
    const sig = lineSignature(BODY, SECRET);
    expect(verifyLineSignature(`${BODY} `, sig, SECRET)).toBe(false);
  });

  it("チャネルシークレットが違えば拒否する", () => {
    const sig = lineSignature(BODY, SECRET);
    expect(verifyLineSignature(BODY, sig, "another-secret")).toBe(false);
  });

  it("長さの違う署名でも例外にならず false を返す", () => {
    expect(verifyLineSignature(BODY, "abc", SECRET)).toBe(false);
    expect(verifyLineSignature(BODY, `${lineSignature(BODY, SECRET)}==`, SECRET)).toBe(false);
  });

  it("署名やシークレットが無ければ false", () => {
    expect(verifyLineSignature(BODY, "", SECRET)).toBe(false);
    expect(verifyLineSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyLineSignature(BODY, lineSignature(BODY, SECRET), "")).toBe(false);
    expect(verifyLineSignature(BODY, lineSignature(BODY, SECRET), null)).toBe(false);
  });

  it("日本語を含む本文でも検証できる", () => {
    const body = JSON.stringify({ text: "こんにちは、ROOTIVE です" });
    expect(verifyLineSignature(body, lineSignature(body, SECRET), SECRET)).toBe(true);
  });
});

describe("maskSecret", () => {
  it("前 3 文字と後ろ 4 文字だけ残す", () => {
    expect(maskSecret("sk-0123456789abcd")).toBe("sk-…abcd");
  });

  it("短い値は全部隠す", () => {
    expect(maskSecret("1234567")).toBe("…");
    expect(maskSecret("abc")).toBe("…");
  });

  it("未設定は空文字", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("   ")).toBe("");
    expect(maskSecret(null)).toBe("");
    expect(maskSecret(undefined)).toBe("");
  });

  it("元の値が残らない", () => {
    const raw = "channel-access-token-very-long-value-xyz";
    const masked = maskSecret(raw);
    expect(masked).not.toContain("access-token");
    expect(masked.length).toBeLessThan(raw.length);
  });
});

describe("LINE の文面", () => {
  const base = {
    companyName: "株式会社ROOTIVE",
    driverName: "川島 幹太",
    monthLabel: "2026年9月",
    payoutIncl: 123456,
    payoutDate: "2026-10-31",
    url: "https://example.com/driver/statements/2026-09",
  };

  it("支払明細の連絡：金額は円・カンマ区切り、日付は和暦表記なしの日本語", () => {
    const text = statementReadyMessage(base);
    expect(text).toContain("【株式会社ROOTIVE】2026年9月の支払明細ができました");
    expect(text).toContain("川島 幹太 さん");
    expect(text).toContain("お支払額（税込）：¥123,456");
    expect(text).toContain("振込予定日：2026年10月31日");
    expect(text).toContain(base.url);
  });

  it("支払明細の連絡：改行で読みやすく区切る（空行は 1 行まで）", () => {
    const text = statementReadyMessage(base);
    expect(text.split("\n").length).toBeGreaterThan(3);
    expect(text).not.toMatch(/\n{3,}/);
    expect(text.startsWith("\n")).toBe(false);
    expect(text.endsWith("\n")).toBe(false);
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  });

  it("支払明細の連絡：振込予定日と URL は省略できる", () => {
    const text = statementReadyMessage({ ...base, payoutDate: null, url: null });
    expect(text).not.toContain("振込予定日");
    expect(text).not.toContain("http");
    expect(text).toContain("お支払額（税込）：¥123,456");
  });

  it("端数のある金額は四捨五入して表示する", () => {
    expect(statementReadyMessage({ ...base, payoutIncl: 1234.5 })).toContain("¥1,235");
  });

  it("アラートの通知", () => {
    const text = alertMessage({ companyName: "ROOTIVE", title: "利益率が低下しています", detail: "9月の営業利益率が 3% です。", url: "https://example.com/dashboard" });
    expect(text).toContain("【ROOTIVE】重要なお知らせ");
    expect(text).toContain("利益率が低下しています");
    expect(text).toContain("9月の営業利益率が 3% です。");
    expect(text).toContain("https://example.com/dashboard");
  });

  it("アラートの通知：詳細と URL が無くても崩れない", () => {
    const text = alertMessage({ companyName: "ROOTIVE", title: "未入力の稼働があります" });
    expect(text).toBe("【ROOTIVE】重要なお知らせ\n\n未入力の稼働があります");
  });

  it("連携完了の返信", () => {
    expect(linkedMessage({ companyName: "ROOTIVE", name: "川島 幹太" })).toContain("川島 幹太 さんと連携しました。");
  });

  it("会社名が空でも見出しが壊れない", () => {
    expect(linkedMessage({ companyName: "", name: "川島 幹太" }).startsWith("連携が完了しました")).toBe(true);
  });

  it("案内・歓迎・テストの文面（絵文字を使わない）", () => {
    const texts = [guideMessage(), welcomeMessage("ROOTIVE"), linkFailedMessage(), testMessage("ROOTIVE")];
    for (const text of texts) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    expect(guideMessage()).toContain("このアカウントからは支払明細やお知らせをお送りします。");
    expect(linkFailedMessage()).toContain("合言葉が見つかりませんでした。");
  });

  it("長い本文は LINE の上限で切り詰める", () => {
    const text = alertMessage({ companyName: "ROOTIVE", title: "あ".repeat(6000) });
    expect(text.length).toBeLessThanOrEqual(LINE_MAX_TEXT);
    expect(text.endsWith("…")).toBe(true);
  });

  it("合言葉は 8 桁の数字だけを受け付ける", () => {
    expect(LINE_LINK_CODE_RE.test("01234567")).toBe(true);
    expect(LINE_LINK_CODE_RE.test("1234567")).toBe(false);
    expect(LINE_LINK_CODE_RE.test("123456789")).toBe(false);
    expect(LINE_LINK_CODE_RE.test("1234567a")).toBe(false);
  });
});

describe("Google ドライブのアップロード用ボディ", () => {
  it("メタデータと本体を境界で挟む", () => {
    const body = buildDriveMultipart({ name: "backup.json", parents: ["folder-1"] }, '{"a":1}');
    const lines = body.split("\r\n");
    expect(lines[0]).toBe(`--${DRIVE_BOUNDARY}`);
    expect(lines[1]).toBe("Content-Type: application/json; charset=UTF-8");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe('{"name":"backup.json","parents":["folder-1"]}');
    expect(body).toContain('{"a":1}');
    expect(body.trimEnd().endsWith(`--${DRIVE_BOUNDARY}--`)).toBe(true);
    expect(driveMultipartContentType()).toBe(`multipart/related; boundary=${DRIVE_BOUNDARY}`);
  });

  it("境界は指定できる", () => {
    const body = buildDriveMultipart({ name: "a.json" }, "{}", "my-boundary");
    expect(body.startsWith("--my-boundary\r\n")).toBe(true);
    expect(driveMultipartContentType("my-boundary")).toBe("multipart/related; boundary=my-boundary");
  });

  it("ファイル名に日時を足して上書きを避ける", () => {
    const now = new Date("2026-09-19T01:30:45.123Z");
    expect(driveTimestamp(now)).toBe("20260919T013045Z");
    expect(withTimestamp("backup.json", now)).toBe("backup_20260919T013045Z.json");
    expect(withTimestamp("rootive-backup-2026-09.json", now)).toBe("rootive-backup-2026-09_20260919T013045Z.json");
    expect(withTimestamp("backup", now)).toBe("backup_20260919T013045Z");
    expect(withTimestamp("", now)).toBe("backup_20260919T013045Z.json");
  });
});

describe("連携の設定（jsonb の読み取り）", () => {
  it("LINE：既定は支払明細の通知のみオン", () => {
    expect(parseLineConfig(null)).toEqual({ notifyStatement: true, notifyAlerts: false, botName: "" });
    expect(parseLineConfig({ notifyStatement: false, notifyAlerts: true, botName: "ROOTIVE" })).toEqual({
      notifyStatement: false,
      notifyAlerts: true,
      botName: "ROOTIVE",
    });
  });

  it("LINE：想定外の値は既定に落とす", () => {
    expect(parseLineConfig({ notifyStatement: "yes", botName: 1 })).toEqual({ notifyStatement: true, notifyAlerts: false, botName: "" });
    expect(parseLineConfig([1, 2])).toEqual({ notifyStatement: true, notifyAlerts: false, botName: "" });
  });

  it("Google ドライブ：既定は自動保存オン", () => {
    expect(parseDriveConfig(null)).toEqual({ autoBackup: true, folderName: "" });
    expect(parseDriveConfig({ autoBackup: false, folderName: "ROOTIVE 保管" })).toEqual({ autoBackup: false, folderName: "ROOTIVE 保管" });
  });

  it("状態は未登録でも安全に読める", () => {
    expect(toIntegrationView("line", null)).toEqual({ kind: "line", isEnabled: false, status: "", lastOkAt: null, lastError: "" });
    const row = {
      id: "i1",
      company_id: "c1",
      kind: "line",
      is_enabled: true,
      config: {},
      status: "接続済み",
      last_ok_at: "2026-09-19T00:00:00Z",
      last_error: "",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-19T00:00:00Z",
    } as Integration;
    expect(toIntegrationView("line", row)).toEqual({
      kind: "line",
      isEnabled: true,
      status: "接続済み",
      lastOkAt: "2026-09-19T00:00:00Z",
      lastError: "",
    });
  });
});
