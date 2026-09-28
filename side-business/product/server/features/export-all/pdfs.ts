import "server-only";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { csvText } from "~/server/download";
import type { PdfSource } from "~/server/features/statements";
import { jpDateTime, maskAccount, toDriverView } from "~/server/features/statements/view";
import { termsReceivedText, toTermsDocument } from "~/server/features/terms";
import { renderStatementsPdf } from "~/server/pdf/statement-pdf";
import { renderTermsPdf, type TermsPdfSource } from "~/server/pdf/terms-pdf";
import { getTenant } from "~/server/repo";
import { readSnapshot } from "~/server/statements-core";

/**
 * 読むための PDF の書き出し（オーナーだけ）：支払明細と取引条件の明示書の「全部の版」を、年ごとに 1 つの ZIP にする。
 * 全データの書き出し（CSV・JSON）は機械で読み戻すための形なので、しめ日ラボをやめたあとに人が読める控えとして別に出す。
 * - 明細：その年の月ごとに 1 つの PDF（ドライバーの番号 → 版の順。1 版ずつ改ページ）。中身は保存した版の写し（statement_versions）だけから作る
 * - 取引条件：その年に明示した版を 1 つの PDF（ドライバーの番号 → 版の順）
 * - 目録.csv：どのファイルに・だれの・どの版が入っているか（版のハッシュつき）と README.txt
 * 1 年ぶんに分けるのは、1 回の書き出しの時間を抑えるため（全部の年を持ち帰るときは年ごとに押す）。
 */

export type PdfArchiveFile = { name: string; kind: "statements" | "terms"; month: string | null; versions: number };

export type PdfArchive = {
  fileName: string;
  bytes: Uint8Array;
  year: number;
  files: PdfArchiveFile[];
  statementVersions: number;
  termsVersions: number;
};

/** PDF にできる版がある年（新しい順）。明細はその月の年、取引条件は明示した日の年 */
export async function pdfArchiveYears(db: Db, tenantId: string): Promise<number[]> {
  const [months, issued] = await Promise.all([
    db
      .selectDistinct({ y: sql<number>`extract(year from ${s.statementVersions.month})::int` })
      .from(s.statementVersions)
      .where(eq(s.statementVersions.tenantId, tenantId)),
    db
      .selectDistinct({ y: sql<number>`extract(year from ${s.termsRecords.issuedOn})::int` })
      .from(s.termsRecords)
      .where(eq(s.termsRecords.tenantId, tenantId)),
  ]);
  return [...new Set([...months, ...issued].map((r) => Number(r.y)).filter((y) => Number.isInteger(y)))].sort((a, b) => b - a);
}

function byDriver(a: { code: string | null; name: string; version: number }, b: { code: string | null; name: string; version: number }): number {
  return (a.code ?? "").localeCompare(b.code ?? "", "ja") || a.name.localeCompare(b.name, "ja") || a.version - b.version;
}

/** 版ごとの「ドライバーの確認」の文（その版を確認した記録があるか） */
function versionConfirmationText(version: number, confs: { version: number; createdAt: Date }[]): string {
  const mine = confs.filter((c) => c.version === version).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return mine.length ? `ドライバーの確認：${jpDateTime(mine[0].createdAt)}（版 ${version}）` : `ドライバーの確認：この版（版 ${version}）の記録はありません`;
}

/** 日本時間の YYYYMMDD-HHmm */
function jstStamp(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${j.slice(0, 10).replace(/-/g, "")}-${j.slice(11, 16).replace(":", "")}`;
}

function safeName(v: string): string {
  return v.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "会社";
}

/** 1 年ぶんの PDF の ZIP を作る */
export async function buildPdfArchive(db: Db, tenantId: string, year: number, opts: { now?: Date } = {}): Promise<PdfArchive> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new UserError("年の指定が正しくありません");
  const now = opts.now ?? new Date();
  const tenant = await getTenant(db, tenantId);
  const [versions, terms, drivers] = await Promise.all([
    db
      .select()
      .from(s.statementVersions)
      .where(and(eq(s.statementVersions.tenantId, tenantId), gte(s.statementVersions.month, `${year}-01-01`), lte(s.statementVersions.month, `${year}-12-01`)))
      .orderBy(asc(s.statementVersions.month), asc(s.statementVersions.version)),
    db
      .select()
      .from(s.termsRecords)
      .where(and(eq(s.termsRecords.tenantId, tenantId), gte(s.termsRecords.issuedOn, `${year}-01-01`), lte(s.termsRecords.issuedOn, `${year}-12-31`)))
      .orderBy(asc(s.termsRecords.issuedOn), asc(s.termsRecords.version)),
    db.select().from(s.drivers).where(eq(s.drivers.tenantId, tenantId)),
  ]);
  if (versions.length === 0 && terms.length === 0) throw new UserError(`${year}年の明細・取引条件の記録はありません`);
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const statementIds = [...new Set(versions.map((v) => v.statementId))];
  const confirmations = statementIds.length
    ? await db
        .select({ statementId: s.statementConfirmations.statementId, version: s.statementConfirmations.version, createdAt: s.statementConfirmations.createdAt })
        .from(s.statementConfirmations)
        .where(and(eq(s.statementConfirmations.tenantId, tenantId), inArray(s.statementConfirmations.statementId, statementIds)))
    : [];

  const files: Record<string, Uint8Array> = {};
  const list: PdfArchiveFile[] = [];
  const index: (string | number)[][] = [["ファイル", "種類", "月・明示した日", "ドライバーの番号", "ドライバー", "版", "振込額", "目印（ハッシュ）"]];

  // 明細：月ごとに 1 つの PDF
  const months = [...new Set(versions.map((v) => v.month))].sort();
  for (const month of months) {
    const rows = versions
      .filter((v) => v.month === month)
      .map((v) => {
        const view = toDriverView(readSnapshot(v), { version: v.version, hash: v.hash });
        return { v, view, code: view.driver.code, name: view.driver.name, version: v.version };
      })
      .sort(byDriver);
    const sources: PdfSource[] = rows.map(({ v, view }) => {
      const d = driverById.get(v.driverId);
      return {
        view,
        confirmationText: versionConfirmationText(
          v.version,
          confirmations.filter((c) => c.statementId === v.statementId),
        ),
        account: d ? maskAccount(d) : null,
      };
    });
    const name = `支払明細/${month.slice(0, 7)}_支払明細_全部の版.pdf`;
    files[name] = await renderStatementsPdf(sources, now);
    list.push({ name, kind: "statements", month, versions: rows.length });
    for (const r of rows) index.push([name, "支払明細", month.slice(0, 7), r.code ?? "", r.name, r.version, r.v.total, r.v.hash]);
  }

  // 取引条件：その年に明示した版を 1 つの PDF に
  if (terms.length) {
    const company = { name: tenant.name, registrationNo: tenant.registrationNo };
    const rows = terms
      .map((rec) => {
        const d = driverById.get(rec.driverId);
        const doc = toTermsDocument(rec, company, { name: d?.name ?? "（不明）", code: d?.code ?? null });
        return { rec, doc, code: doc.driver.code, name: doc.driver.name, version: rec.version };
      })
      .sort(byDriver);
    const sources: TermsPdfSource[] = rows.map(({ rec, doc }) => ({ doc, receivedText: termsReceivedText(rec) }));
    const name = `取引条件/${year}年_取引条件の明示書_全部の版.pdf`;
    files[name] = await renderTermsPdf(sources, now);
    list.push({ name, kind: "terms", month: null, versions: rows.length });
    for (const r of rows) index.push([name, "取引条件の明示書", r.rec.issuedOn, r.code ?? "", r.name, r.version, "", r.doc.hash]);
  }

  files["目録.csv"] = strToU8("﻿" + csvText(index));
  files["README.txt"] = strToU8("﻿" + pdfReadmeText({ tenantName: tenant.name, year, exportedAt: now, files: list }));
  const bytes = zipSync(files, { level: 6, mtime: now });
  return {
    fileName: `しめ日ラボ_PDF_${year}年_${safeName(tenant.name)}_${jstStamp(now)}.zip`,
    bytes,
    year,
    files: list,
    statementVersions: versions.length,
    termsVersions: terms.length,
  };
}

/** PDF の ZIP に入れる「はじめにお読みください」 */
export function pdfReadmeText(opts: { tenantName: string; year: number; exportedAt: Date; files: PdfArchiveFile[] }): string {
  const lines = [
    `しめ日ラボ　読むための PDF（${opts.year}年）`,
    "==============================",
    "",
    `会社：${opts.tenantName}`,
    `書き出した日時：${jpDateTime(opts.exportedAt)}（日本時間）`,
    "",
    "この ZIP には、しめ日ラボに残っている支払明細と取引条件の明示書の「全部の版」を、人が読める PDF にして入れています。",
    "しめ日ラボをやめたあとも、PDF を開けるソフトで読めます。",
    "",
    "■ 入っているもの",
    "",
    ...opts.files.map((f) => `${f.name}　${f.kind === "statements" ? `${f.month!.slice(0, 7)}分の支払明細` : `${opts.year}年に明示した取引条件の明示書`}（${f.versions}版）`),
    "目録.csv　どのファイルに、だれの・どの版が入っているか（版の目印のハッシュつき）",
    "",
    "■ 読み方",
    "",
    "・支払明細は、月ごとに 1 つの PDF です。ドライバーの番号の順に、同じ人の版は古い順に並べ、1 版ずつページを分けています。",
    "・中身は、その版を作ったときに保存した写しから作っています（あとで設定を変えても、写しは変わりません）。",
    "・「ドライバーの確認」には、その版を確認した記録があれば日時を書いています。",
    "・振込先の口座は、書き出したときに登録してある口座（下 3 桁だけ）です。",
    "・版の目印（ハッシュ）は、全データの書き出しの statement_versions のファイルと照らし合わせられます。",
    "・取引条件の明示書は、その年に明示した版を 1 つの PDF にまとめています。受け取りの記録があれば日時を書いています。",
    "",
    "■ 保存について",
    "",
    "この ZIP には、ドライバーの氏名・報酬などの大切な情報が入っています。保管と受け渡しに気をつけてください。",
    "帳簿や書類をどのくらいの期間、どう保存するかは、会社で決めた決まりに沿ってください。判断に迷うときは、税理士にご相談ください。",
    "",
  ];
  return lines.join("\r\n");
}

/** 書き出したことを残す（持ち出しの記録） */
export async function auditPdfArchive(db: Db, tenantId: string, userId: string | null, a: PdfArchive): Promise<void> {
  await audit(db, {
    tenantId,
    userId,
    action: "data.export_pdfs",
    entity: "tenant",
    entityId: tenantId,
    detail: { fileName: a.fileName, year: a.year, bytes: a.bytes.length, files: a.files.length, statementVersions: a.statementVersions, termsVersions: a.termsVersions },
  });
}
