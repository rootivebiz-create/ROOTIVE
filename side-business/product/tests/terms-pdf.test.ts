import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import { createTermsVersion, termsPdfFileName, termsPdfSource } from "~/server/features/terms";
import { renderTermsPdf } from "~/server/pdf/terms-pdf";
import { seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/** PDF の中の「ページ」の数（/Type /Page の数。/Pages は数えない） */
function pageCount(bytes: Uint8Array): number {
  return (Buffer.from(bytes).toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

describe("取引条件の明示書の PDF", () => {
  it("遠藤さん（D04）の明示書を、日本語フォントで A4 にできる。ほかの会社の記録は出せない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const other = await seedDemo(db);
    const [d] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D04")));
    const projects = await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId));
    const [u] = await db.select().from(s.users).where(and(eq(s.users.tenantId, tenantId), eq(s.users.role, "staff")));
    const r = await createTermsVersion(
      db,
      tenantId,
      { userId: u.id, role: "staff" },
      {
        driverId: d.id,
        projectIds: projects.filter((p) => p.name === "ルート配送（時給）" || p.name === "スポット便").map((p) => p.id),
        serviceDescription: "貨物軽自動車を使った荷物の配送業務",
        place: "B商事（架空）の指定する配送先",
        periodFrom: "2026-05-01",
        receipt: "業務を行った日ごとに受け取ったものとします。",
        deemed: true,
        isSubcontract: true,
        originalClient: "B商事（架空）",
        originalPayDate: "毎月20日締め・翌月末日払い",
        documentName: "業務委託契約書",
        issuedOn: "2026-10-20",
      },
      new Date("2026-10-20T10:00:00+09:00"),
    );

    const source = await termsPdfSource(db, tenantId, r.recordId);
    expect(source).not.toBeNull();
    expect(source!.doc.company).toEqual({ name: "サンプル運送株式会社（架空）", registrationNo: "T1234567890123" });
    expect(source!.doc.driver.name).toBe("遠藤 大輔");
    expect(source!.doc.hashShort).toHaveLength(12);
    expect(source!.receivedText).toBe("受託者の受け取り：この版の記録はまだありません");
    expect(termsPdfFileName(source!.doc)).toBe("取引条件の明示書_遠藤 大輔_版1.pdf");

    const bytes = await renderTermsPdf([source!], new Date("2026-10-20T10:00:00+09:00"));
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    expect(pageCount(bytes)).toBeGreaterThanOrEqual(1);
    // 日本語フォントが埋め込まれている
    expect(Buffer.from(bytes).toString("latin1")).toMatch(/NotoSansJP/);

    // 2 人分をまとめても作れる（1 人ずつ改ページ）
    const two = await renderTermsPdf([source!, source!]);
    expect(pageCount(two)).toBeGreaterThan(pageCount(bytes));

    expect(await termsPdfSource(db, other.tenantId, r.recordId)).toBeNull();
    await client.close();
  });

  it("明示書が無くても壊れない", async () => {
    const bytes = await renderTermsPdf([]);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
