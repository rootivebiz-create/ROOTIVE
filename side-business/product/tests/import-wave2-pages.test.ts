import ExcelJS from "exceljs";
import * as React from "react";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { buildZenginRecords, zenginBytes } from "@/lib/payroll/zengin";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { buildStatementDrafts } from "~/server/calc/statement";
import { createBankDraft, loadBankView, applyBankImport } from "~/server/features/import/bank";
import { applyBatch, createDraftFromFile, readSampleFile } from "~/server/features/import/service";
import { loadBuildInput } from "~/server/repo";
import { DEMO_MONTH, seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * 取り込みの続き（同じファイル・金額の列・口座・Excel に戻す）の画面を HTML にしてみる。
 * 役割ごとに、出すもの・隠すものを文字で確かめる。言ってはいけない言葉が出ないことも。
 */
const state: { db?: Db; user?: SessionUser } = {};
Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async () => state.user,
    AuthError: class AuthError extends Error {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

async function html(el: ReactElement): Promise<string> {
  let failed: unknown = null;
  const stream = await renderToReadableStream(el, { onError: (e) => void (failed = e) });
  await stream.allReady;
  const out = await new Response(stream).text();
  if (failed) throw failed;
  return out.replace(/<!-- -->/g, "");
}

function text(h: string): string {
  return h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const FORBIDDEN = /違反です|違反はありません|(?<!取)適法|問題ありません|対応済み|防げます|単価を下げ|引き下げ|完全自動|ミスゼロ|必ず合う/;

let client: PGlite;
let tenantId = "";
let staffId = "";

beforeAll(async () => {
  const t = await createTestDb();
  state.db = t.db;
  client = t.client;
  tenantId = (await seedDemo(t.db)).tenantId;
  const [u] = await t.db
    .select()
    .from(s.users)
    .where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff")));
  staffId = u.id;
});
afterAll(async () => {
  await client.close();
});

function as(role: SessionUser["role"]) {
  state.user = { id: staffId, tenantId, email: "staff@demo.example", name: "デモ 事務", role };
}

async function page(path: "import" | "work", sp: Record<string, string>) {
  const Page = (await import(path === "import" ? "~/app/(app)/import/page" : "~/app/(app)/work/page")).default;
  return text(await html(await Page({ searchParams: Promise.resolve(sp) } as never)));
}

async function batchPage(id: string, sp: Record<string, string> = {}) {
  const Page = (await import("~/app/(app)/import/[id]/page")).default;
  return text(await html(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) })));
}

async function bankPage(id: string, sp: Record<string, string> = {}) {
  const Page = (await import("~/app/(app)/import/bank/[id]/page")).default;
  return text(await html(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) })));
}

describe("取り込みの確認：金額の列（振込額・控除の提案・振込手数料）", () => {
  it("提案・振込手数料の注意・振込額を出す。閲覧には「採用する」を出さない。反映すると「今の Excel の振込額も読みました（8人）」", async () => {
    const db = state.db!;
    const drafts = buildStatementDrafts(await loadBuildInput(db, tenantId, DEMO_MONTH));
    const by = new Map(drafts.map((d) => [d.driver.name, d]));
    const people: [string, number[]][] = [
      ["青木 翔太", [2310, 0, 4, 0, 0]],
      ["井上 美咲", [0, 21, 0, 0, 0]],
      ["上田 健", [1840, 0, 0, 0, 0]],
      ["遠藤 大輔", [0, 0, 2, 168, 0]],
      ["岡田 拓也", [420, 18, 0, 0, 0]],
      ["加藤 由美", [0, 0, 0, 0, 20]],
      ["木村 誠", [380, 0, 0, 0, 0]],
      ["佐藤 亮", [0, 22, 0, 0, 0]],
    ];
    const lines = ["氏名,宅配（個）,企業配（日）,スポット（件）,ルート（時間）,夜間便（便）,車両リース代,振込手数料,差引支給額"];
    for (const [name, q] of people) lines.push([name, ...q, name === "木村 誠" ? 18000 : 20000, 440, by.get(name)!.total].join(","));
    const d = await createDraftFromFile(db, tenantId, { id: null }, { fileName: "稼働と支給_2026年10月.csv", bytes: new TextEncoder().encode(lines.join("\n")), pageMonth: DEMO_MONTH });

    as("staff");
    const staff = await batchPage(d.id);
    expect(staff).toContain("金額の列から分かったこと");
    expect(staff).toContain("「差引支給額」の列を、今の Excel の振込額として読みました（8人）");
    expect(staff).toContain("振込手数料の列があります。ドライバーの負担にすると減額にあたるおそれがあります");
    expect(staff).toContain("フリーランス法 Q&amp;A");
    expect(staff).toContain("「車両リース代」の列");
    expect(staff).toContain("8人中7人一致");
    expect(staff).toContain("毎月 20,000円（稼働した月だけ）");
    expect(staff).toMatch(/木村 誠：Excel は ¥18,000 ?、式では ¥20,000 ?（この人だけ 18,000円 なら合います）/);
    expect(staff).toMatch(/採用する(?!と)/);
    expect(staff).not.toMatch(FORBIDDEN);
    as("viewer");
    const viewer = await batchPage(d.id);
    expect(viewer).toContain("8人中7人一致");
    // 「採用する」のボタンは出さない（説明の「採用すると…」は出る）
    expect(viewer).not.toMatch(/採用する(?!と)/);

    await applyBatch(db, tenantId, { id: staffId }, d.id, { mode: "replaceAll", confirmDuplicates: false });
    // 振込手数料の列があったことは、反映の記録に残す（見張り番が読める）
    const [row] = await db.select().from(s.importBatches).where(eq(s.importBatches.id, d.id));
    expect((row.summary as { applied: { feeColumns: string[] } }).applied.feeColumns).toEqual(["振込手数料"]);
    as("staff");
    const applied = await batchPage(d.id, { done: "applied" });
    expect(applied).toContain("今の Excel の振込額も読みました（8人）");
    expect(applied).toContain("→ Excel と比べる");
    expect(applied).not.toMatch(FORBIDDEN);
  });
});

describe("取り込みの確認：数式と、その人だけのルール", () => {
  it("Excel の数式（=ROUNDDOWN(D2*0.1,0)）を見せる。登録済みの 10% と同じなら、合わない人の「その人だけのルールを作る」だけを出す", async () => {
    const db = state.db!;
    const people: [string, number, number][] = [
      ["青木 翔太", 2310, 0],
      ["上田 健", 1840, 0],
      ["岡田 拓也", 420, 18],
      ["佐藤 亮", 0, 22],
    ];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("10月");
    ws.addRow(["氏名", "宅配（個）", "企業配（日）", "委託料", "ロイヤリティ"]);
    people.forEach(([name, a, b], i) => {
      const r = i + 2;
      // 宅配・企業配だけの委託料（スポット便などは入れない）
      const base = a * (name === "岡田 拓也" ? 155 : 150) + b * 18000;
      const rate = name === "岡田 拓也" ? 0.08 : 0.1;
      ws.addRow([name, a, b, base, { formula: `ROUNDDOWN(D${r}*${rate},0)`, result: Math.floor(base * rate) }]);
    });
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const d = await createDraftFromFile(db, tenantId, { id: staffId }, { fileName: "ロイヤリティ_2026年10月.xlsx", bytes, pageMonth: DEMO_MONTH });
    as("staff");
    const staff = await batchPage(d.id);
    expect(staff).toContain("4人中3人一致");
    expect(staff).toContain("Excel の数式（ =ROUNDDOWN(D2*0.1,0) など 3 行）からも、同じ式を読み取りました");
    expect(staff).toContain("✓ 登録済みの控除「ロイヤリティ」と同じ式です。");
    expect(staff).toContain("その人だけのルールを作る");
    expect(staff).not.toMatch(/採用する(?!と)/);
    expect(staff).not.toMatch(FORBIDDEN);
    as("viewer");
    expect(await batchPage(d.id)).not.toContain("その人だけのルールを作る");
  });
});

describe("取り込みの確認：同じファイル", () => {
  it("同じファイルは、止めて「取り消して入れ直す」だけを出す（ふつうの「反映する」は出さない）", async () => {
    const db = state.db!;
    const { fileName, bytes } = await readSampleFile("wide");
    const first = await createDraftFromFile(db, tenantId, { id: staffId }, { fileName, bytes, pageMonth: DEMO_MONTH });
    await applyBatch(db, tenantId, { id: staffId }, first.id, { mode: "replaceAll", confirmDuplicates: false });
    const second = await createDraftFromFile(db, tenantId, { id: staffId }, { fileName, bytes, pageMonth: DEMO_MONTH });
    as("staff");
    const p = await batchPage(second.id);
    expect(p).toContain("このファイルは反映済みです");
    expect(p).toMatch(/同じファイルがすでに反映されています（\d+月\d+日・デモ 事務さん）。二重に数えると ¥2,410,600 多く払うおそれがあります/);
    expect(p).toContain("取り消して入れ直す");
    expect(p).not.toMatch(/反映する（\d+件/);
    expect(p).not.toContain("反映へ進む");
    as("viewer");
    expect(await batchPage(second.id)).not.toContain("取り消して入れ直す");
  });
});

describe("取り込みの画面：口座の一覧・Excel に戻す", () => {
  it("「口座の一覧を取り込む」は事務以上。閲覧には口座を出さない。どちらの画面にも「Excel に戻す」", async () => {
    as("staff");
    const bank = await page("import", { m: "2026-10", kind: "bank" });
    expect(bank).toContain("口座の一覧を取り込む");
    expect(bank).toContain("先月、銀行に出した全銀の振込ファイル");
    expect(bank).toContain("読み込む");
    as("viewer");
    const viewerBank = await page("import", { m: "2026-10", kind: "bank" });
    expect(viewerBank).toContain("口座の取り込みは、事務・オーナーの役割でできます");
    expect(viewerBank).not.toContain("読み込む");
    const work = await page("import", { m: "2026-10" });
    expect(work).toContain("Excel に戻す（.xlsx）");
    expect(work).toContain("稼働の表を取り込む");
    const workPage = await page("work", { m: "2026-10" });
    expect(workPage).toContain("Excel に戻す（.xlsx）");
    expect(workPage).toContain("と同じ列の並び");
    // 稼働の無い月は出さない
    expect(await page("work", { m: "2027-03" })).not.toContain("Excel に戻す");
    expect(await page("import", { m: "2027-03" })).not.toContain("Excel に戻す");
  });

  it("口座の取り込みの確認：新しく入る・変わる・当たらないを分けて出し、口座番号は下 3 桁だけ。反映したら台帳に入れた人", async () => {
    const db = state.db!;
    const req = { code: "1234567890", nameKana: "ｻﾝﾌﾟﾙ", bankCode: "0001", bankNameKana: "ﾐｽﾞﾎ", branchCode: "001", branchNameKana: "ﾎﾝﾃﾝ", accountType: "ordinary" as const, accountNumber: "7654321" };
    const t = (holderKana: string, accountNumber: string) => ({
      bankCode: "0001",
      bankNameKana: "ﾐｽﾞﾎ",
      branchCode: "101",
      branchNameKana: "ｻﾝﾌﾟﾙ",
      accountType: "ordinary" as const,
      accountNumber,
      holderKana,
      amount: 1000,
    });
    const bytes = zenginBytes(buildZenginRecords(req, "1031", [t("ｱｵｷ ｼﾖｳﾀ", "7654321"), t("ｷﾑﾗ ﾏｺﾄ", "1112223"), t("ﾔﾏﾀﾞ ﾀﾛｳ", "5556667")]));
    const { id } = await createBankDraft(db, tenantId, { id: staffId }, { fileName: "振込_9月.txt", bytes, pageMonth: DEMO_MONTH });
    as("staff");
    const p = await bankPage(id);
    expect(p).toContain("全銀の総合振込ファイル（振込指定日 10/31・3件・合計 3,000円）");
    expect(p).toContain("新しく入る 1");
    expect(p).toContain("口座が変わる 1");
    expect(p).toContain("当たらない 1");
    expect(p).toContain("口座番号： ****567 → ****321");
    // 口座が変わる人は最初はチェックを外す（新しく入る木村さんだけチェック済み）
    expect(p).toContain("口座が変わる 1 人は、最初はチェックを外しています");
    const Page = (await import("~/app/(app)/import/bank/[id]/page")).default;
    const raw = await html(await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
    // 1 行目は青木さん（口座が変わる）＝外す、2 行目は木村さん（新しく入る）＝チェック
    expect(raw.match(/<input type="checkbox"[^>]*name="row"[^>]*>/g)!.map((t) => t.includes("checked"))).toEqual([false, true]);
    expect(p).toContain("チェックした人の口座を台帳に入れる");
    expect(p).toContain("この人の口座にする");
    expect(p).not.toContain("7654321");
    expect(p).not.toContain("1112223");
    expect(p).not.toMatch(FORBIDDEN);

    const view = (await loadBankView(db, tenantId, id))!;
    const rows = view.rows.filter((r) => r.status === "new" || r.status === "changed");
    await applyBankImport(db, tenantId, { id: staffId }, id, { rows: rows.map((r) => r.index), seen: Object.fromEntries(rows.map((r) => [String(r.index), r.seen])) });
    const done = await bankPage(id, { done: "applied" });
    expect(done).toContain("台帳に入れました（新しく 1 人・口座の変更 1 人）");
    expect(done).toContain("振込データへ");
    const list = await page("import", { m: "2026-10", kind: "bank" });
    expect(list).toContain("振込_9月.txt");
    expect(list).toContain("新しく 1 人・変更 1 人");
  });
});
