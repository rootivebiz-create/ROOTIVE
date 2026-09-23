/**
 * 突合の画面を、そのまま描いて確かめる（DB はメモリ。ログインはデモの会社のオーナーのセッション）。
 * Next.js を起動せずに、ページの関数を呼んで HTML にする。
 */
import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// デモの月（2026年10月）を既定にする・DB はメモリ
process.env.DEMO_MODE = "1";
process.env.PGLITE_DIR = "memory";
// テストの JSX は React.createElement になるので、React を見えるところに置く
(globalThis as unknown as { React: typeof React }).React = React;

// ログインのクッキー（中身は下で作るセッションの値。テストの途中で閲覧の人に切り替える）
const TOKEN = "test-session-token-for-reconcile-pages";
const VIEWER_TOKEN = "test-session-token-for-reconcile-viewer";
const auth = vi.hoisted(() => ({ token: "test-session-token-for-reconcile-pages" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "shimebi_sid" ? { value: auth.token } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const { getDb } = await import("~/db/client");
const s = await import("~/db/schema");
const { seedDemo } = await import("~/server/seed-demo");
const { default: ReconcilePage } = await import("~/app/(app)/reconcile/page");
const { default: NoticePage } = await import("~/app/(app)/reconcile/[id]/page");
const { default: LetterPage } = await import("~/app/(app)/reconcile/[id]/letter/page");
const { default: ReportPage } = await import("~/app/(app)/reconcile/report/page");
const { GET } = await import("~/app/api/reconcile/items/route");
const { importNotice } = await import("~/server/features/reconcile");
const { sha256 } = await import("~/server/tokens");
const { setItemStatusAction, uploadNoticeAction } = await import("~/app/(app)/reconcile/actions");

const html = (el: ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

let tenantId = "";
let noticeId = "";

beforeAll(async () => {
  const db = await getDb();
  ({ tenantId } = await seedDemo(db));
  const [n] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId));
  noticeId = n.id;
  const [owner] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "owner")));
  await db.insert(s.sessions).values({ id: sha256(TOKEN), userId: owner.id, tenantId, expiresAt: new Date(Date.now() + 3600_000) });
});

describe("突合の画面（デモ）", () => {
  it("一覧：まだ突き合わせていない通知も、今の記録で差を出す", async () => {
    const out = text(html(await ReconcilePage({ searchParams: Promise.resolve({}) })));
    expect(out).toContain("元請との突合");
    expect(out).toContain("2026年10月");
    expect(out).toContain("受け取りが少ない可能性（見込み）¥91,700");
    expect(out).toContain("取り戻せた額（確定）¥0");
    expect(out).toContain("確定と見込みは、足し合わせていません");
    expect(out).toContain("A物流（架空）");
    expect(out).toContain("B商事（架空）");
    expect(out).toContain("お支払通知 未登録");
    expect(out).toContain("¥490,800");
    expect(out).toContain("見本のファイルで試す");
    expect(out).toContain("取り込んで突き合わせる");
  });

  it("結果：開くと突き合わせ、差を金額で並べる", async () => {
    const page = await NoticePage({ params: Promise.resolve({ id: noticeId }), searchParams: Promise.resolve({}) });
    const out = text(html(page));
    expect(out).toContain("A物流（架空）　2026年10月分");
    expect(out).toContain("¥91,700");
    expect(out).toContain("数量の違い");
    expect(out).toContain("4,950個 × 190円 = 940,500円");
    expect(out).toContain("4,520個 × 190円 = 858,800円");
    expect(out).toContain("-¥81,700");
    expect(out).toContain("単価の違い");
    expect(out).toContain("20便 × 11,500円 = 230,000円");
    expect(out).toContain("一致した案件（1件）");
    expect(out).toContain("61日 × 22,000円 = 1,342,000円");
    expect(out).toContain("問い合わせ文を作る");
    expect(out).not.toContain("稼働の記録か、案件・行の決め方が変わっています");
    const db = await getDb();
    const items = await db.select().from(s.reconciliationItems).where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)));
    expect(items).toHaveLength(2);
  });

  it("見本を取り込むと、待機料の行（未確認）と決める欄が出る", async () => {
    const db = await getDb();
    const [a] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.name, "A物流（架空）")));
    const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, "..", "public", "samples", "元請_支払通知_2026年10月_SJIS.csv")));
    await importNotice(db, tenantId, null, { clientId: a.id, month: "2026-10-01", fileName: "見本.csv", bytes, replace: true });
    const out = text(html(await NoticePage({ params: Promise.resolve({ id: noticeId }), searchParams: Promise.resolve({ done: "sample" }) })));
    expect(out).toContain("見本のお支払通知（架空）を取り込んで");
    expect(out).toContain("お支払通知にだけある");
    expect(out).toContain("+¥3,000");
    expect(out).toContain("どの案件のことか決まっていない行が 1種類");
    expect(out).toContain("追加の料金（待機料・再配達・高速代など）");
    expect(out).toContain("CSV（Shift_JIS）");
  });

  it("問い合わせ文：数字の入った文面が最初から入っている", async () => {
    const out = text(html(await LetterPage({ params: Promise.resolve({ id: noticeId }) })));
    expect(out).toContain("問い合わせ文を作る");
    expect(out).toContain("当社の記録では 宅配（個建て） 4,950個 × 190円 = 940,500円、お支払通知では 4,520個 = 858,800円（差 81,700円）");
    expect(out).toContain("2件を「問い合わせ済み」にする");
  });

  it("レポート：3 か月のまとめと、記録の違いである旨", async () => {
    const out = text(html(await ReportPage({ searchParams: Promise.resolve({ from: "2026-08", to: "2026-10" }) })));
    expect(out).toContain("元請の支払通知の突合レポート");
    expect(out).toContain("サンプル運送株式会社（架空）");
    expect(out).toContain("2026年8月〜2026年10月分");
    expect(out).toContain("記録の違い");
    expect(out).toContain("¥91,700");
    expect(out).toContain("お支払通知がまだ無い月");
  });

  it("CSV：差の一覧を UTF-8（BOM 付き）で出し、持ち出しを記録する", async () => {
    const res = await GET(new Request("http://localhost/api/reconcile/items?from=2026-10&to=2026-10"));
    expect(res.status).toBe(200);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(await res.arrayBuffer()));
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain("元請,月,種類,内容");
    expect(body).toContain("A物流（架空）,2026年10月,数量の違い,宅配（個建て）,4950,190,940500,4520,190,858800,-81700,未対応,");
    expect(body).toContain("B商事（架空）,2026年10月,お支払通知なし");
    const db = await getDb();
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "export.reconcile_items")));
    expect(logs).toHaveLength(1);
  });

  it("CSV：元請のファイルから来た名前が「=」などで始まっても、Excel で式として動かないようにする", async () => {
    const db = await getDb();
    const [b] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.name, "B商事（架空）")));
    const file = new TextEncoder().encode('品目,数量,単価,金額\n"=HYPERLINK(""http://example.invalid"",""x"")",1,1000,1000\n@SUM(1),1,500,500\n');
    await importNotice(db, tenantId, null, { clientId: b.id, month: "2026-11-01", fileName: "b.csv", bytes: file, replace: false });
    const res = await GET(new Request("http://localhost/api/reconcile/items?from=2026-11&to=2026-11"));
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(await res.arrayBuffer()));
    expect(body).toContain(`"'=HYPERLINK(""http://example.invalid"",""x"")"`);
    expect(body).toContain("'@SUM(1)");
    expect(body).not.toMatch(/,=HYPERLINK|,"=HYPERLINK|,@SUM/);
    expect(body.split("\r\n")[0]).toContain("問い合わせた日,片付けた日,取り戻せた額,メモ");
  });

  it("保存できないデモ（DEMO_READONLY）では、結果の画面を開いても突き合わせを保存しない", async () => {
    const db = await getDb();
    const [a] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.name, "A物流（架空）")));
    // まだ一度も突き合わせていない 12 月分（行だけある）
    const [n] = await db.insert(s.paymentNotices).values({ tenantId, clientId: a.id, month: "2026-12-01", fileName: "12月.csv", total: 19000 }).returning();
    await db.insert(s.paymentNoticeLines).values({ tenantId, noticeId: n.id, rawProject: "宅配", qty: 100, unitPrice: 190, amount: 19000 });
    process.env.DEMO_READONLY = "1";
    try {
      const out = text(html(await NoticePage({ params: Promise.resolve({ id: n.id }), searchParams: Promise.resolve({}) })));
      expect(out).toContain("+¥19,000");
      expect(await db.select().from(s.reconciliationItems).where(eq(s.reconciliationItems.noticeId, n.id))).toEqual([]);
    } finally {
      delete process.env.DEMO_READONLY;
    }
    // ふだんのデモ（保存できる）では、開いたときに 1 回だけ保存する
    html(await NoticePage({ params: Promise.resolve({ id: n.id }), searchParams: Promise.resolve({}) }));
    expect(await db.select().from(s.reconciliationItems).where(eq(s.reconciliationItems.noticeId, n.id))).toHaveLength(1);
  });

  it("小さな部品：差の金額の色と符号", async () => {
    const { DiffAmount } = await import("~/components/reconcile/bits");
    expect(html(createElement(DiffAmount, { value: -81700 }))).toContain("text-danger");
    expect(text(html(createElement(DiffAmount, { value: 3000 })))).toBe("+¥3,000");
  });

  it("直したお支払通知を上げ直すと、問い合わせた差は「片付いた差の記録」に移り、取り戻せた額を入れる欄が出る", async () => {
    const db = await getDb();
    const { markItemsAsked } = await import("~/server/features/reconcile");
    const [a] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.name, "A物流（架空）")));
    const open = await db.select().from(s.reconciliationItems).where(and(eq(s.reconciliationItems.tenantId, tenantId), eq(s.reconciliationItems.noticeId, noticeId)));
    await markItemsAsked(db, tenantId, null, { noticeId, itemIds: open.filter((i) => i.diff < 0).map((i) => i.id) });
    const fixed = new TextEncoder().encode("品目,数量,単価,金額\n宅配,4950,190,940500\n企業配,61,22000,1342000\n夜間便,20,12000,240000\n");
    await importNotice(db, tenantId, null, { clientId: a.id, month: "2026-10-01", fileName: "直し.csv", bytes: fixed, replace: true });
    const page = html(await NoticePage({ params: Promise.resolve({ id: noticeId }), searchParams: Promise.resolve({}) }));
    const out = text(page);
    expect(out).toContain("当社の記録とお支払通知の金額は、案件ごとに一致しました");
    expect(out).toContain("片付いた差の記録（2件）");
    expect(out).toContain("記録がそろいました");
    expect(out).toContain("取り戻せた額がわかれば");
    // 片付いた記録の扱いは「解決」「了承」だけから選ぶ
    expect(page).not.toContain('<option value="open">');
    expect(out).not.toContain("問い合わせ文を作る");
  });

  it("閲覧の人：差は見えるが、変える欄は出さず、見ただけでは何も書かない。書き込みは断る", async () => {
    const db = await getDb();
    const other = await seedDemo(db);
    const [viewer] = await db.insert(s.users).values({ tenantId: other.tenantId, email: "viewer@demo.example", name: "閲覧 さん", role: "viewer" }).returning();
    await db.insert(s.sessions).values({ id: sha256(VIEWER_TOKEN), userId: viewer.id, tenantId: other.tenantId, expiresAt: new Date(Date.now() + 3600_000) });
    const [n] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, other.tenantId));
    auth.token = VIEWER_TOKEN;
    try {
      const page = html(await NoticePage({ params: Promise.resolve({ id: n.id }), searchParams: Promise.resolve({}) }));
      const out = text(page);
      expect(out).toContain("¥91,700");
      expect(out).toContain("-¥81,700");
      expect(out).toContain("事務の方に「突き合わせ直す」を押してもらってください");
      expect(page).not.toContain('name="status"');
      expect(page).not.toContain('name="target"');
      expect(page).not.toContain('name="paidOn"');
      expect(out).not.toContain("このお支払通知を削除する");
      const saved = await db.select().from(s.reconciliationItems).where(eq(s.reconciliationItems.noticeId, n.id));
      expect(saved).toEqual([]);

      const list = text(html(await ReconcilePage({ searchParams: Promise.resolve({}) })));
      expect(list).toContain("受け取りが少ない可能性（見込み）¥91,700");
      expect(list).not.toContain("取り込んで突き合わせる");
      expect(list).not.toContain("見本のファイルで試す");

      // 書き込みは Server Action でも断る（画面で隠しているだけにしない）
      const fd = new FormData();
      fd.set("itemId", "00000000-0000-4000-8000-000000000000");
      fd.set("status", "resolved");
      expect(await setItemStatusAction(undefined, fd)).toEqual({ ok: false, error: "この操作をする権限がありません" });
      const up = new FormData();
      up.set("clientId", "00000000-0000-4000-8000-000000000000");
      up.set("month", "2026-10");
      expect(await uploadNoticeAction(undefined, up)).toEqual({ ok: false, error: "この操作をする権限がありません" });

      // ほかの会社の通知は開けない（404）
      await expect(NoticePage({ params: Promise.resolve({ id: noticeId }), searchParams: Promise.resolve({}) })).rejects.toThrow();
      await expect(LetterPage({ params: Promise.resolve({ id: noticeId }) })).rejects.toThrow();
    } finally {
      auth.token = TOKEN;
    }
  });
});
