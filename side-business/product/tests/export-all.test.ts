import { and, eq, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { strToU8, unzipSync, zipSync } from "fflate";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { pgErrorMessage } from "~/server/db-errors";
import { closeMonth, reopenMonth } from "~/server/features/close";
import {
  buildTenantExport,
  importTenantData,
  previewTenantImport,
  readTenantExport,
  schemaVersion,
  type ExportManifest,
} from "~/server/features/export-all";
import { encodeCsv, fromCell, parseCsv, toCell } from "~/server/features/export-all/csv";
import { EXPORT_TABLES, NOT_EXPORTED_TABLES } from "~/server/features/export-all/tables";
import { createTransferBatch } from "~/server/features/transfer";
import { isMonthClosed } from "~/server/repo";
import { DEMO_MONTH, DEMO_PREV_MONTH, seedDemo } from "~/server/seed-demo";
import { generateStatements, stableStringify } from "~/server/statements-core";
import { createTestDb } from "./helpers/db";

const noWatch = { runWatch: async () => [] };
const NOW = new Date("2026-11-30T03:00:00Z");
const PASSWORD_HASH = "scrypt$16384$8$1$c2VjcmV0c2FsdA$c2VjcmV0aGFzaHZhbHVlZm9yZXhwb3J0dGVzdA";

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** ZIP の中身を文字で（BOM は残す。TextDecoder は既定で BOM を外すため、外さない読み方をする） */
function unzip(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  const td = new TextDecoder("utf-8", { ignoreBOM: true });
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, td.decode(v)]));
}

/** ZIP の中身を書き換えて、目録のハッシュも付け直す（細工した ZIP を作る） */
function rezip(bytes: Uint8Array, edit: (files: Record<string, string>) => void, fixHashes = true): Uint8Array {
  const files = unzip(bytes);
  edit(files);
  if (fixHashes) {
    const manifest = JSON.parse(files["manifest.json"]) as ExportManifest;
    for (const name of Object.keys(manifest.files)) manifest.files[name] = sha(strToU8(files[name]));
    files["manifest.json"] = JSON.stringify(manifest);
  }
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

async function countOf(db: Db, table: PgTable, tenantId: string): Promise<number> {
  const cfg = getTableConfig(table);
  const col = cfg.name === "tenants" ? "id" : "tenant_id";
  const res = (await db.execute(`select count(*)::int as n from "${cfg.name}" where "${col}" = '${tenantId}'`)) as unknown as { rows: { n: number }[] };
  return res.rows[0].n;
}

describe("全データの書き出しの CSV（純関数）", () => {
  it("空欄（値なし）と空の文字、カンマ・引用符・改行・式に見える文字を、1 文字も変えずに往復する", () => {
    const values: (string | null)[] = [null, "", "青木, 翔太", 'say "hi"', "1 行目\r\n2 行目", "=1+2", "+81", "-5", "@x", "'quoted", "''", " 前後に空白 ", "普通の文字"];
    const cells = values.map((v) => toCell(v, "text"));
    // 式として動かないように ' を付ける
    expect(cells[5]).toBe("'=1+2");
    expect(cells[9]).toBe("''quoted");
    const text = encodeCsv(["v"], cells.map((c) => [c]));
    const parsed = parseCsv("\ufeff" + text);
    expect(parsed.header).toEqual(["v"]);
    expect(parsed.rows.map((r) => fromCell(r[0], "text"))).toEqual(values);
  });

  it("数・真偽・配列・JSON の列", () => {
    expect(toCell(357555, "integer")).toBe("357555");
    expect(toCell(-11000, "integer")).toBe("-11000");
    expect(fromCell("-11000", "integer")).toBe("-11000");
    expect(toCell(true, "boolean")).toBe("true");
    expect(fromCell("false", "boolean")).toBe(false);
    expect(toCell(["A物流", "Ａ物流"], "text[]")).toBe('["A物流","Ａ物流"]');
    expect(fromCell('["a","b"]', "text[]")).toEqual(["a", "b"]);
    expect(fromCell('{"x":{"y":[1,2]}}', "jsonb")).toEqual({ x: { y: [1, 2] } });
    expect(toCell(null, "jsonb")).toBeNull();
    // 行の最後の空欄・空の行の CSV
    expect(parseCsv("a,b\r\n1,\r\n,2\r\n").rows).toEqual([
      ["1", null],
      [null, "2"],
    ]);
    expect(parseCsv("a\r\n").rows).toEqual([]);
    expect(() => parseCsv('a\r\n"open')).toThrow("閉じていません");
  });

  it("書き出す表に、DB のすべての表が入っている（足し忘れを見つける）", () => {
    const all = (Object.values(s) as unknown[])
      .filter((v): v is PgTable => is(v, PgTable))
      .map((t) => getTableConfig(t).name)
      .sort();
    const covered = [...EXPORT_TABLES.map((t) => t.name), ...NOT_EXPORTED_TABLES.map((t) => t.name)].sort();
    expect(covered).toEqual(all);
    // 締めの行は最後に入れる（締めた月の守りに止められないように）
    expect(EXPORT_TABLES[EXPORT_TABLES.length - 1].name).toBe("month_closes");
  });
});

describe("全データの書き出しと読み戻し（PGlite の往復）", () => {
  let db: Db;
  let client: PGlite;
  let tenantId: string;
  let otherTenantId: string;
  let bytes: Uint8Array;
  let files: Record<string, string>;
  let manifest: ExportManifest;
  let target: { db: Db; client: PGlite };

  beforeAll(async () => {
    ({ db, client } = await createTestDb());
    ({ tenantId } = await seedDemo(db));
    ({ tenantId: otherTenantId } = await seedDemo(db));
    const users = await db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    const owner = users.find((u) => u.role === "owner")!;
    const staff = users.find((u) => u.role === "staff")!;
    await db.update(s.users).set({ passwordHash: PASSWORD_HASH }).where(eq(s.users.id, owner.id));
    await db.insert(s.sessions).values({ id: "session-hash-should-not-leave", userId: owner.id, tenantId, expiresAt: new Date("2027-01-01") });
    await db.insert(s.invites).values({ tokenHash: "invite-token-hash-should-not-leave", tenantId, email: "new@demo.example", name: "新しい 人", role: "staff", expiresAt: new Date("2027-01-01") });

    // 名前に式に見える文字・カンマ・引用符を入れる（CSV で壊れないか）
    const [d05] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D05")));
    await db.update(s.drivers).set({ name: '=1+2 "岡田", 拓也', notes: "1 行目\n2 行目" }).where(eq(s.drivers.id, d05.id));

    // 10 月：明細 → 締める → 外す → 直して締め直す（版 2 ができる）
    await generateStatements(db, tenantId, DEMO_MONTH, staff.id);
    const [st] = await db.select().from(s.statements).where(and(eq(s.statements.tenantId, tenantId), eq(s.statements.month, DEMO_MONTH))).limit(1);
    await db.insert(s.statementConfirmations).values({ tenantId, statementId: st.id, totalAtConfirm: st.total, version: st.version, hash: st.hash });
    await db.insert(s.statementMessages).values({ tenantId, statementId: st.id, author: "driver", body: "=HYPERLINK(\"http://example.com\") 駐車場代が、ちがいます" });
    await closeMonth(db, tenantId, DEMO_MONTH, staff.id, { ...noWatch, minutesSpent: 95 });
    await reopenMonth(db, tenantId, DEMO_MONTH, { id: owner.id, role: "owner" }, "スポット便の入れ漏れがあったため");
    const [d01] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
    await db.insert(s.adjustments).values({ tenantId, month: DEMO_MONTH, driverId: d01.id, label: "高速代の立替", amount: 1200, agreedInWriting: true });
    await closeMonth(db, tenantId, DEMO_MONTH, owner.id, noWatch);
    await createTransferBatch(db, tenantId, DEMO_MONTH, { transferDate: "2026-11-25", scope: "all" }, staff.id);
    await db.insert(s.watchAcks).values({ tenantId, month: DEMO_MONTH, code: "deduction_unagreed", subjectId: "x", note: "確かめた", ackedBy: staff.id });
    await db.insert(s.parallelChecks).values({ tenantId, month: DEMO_MONTH, driverId: d01.id, excelTotal: 357555 });
    await db.insert(s.termsRecords).values({ tenantId, driverId: d01.id, version: 1, issuedOn: "2026-04-01", content: { work: "宅配", pay: "個建て" }, deemedClause: true });
    const [notice] = await db.select().from(s.paymentNotices).where(eq(s.paymentNotices.tenantId, tenantId));
    await db.insert(s.reconciliationItems).values({ tenantId, noticeId: notice.id, label: "宅配", kind: "qty", ourAmount: 100, theirAmount: 90, diff: -10, status: "asked", askedAt: new Date("2026-11-20T01:02:03.456789Z") });

    bytes = (await buildTenantExport(db, tenantId, { exportedBy: owner.name, now: NOW })).bytes;
    files = unzip(bytes);
    manifest = JSON.parse(files["manifest.json"]);
    target = await createTestDb();
  });
  afterAll(async () => {
    await client.close();
    await target.client.close();
  });

  it("ZIP：表ごとの CSV（UTF-8 BOM・見出しつき）・manifest.json（版・件数）・明細の全部の版・README", async () => {
    expect(manifest.format).toBe("shimebi-lab-export");
    expect(manifest.schemaVersion).toBe(schemaVersion());
    // 最後のマイグレーションの名前（例：0010_clients_active_batch_index）
    expect(manifest.schemaVersion).toMatch(/^\d{4}_[a-z0-9_]+$/);
    expect(manifest.tenantId).toBe(tenantId);
    expect(manifest.exportedAt).toBe(NOW.toISOString());
    for (const t of EXPORT_TABLES) {
      const text = files[`csv/${t.name}.csv`];
      expect(text, t.name).toBeDefined();
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const count = await countOf(db, t.table, tenantId);
      expect(manifest.tables.find((m) => m.name === t.name)?.rows, t.name).toBe(count);
      expect(parseCsv(text).rows.length, t.name).toBe(count);
    }
    // 見本の数：8 人・稼働 22 行・10 月の明細 8 人（版は 8 ＋ 青木の 2 版目）
    expect(manifest.tables.find((t) => t.name === "drivers")?.rows).toBe(8);
    expect(manifest.tables.find((t) => t.name === "work_entries")?.rows).toBe(22);
    expect(manifest.tables.find((t) => t.name === "statements")?.rows).toBe(8);
    expect(manifest.statementVersions.count).toBe(9);
    const versionFiles = Object.keys(files).filter((f) => f.startsWith("statement_versions/2026-10/"));
    expect(versionFiles).toHaveLength(9);
    const v = JSON.parse(files[versionFiles[0]]);
    expect(v).toMatchObject({ month: DEMO_MONTH });
    expect(typeof v.snapshot).toBe("object");
    // 版のハッシュは、写しの中身から作り直したものと同じ（ドライバーの確認の記録と照らし合わせられる）
    for (const f of versionFiles) {
      const body = JSON.parse(files[f]);
      expect(sha(strToU8(stableStringify(body.snapshot)))).toBe(body.hash);
    }
    expect(files["README.txt"]).toContain("csv/work_entries.csv");
    expect(files["README.txt"]).toContain("引用符の無い空欄は「値なし」");
    // 書き出した日時は日本時間でも書く（2026-11-30T03:00Z → 12:00）
    expect(files["README.txt"]).toContain("書き出した日時：2026-11-30 12:00（日本時間）");
    // 目録のハッシュは、ファイルの中身と同じ
    for (const [name, hash] of Object.entries(manifest.files)) expect(sha(strToU8(files[name])), name).toBe(hash);
  });

  it("入れないもの：ログイン中のしるし・パスワードのハッシュ・招待のリンクの値", () => {
    expect(Object.keys(files).some((f) => f.includes("sessions"))).toBe(false);
    expect(parseCsv(files["csv/users.csv"]).header).not.toContain("password_hash");
    expect(parseCsv(files["csv/invites.csv"]).header).not.toContain("token_hash");
    expect(parseCsv(files["csv/invites.csv"]).rows).toHaveLength(1);
    const all = Object.values(files).join("\n");
    expect(all).not.toContain(PASSWORD_HASH);
    expect(all).not.toContain("session-hash-should-not-leave");
    expect(all).not.toContain("invite-token-hash-should-not-leave");
  });

  it("他社の行は 1 行も入らない", async () => {
    const all = Object.values(files).join("\n");
    expect(all).not.toContain(otherTenantId);
    const otherDrivers = await db.select({ id: s.drivers.id }).from(s.drivers).where(eq(s.drivers.tenantId, otherTenantId));
    for (const d of otherDrivers) expect(all).not.toContain(d.id);
    // 他社を書き出しても、この会社の行は入らない
    const other = unzip((await buildTenantExport(db, otherTenantId, { now: NOW })).bytes);
    expect(Object.values(other).join("\n")).not.toContain(tenantId);
  });

  it("式に見える文字は ' を付けて書き出す（表計算ソフトで動かない）", () => {
    const drivers = files["csv/drivers.csv"];
    expect(drivers).toContain(`"'=1+2 ""岡田"", 拓也"`);
    expect(files["csv/statement_messages.csv"]).toContain("'=HYPERLINK");
  });

  it("空の DB へ読み戻すと、行数・明細の全部の版のハッシュが同じ。締めた月は締めたまま", async () => {
    const preview = await previewTenantImport(target.db, bytes);
    expect(preview).toMatchObject({ tenantId, tenantName: manifest.tenantName, versions: 9, olderSchema: false });
    expect(preview.owners).toEqual([{ name: "デモ 社長", email: "owner@demo.example" }]);

    const summary = await importTenantData(target.db, bytes, { restoredBy: "テスト" });
    expect(summary.rows).toBe(manifest.tables.filter((t) => t.restore).reduce((a, t) => a + t.rows, 0));
    for (const t of EXPORT_TABLES) {
      const expected = manifest.tables.find((m) => m.name === t.name)!.rows;
      // 招待は読み戻さない。操作の記録は「読み戻した」記録が 1 行増える
      const want = t.name === "invites" ? 0 : t.name === "audit_log" ? expected + 1 : expected;
      expect(await countOf(target.db, t.table, tenantId), t.name).toBe(want);
    }
    const before = await db.select().from(s.statementVersions).where(eq(s.statementVersions.tenantId, tenantId));
    const after = await target.db.select().from(s.statementVersions).where(eq(s.statementVersions.tenantId, tenantId));
    const key = (r: { statementId: string; version: number; hash: string; total: number }) => `${r.statementId}:${r.version}:${r.hash}:${r.total}`;
    expect(after.map(key).sort()).toEqual(before.map(key).sort());
    // 明細の中身・振込額も同じ（青木は +1,200円の 2 版目）
    const stBefore = await db.select().from(s.statements).where(eq(s.statements.tenantId, tenantId));
    const stAfter = await target.db.select().from(s.statements).where(eq(s.statements.tenantId, tenantId));
    expect(stAfter.map((r) => `${r.id}:${r.version}:${r.hash}:${r.total}`).sort()).toEqual(stBefore.map((r) => `${r.id}:${r.version}:${r.hash}:${r.total}`).sort());
    expect(stAfter.reduce((a, r) => a + r.total, 0)).toBe(2206094 + 1200);

    // 締めた月は締めたまま（9 月・10 月）。稼働は DB が止める
    expect(await isMonthClosed(target.db, tenantId, DEMO_MONTH)).toBe(true);
    expect(await isMonthClosed(target.db, tenantId, DEMO_PREV_MONTH)).toBe(true);
    const [mc] = await target.db.select().from(s.monthCloses).where(and(eq(s.monthCloses.tenantId, tenantId), eq(s.monthCloses.month, DEMO_MONTH)));
    expect(mc).toMatchObject({ minutesSpent: 95, reopenReason: "スポット便の入れ漏れがあったため" });
    const [d01] = await target.db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D01")));
    const [p] = await target.db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId)).limit(1);
    let msg = "";
    try {
      await target.db.insert(s.workEntries).values({ tenantId, month: DEMO_MONTH, driverId: d01.id, projectId: p.id, qty: 1 });
    } catch (e) {
      msg = pgErrorMessage(e);
    }
    expect(msg).toMatch(/MONTH_CLOSED/);

    // 利用者はパスワード無しで戻る（招待のリンクから決め直す）
    const users = await target.db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    expect(users.every((u) => u.passwordHash === null)).toBe(true);
    // 読み戻した記録が残る
    const [log] = await target.db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "data.import")));
    expect(log.detail).toMatchObject({ restoredBy: "テスト", versions: 9 });
  });

  it("読み戻した先から書き出し直すと、表の CSV は同じ（操作の記録は番号と読み戻しの 1 行を除いて同じ）", async () => {
    const again = unzip((await buildTenantExport(target.db, tenantId, { exportedBy: manifest.exportedBy, now: NOW })).bytes);
    for (const t of EXPORT_TABLES) {
      const file = `csv/${t.name}.csv`;
      if (t.name === "invites") continue;
      if (t.name === "audit_log") {
        const strip = (text: string) => {
          const { header, rows } = parseCsv(text);
          const i = header.indexOf("id");
          return rows.map((r) => r.filter((_, k) => k !== i));
        };
        const a = strip(files[file]);
        const b = strip(again[file]);
        expect(b.slice(0, -1)).toEqual(a);
        continue;
      }
      expect(again[file], file).toBe(files[file]);
    }
    for (const f of Object.keys(files).filter((f) => f.startsWith("statement_versions/"))) expect(again[f], f).toBe(files[f]);
  });

  it("同じ会社がすでにある場所には読み込まない（元の DB にも、読み戻した先にも）", async () => {
    await expect(importTenantData(target.db, bytes)).rejects.toThrow("すでにこの場所にあります");
    await expect(importTenantData(db, bytes)).rejects.toThrow("すでにこの場所にあります");
    await expect(previewTenantImport(db, bytes)).rejects.toThrow("すでにこの場所にあります");
  });

  it("書き換えた ZIP・壊れた ZIP・ZIP でないものは読み込まない", () => {
    // 目録のハッシュと合わない
    const tampered = rezip(bytes, (f) => (f["csv/drivers.csv"] = f["csv/drivers.csv"].replace("青木 翔太", "青木 翔大")), false);
    expect(() => readTenantExport(tampered)).toThrow("書き出したときと違います");
    expect(() => readTenantExport(strToU8("これは ZIP ではありません"))).toThrow("ZIP として読めませんでした");
    expect(() => readTenantExport(zipSync({ "a.txt": strToU8("x") }))).toThrow("manifest.json が入っていません");
    // 新しい版で作られたもの
    const newer = rezip(bytes, (f) => {
      const m = JSON.parse(f["manifest.json"]);
      m.schemaVersion = "9999_future";
      f["manifest.json"] = JSON.stringify(m);
    });
    expect(() => readTenantExport(newer)).toThrow("新しい版");
    // デモ（架空の会社）の書き出しは入れない
    const demo = rezip(bytes, (f) => {
      const lines = f["csv/tenants.csv"].split("\r\n");
      lines[1] = lines[1].replace('"{', '"{""demo"":true,');
      f["csv/tenants.csv"] = lines.join("\r\n");
    });
    expect(() => readTenantExport(demo)).toThrow("デモ（架空の会社）の書き出しは読み込めません");
  });

  it("別の会社の行・ZIP に無いドライバーを指す行があれば読み込まない（目録を付け直した細工でも）", async () => {
    const [otherDriver] = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, otherTenantId)).limit(1);
    const [myDriver] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.code, "D02")));
    const crossRef = rezip(bytes, (f) => (f["csv/work_entries.csv"] = f["csv/work_entries.csv"].split(myDriver.id).join(otherDriver.id)));
    expect(() => readTenantExport(crossRef)).toThrow("ZIP に無い行（drivers）");
    const otherTenant = rezip(bytes, (f) => {
      const lines = f["csv/adjustments.csv"].split("\r\n");
      lines[1] = lines[1].replace(tenantId, otherTenantId);
      f["csv/adjustments.csv"] = lines.join("\r\n");
    });
    expect(() => readTenantExport(otherTenant)).toThrow("別の会社の行");
    // 読み込めなかったときは何も書かない
    const fresh = await createTestDb();
    await expect(importTenantData(fresh.db, crossRef)).rejects.toThrow();
    expect(await countOf(fresh.db, s.tenants, tenantId)).toBe(0);
    await fresh.client.close();
  });
});
