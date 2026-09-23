/**
 * 突合の続きの画面と、問い合わせ文の PDF のダウンロード（DB はメモリ。ログインはデモの会社のセッション）。
 * Next.js を起動せずに、ページ・route の関数を呼んで確かめる。
 */
import * as React from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.DEMO_MODE = "1";
process.env.PGLITE_DIR = "memory";
(globalThis as unknown as { React: typeof React }).React = React;

const OWNER = "test-session-token-for-reconcile-letter-owner";
const VIEWER = "test-session-token-for-reconcile-letter-viewer";
const auth = vi.hoisted(() => ({ token: "test-session-token-for-reconcile-letter-owner" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "shimebi_sid" ? { value: auth.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const { getDb } = await import("~/db/client");
const s = await import("~/db/schema");
const { seedDemo } = await import("~/server/seed-demo");
const { sha256 } = await import("~/server/tokens");
const { runReconcile, markItemsAsked, setItemStatus } = await import("~/server/features/reconcile");
const { default: ReconcilePage } = await import("~/app/(app)/reconcile/page");
const { default: NoticePage } = await import("~/app/(app)/reconcile/[id]/page");
const { default: LetterPage } = await import("~/app/(app)/reconcile/[id]/letter/page");
const { default: ReportPage } = await import("~/app/(app)/reconcile/report/page");
const { GET, POST } = await import("~/app/api/reconcile/[noticeId]/letter/route");

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'");
const params = (noticeId: string) => ({ params: Promise.resolve({ noticeId }) });

let tenantId = "";
let noticeId = "";
let otherNoticeId = "";
let itemIds: { takuhai: string; yakan: string } = { takuhai: "", yakan: "" };

beforeAll(async () => {
  const db = await getDb();
  ({ tenantId } = await seedDemo(db));
  const [n] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId));
  noticeId = n.id;
  const [owner] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")));
  await db.insert(s.sessions).values({ id: sha256(OWNER), userId: owner.id, tenantId, expiresAt: new Date(Date.now() + 3600_000) });
  const [viewer] = await db.insert(s.users).values({ tenantId, email: "viewer@demo.example", name: "閲覧 さん", role: "viewer" }).returning();
  await db.insert(s.sessions).values({ id: sha256(VIEWER), userId: viewer.id, tenantId, expiresAt: new Date(Date.now() + 3600_000) });
  await runReconcile(db, tenantId, noticeId, owner.id);
  const items = await db.select().from(s.reconciliationItems).where(eq(s.reconciliationItems.noticeId, noticeId));
  itemIds = { takuhai: items.find((i) => i.label === "宅配（個建て）")!.id, yakan: items.find((i) => i.label === "夜間便")!.id };
  const other = await seedDemo(db);
  const [on] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, other.tenantId));
  otherNoticeId = on.id;
});

describe("問い合わせ文の PDF（GET /api/reconcile/[noticeId]/letter）", () => {
  it("事務・社長：選んだ差の PDF を出し、持ち出しを記録する", async () => {
    const url = `http://localhost/api/reconcile/${noticeId}/letter?items=${itemIds.takuhai}&items=${itemIds.yakan}&contact=${encodeURIComponent("経理部 ご担当者様")}&sender=${encodeURIComponent("デモ 事務")}&offer=1`;
    const res = await GET(new Request(url), params(noticeId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(decodeURIComponent(res.headers.get("content-disposition") ?? "")).toContain("問い合わせ_A物流（架空）_2026年10月分.pdf");
    const body = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(body.slice(0, 5)).toBe("%PDF-");
    const db = await getDb();
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "export.reconcile_letter")));
    expect(logs).toHaveLength(1);
    expect(logs[0].detail).toMatchObject({ items: [itemIds.takuhai, itemIds.yakan], total: -91700, edited: false });
  });

  it("画面で直した文面は POST で受けて、そのまま使う。ほかのサイトからのフォームは断る", async () => {
    const form = new FormData();
    form.append("items", itemIds.yakan);
    form.set("contact", "ご担当者様");
    form.set("sender", "デモ 事務");
    form.set("offer", "0");
    form.set("body", "A物流（架空）\r\nご担当者様\r\n\r\n夜間便の単価について、ご確認をお願いいたします。");
    const res = await POST(new Request(`http://localhost/api/reconcile/${noticeId}/letter`, { method: "POST", body: form, headers: { origin: "http://localhost" } }), params(noticeId));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const db = await getDb();
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "export.reconcile_letter")));
    expect(logs.at(-1)!.detail).toMatchObject({ items: [itemIds.yakan], total: -10000, edited: true });

    const cross = await POST(new Request(`http://localhost/api/reconcile/${noticeId}/letter`, { method: "POST", body: form, headers: { origin: "https://evil.example" } }), params(noticeId));
    expect(cross.status).toBe(403);
  });

  it("選んだ差が無い・ほかの会社の通知・形の違う id は断る（理由と戻り先の画面）", async () => {
    const none = await GET(new Request(`http://localhost/api/reconcile/${noticeId}/letter?items=00000000-0000-4000-8000-000000000000`), params(noticeId));
    expect(none.status).toBe(400);
    expect(await none.text()).toContain("選んだ差が見つかりません");
    const other = await GET(new Request(`http://localhost/api/reconcile/${otherNoticeId}/letter`), params(otherNoticeId));
    expect(other.status).toBe(404);
    expect(await other.text()).toContain("見つかりません");
    const bad = await GET(new Request("http://localhost/api/reconcile/x/letter"), params("../x"));
    expect(bad.status).toBe(404);
    // 何も選ばなければ、画面と同じく「未対応で少ない可能性」の差で作る
    const def = await GET(new Request(`http://localhost/api/reconcile/${noticeId}/letter`), params(noticeId));
    expect(def.status).toBe(200);
  });

  it("閲覧の人は PDF を出せない（画面にもボタンを出さない）。文面は見られる", async () => {
    auth.token = VIEWER;
    try {
      const res = await GET(new Request(`http://localhost/api/reconcile/${noticeId}/letter`), params(noticeId));
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("権限がありません");
      const page = html(await LetterPage({ params: Promise.resolve({ id: noticeId }) }));
      expect(text(page)).toContain("当社の記録では 宅配（個建て） 4,950個 × 190円 = 940,500円");
      expect(page).not.toContain(`/api/reconcile/${noticeId}/letter`);
      expect(text(page)).not.toContain("PDF にする");
    } finally {
      auth.token = OWNER;
    }
  });

  it("事務・社長の問い合わせ文の画面：PDF のボタンと、選んだ差・宛名・差出人を送る欄", async () => {
    const page = html(await LetterPage({ params: Promise.resolve({ id: noticeId }) }));
    expect(page).toContain(`action="/api/reconcile/${noticeId}/letter"`);
    expect(page).toContain(`name="items" value="${itemIds.takuhai}"`);
    expect(page).toContain('name="contact" value="ご担当者様"');
    expect(text(page)).toContain("PDF にする（差の一覧の表つき）");
    expect(text(page)).toContain("コピー");
    expect(text(page)).toContain("メールソフトで開く");
  });
});

describe("画面：扱いの流れ・返事待ち・見つけたお金・取引をやめた元請", () => {
  it("結果の画面：見つけた日・問い合わせた日・「返事待ち n日」（14 日を過ぎたら黄色）", async () => {
    const db = await getDb();
    await markItemsAsked(db, tenantId, null, { noticeId, itemIds: [itemIds.takuhai, itemIds.yakan] });
    await db.update(s.reconciliationItems).set({ askedAt: new Date(Date.now() - 20 * 86400000) }).where(eq(s.reconciliationItems.id, itemIds.takuhai));
    await db.update(s.reconciliationItems).set({ askedAt: new Date(Date.now() - 3 * 86400000) }).where(eq(s.reconciliationItems.id, itemIds.yakan));
    const page = html(await NoticePage({ params: Promise.resolve({ id: noticeId }), searchParams: Promise.resolve({}) }));
    const out = text(page);
    expect(out).toContain("見つけた");
    expect(out).toContain("問い合わせた");
    expect(out).toContain("返事待ち 20日");
    expect(out).toContain("返事待ち 3日");
    // 20 日は黄色、3 日は灰色
    expect(page).toContain('border-warning/40 bg-warning/10 text-warning">返事待ち 20日');
    expect(page).toContain('bg-muted text-muted-foreground">返事待ち 3日');
  });

  it("一覧：返事待ちの一覧と、見つけたお金（確定と見込み）。取引をやめた元請は上げる先に出さない", async () => {
    const db = await getDb();
    await setItemStatus(db, tenantId, null, { itemId: itemIds.takuhai, status: "resolved", note: "11月分に上乗せ", recoveredAmount: 81700 });
    const [b] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.name, "B商事（架空）")));
    await db.update(s.clients).set({ active: false }).where(eq(s.clients.id, b.id));
    try {
      const page = html(await ReconcilePage({ searchParams: Promise.resolve({}) }));
      const out = text(page);
      expect(out).toContain("取り戻せた額（確定）¥81,700");
      expect(out).toContain("受け取りが少ない可能性（見込み）¥10,000");
      expect(out).toContain("確定と見込みは、足し合わせていません");
      expect(out).toContain("返事待ち（1件）");
      expect(out).toContain("夜間便");
      // B商事：稼働があるので一覧には出す（取引終了の印）。お支払通知を上げる先には出さない
      expect(out).toContain("取引終了");
      expect(page).not.toContain(`<option value="${b.id}"`);
      expect(out).toContain("取引をやめた元請（1社）は選べません");
      // B商事は 20 日締めで稼働に日付が無い：月単位で比べている旨
      expect(out).toContain("締め日が違うため月単位で比べています");
    } finally {
      await db.update(s.clients).set({ active: true }).where(eq(s.clients.id, b.id));
    }
  });

  it("結果の画面：直したお支払通知をその場で上げ直す欄（元請と月は決まっている）。閲覧の人には出さない。返事待ちの一覧から差へ飛べる", async () => {
    const page = html(await NoticePage({ params: Promise.resolve({ id: noticeId }), searchParams: Promise.resolve({}) }));
    expect(text(page)).toContain("直したお支払通知のファイル（A物流（架空）・2026年10月分）");
    expect(page).toContain('name="replace" value="1"');
    expect(page).toContain('name="month" value="2026-10"');
    // 差のカードに印（返事待ちの一覧のリンク先）
    expect(page).toContain(`id="item-${itemIds.yakan}"`);
    const list = html(await ReconcilePage({ searchParams: Promise.resolve({}) }));
    expect(list).toContain(`/reconcile/${noticeId}#item-${itemIds.yakan}`);
    auth.token = VIEWER;
    try {
      const view = html(await NoticePage({ params: Promise.resolve({ id: noticeId }), searchParams: Promise.resolve({}) }));
      expect(text(view)).not.toContain("直したお支払通知のファイル");
      expect(view).not.toContain('name="replace"');
    } finally {
      auth.token = OWNER;
    }
  });

  it("上げる欄：締め日が月末でない元請（B商事は 20 日締め）を選ぶと、何日〜何日の分かを書き添える", async () => {
    const out = text(html(await ReconcilePage({ searchParams: Promise.resolve({}) })));
    expect(out).toContain("B商事（架空）は毎月20日締めです。2026年10月分は 2026年9月21日〜2026年10月20日 の分です。");
    expect(out).toContain("お支払通知の締めの日が 2026年10月20日 になっているか確かめてください");
  });

  it("3 か月のレポート：見つけたお金を確定と見込みに分けて出す", async () => {
    const out = text(html(await ReportPage({ searchParams: Promise.resolve({ from: "2026-08", to: "2026-10" }) })));
    expect(out).toContain("見つけたお金（2026年8月〜2026年10月分）");
    expect(out).toContain("取り戻せた額（確定）¥81,700");
    expect(out).toContain("受け取りが少ない可能性（見込み）¥10,000");
    expect(out).toContain("確定と見込みは、足し合わせていません");
    expect(out).toContain("締め日が違うため月単位で比べています");
  });
});
