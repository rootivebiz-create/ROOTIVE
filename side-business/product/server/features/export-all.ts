import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import journal from "~/db/migrations/meta/_journal.json";
import type { Db } from "~/db/client";
import { UserError } from "~/server/action";
import { audit } from "~/server/audit";
import { encodeCsv, fromCell, parseCsv, toCell } from "~/server/features/export-all/csv";
import { readmeText } from "~/server/features/export-all/readme";
import { columnsOf, EXPORT_TABLES, NOT_EXPORTED_TABLES, referencesOf, type TableSpec } from "~/server/features/export-all/tables";

/**
 * 全データの書き出し（オーナーだけ）と、別の場所への読み戻し。
 * 約束：「やめるときも全部持ち帰れる」。表ごとの CSV（UTF-8 BOM）＋ manifest.json ＋ 明細の全部の版（JSON）＋ README.txt を 1 つの ZIP に入れる。
 * - 会社で必ず絞る（ほかの会社の行は 1 行も入れない）
 * - ログイン中のしるし・パスワードのハッシュ・招待のリンクの値は入れない
 * - 読み戻しは「新しい会社」として入れる（同じ会社がすでにあれば断る）。id はそのまま使う
 */

export const EXPORT_FORMAT = "shimebi-lab-export";
export const EXPORT_FORMAT_VERSION = 1;

/** 読み込める ZIP の大きさ（圧縮したまま）と、中身の合計の上限 */
export const IMPORT_MAX_BYTES = 50 * 1024 * 1024;
const IMPORT_MAX_UNZIPPED = 1024 * 1024 * 1024;
/** 1 回の INSERT に入れる行の数 */
const CHUNK = 500;

/** データの形の版（最後のマイグレーションの名前） */
export function schemaVersion(): string {
  return journal.entries[journal.entries.length - 1].tag;
}

function knownSchemaVersions(): string[] {
  return journal.entries.map((e) => e.tag);
}

export type ManifestTable = { name: string; label: string; file: string; rows: number; columns: string[]; restore: boolean };

export type ExportManifest = {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  app: string;
  schemaVersion: string;
  tenantId: string;
  tenantName: string;
  exportedAt: string;
  exportedBy: string | null;
  tables: ManifestTable[];
  notExported: { name: string; reason: string }[];
  statementVersions: { count: number; folder: string };
  /** 各ファイルの sha256（manifest.json 自身は除く） */
  files: Record<string, string>;
};

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** db.execute の結果から行を取り出す（PGlite と postgres-js で形が違う） */
function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** 1 つの表を、会社で絞って読む（型をそのまま保つため、行を JSON にして読む） */
async function readTable(db: Db, tenantId: string, spec: TableSpec): Promise<Record<string, unknown>[]> {
  const where = spec.self ? sql`t."id" = ${tenantId}` : sql`t."tenant_id" = ${tenantId}`;
  const order = sql.join(
    spec.order.map((c) => sql`t.${sql.identifier(c)}`),
    sql`, `,
  );
  const res = await db.execute(sql`select to_jsonb(t)::text as j from ${sql.identifier(spec.name)} t where ${where} order by ${order}`);
  return rowsOf(res).map((r) => JSON.parse(String(r.j)) as Record<string, unknown>);
}

// ---------------------------------------------------------------- 書き出す

export type TenantExport = { fileName: string; bytes: Uint8Array; manifest: ExportManifest; sha256: string };

/** ファイル名に使えない文字を外す */
function safeName(v: string): string {
  return v.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "会社";
}

/** 日本時間の YYYYMMDD-HHmm */
function jstStamp(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${j.slice(0, 10).replace(/-/g, "")}-${j.slice(11, 16).replace(":", "")}`;
}

/**
 * 会社のデータをすべて ZIP にする。表を読むあいだにほかの人が書き換えても食い違わないよう、
 * 読むだけのトランザクション（同じ時点の写し）の中で読む。
 */
export async function buildTenantExport(db: Db, tenantId: string, opts: { exportedBy?: string | null; now?: Date } = {}): Promise<TenantExport> {
  const now = opts.now ?? new Date();
  const data = await db.transaction(
    async (tx) => {
      const t = tx as unknown as Db;
      const out = new Map<string, Record<string, unknown>[]>();
      for (const spec of EXPORT_TABLES) out.set(spec.name, await readTable(t, tenantId, spec));
      return out;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const tenantRow = data.get("tenants")?.[0];
  if (!tenantRow) throw new UserError("会社が見つかりません");
  const tenantName = String(tenantRow.name ?? "");

  const files: Record<string, Uint8Array> = {};
  const tables: ManifestTable[] = [];
  const counts: Record<string, number> = {};
  for (const spec of EXPORT_TABLES) {
    const cols = columnsOf(spec);
    const rows = data.get(spec.name) ?? [];
    const text = encodeCsv(
      cols.map((c) => c.name),
      rows.map((r) => cols.map((c) => toCell(r[c.name], c.sqlType))),
    );
    const file = `csv/${spec.name}.csv`;
    files[file] = strToU8("\ufeff" + text);
    tables.push({ name: spec.name, label: spec.label, file, rows: rows.length, columns: cols.map((c) => c.name), restore: spec.restore });
    counts[spec.name] = rows.length;
  }

  // 明細の全部の版（1 版 1 ファイル）
  const versions = data.get("statement_versions") ?? [];
  for (const v of versions) {
    const month = String(v.month ?? "").slice(0, 7) || "unknown";
    const snapshot = (v.snapshot ?? {}) as { driver?: { name?: string; code?: string | null } };
    const body = {
      id: v.id,
      statementId: v.statement_id,
      month: v.month,
      driverId: v.driver_id,
      driverName: snapshot.driver?.name ?? null,
      driverCode: snapshot.driver?.code ?? null,
      version: v.version,
      hash: v.hash,
      total: v.total,
      createdAt: v.created_at,
      createdBy: v.created_by ?? null,
      snapshot: v.snapshot,
    };
    files[`statement_versions/${month}/${v.statement_id}-v${v.version}.json`] = strToU8(JSON.stringify(body, null, 2) + "\n");
  }

  const exportedAt = now.toISOString();
  files["README.txt"] = strToU8("\ufeff" + readmeText({ tenantName, exportedAt, schemaVersion: schemaVersion(), counts, versions: versions.length }));

  const hashes: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) hashes[name] = sha256Hex(bytes);
  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    app: "しめ日ラボ",
    schemaVersion: schemaVersion(),
    tenantId,
    tenantName,
    exportedAt,
    exportedBy: opts.exportedBy ?? null,
    tables,
    notExported: [
      ...NOT_EXPORTED_TABLES,
      { name: "users.password_hash", reason: "パスワードのハッシュ（読み戻したあとは招待のリンクから決め直す）" },
      { name: "invites.token_hash", reason: "招待のリンクの値" },
    ],
    statementVersions: { count: versions.length, folder: "statement_versions/" },
    files: hashes,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2) + "\n");

  const bytes = zipSync(files, { level: 6, mtime: now });
  return { fileName: `しめ日ラボ_全データ_${safeName(tenantName)}_${jstStamp(now)}.zip`, bytes, manifest, sha256: sha256Hex(bytes) };
}

/** 書き出したことを残す（持ち出しの記録） */
export async function auditTenantExport(db: Db, tenantId: string, userId: string | null, ex: TenantExport): Promise<void> {
  await audit(db, {
    tenantId,
    userId,
    action: "data.export",
    entity: "tenant",
    entityId: tenantId,
    detail: {
      fileName: ex.fileName,
      bytes: ex.bytes.length,
      sha256: ex.sha256,
      schemaVersion: ex.manifest.schemaVersion,
      rows: ex.manifest.tables.reduce((a, t) => a + t.rows, 0),
      versions: ex.manifest.statementVersions.count,
      tables: Object.fromEntries(ex.manifest.tables.map((t) => [t.name, t.rows])),
    },
  });
}

// ---------------------------------------------------------------- 読む（中身を確かめる）

export type ParsedTable = { spec: TableSpec; columns: string[]; rows: Record<string, unknown>[] };

export type ParsedExport = {
  manifest: ExportManifest;
  tables: Map<string, ParsedTable>;
  /** statement_versions/ の JSON から読んだ版のハッシュ（"statementId:version" → hash） */
  versionHashes: Map<string, string>;
};

function unzipSafe(bytes: Uint8Array, want: (name: string, size: number) => boolean): Record<string, Uint8Array> {
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        if (!want(f.name, f.originalSize)) return false;
        total += f.originalSize;
        if (total > IMPORT_MAX_UNZIPPED) throw new UserError("ZIP の中身が大きすぎます。しめ日ラボで書き出した ZIP かを確かめてください。");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError("ZIP として読めませんでした。しめ日ラボの「全データの書き出し」で作った ZIP を、そのまま選んでください。");
  }
}

function isManifest(v: unknown): v is ExportManifest {
  const m = v as Partial<ExportManifest> | null;
  return (
    !!m &&
    typeof m === "object" &&
    m.format === EXPORT_FORMAT &&
    typeof m.tenantId === "string" &&
    typeof m.schemaVersion === "string" &&
    Array.isArray(m.tables) &&
    !!m.files &&
    typeof m.files === "object"
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 書き出しの ZIP を読んで、形・ハッシュ・会社・参照を確かめる（DB には触らない）。
 * おかしなところがあれば UserError（日本語）で止める。
 */
export function readTenantExport(bytes: Uint8Array): ParsedExport {
  if (bytes.length === 0) throw new UserError("ファイルが空です");
  if (bytes.length > IMPORT_MAX_BYTES) throw new UserError(`ファイルが大きすぎます（${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)}MB まで）`);
  const head = unzipSafe(bytes, (name) => name === "manifest.json");
  if (!head["manifest.json"]) throw new UserError("manifest.json が入っていません。しめ日ラボの「全データの書き出し」で作った ZIP を選んでください。");
  let manifest: unknown;
  try {
    manifest = JSON.parse(strFromU8(head["manifest.json"]));
  } catch {
    throw new UserError("manifest.json が読めません（壊れているおそれがあります）");
  }
  if (!isManifest(manifest)) throw new UserError("しめ日ラボの書き出しの形ではありません（manifest.json の中身が違います）");
  if (manifest.formatVersion !== EXPORT_FORMAT_VERSION) throw new UserError("この書き出しは、今のしめ日ラボでは読めない形です。しめ日ラボを新しくしてからお試しください。");
  if (!knownSchemaVersions().includes(manifest.schemaVersion)) {
    throw new UserError(`この書き出しは、今より新しい版のしめ日ラボで作られています（${manifest.schemaVersion}）。読み込む側のしめ日ラボを新しくしてからお試しください。`);
  }
  if (!UUID_RE.test(manifest.tenantId)) throw new UserError("manifest.json の会社の id が正しくありません");

  // ファイルが途中で壊れていないか・書き換えられていないか
  const wanted = new Set(Object.keys(manifest.files));
  const files = unzipSafe(bytes, (name) => wanted.has(name));
  for (const [name, hash] of Object.entries(manifest.files)) {
    const f = files[name];
    if (!f) throw new UserError(`ZIP に ${name} が入っていません（書き出しの途中で欠けたおそれがあります）`);
    if (sha256Hex(f) !== hash) throw new UserError(`${name} の中身が、書き出したときと違います（壊れているか、書き換えられています）。書き出したままの ZIP を使ってください。`);
  }

  const tables = new Map<string, ParsedTable>();
  for (const spec of EXPORT_TABLES) {
    if (!spec.restore) continue;
    const mt = manifest.tables.find((t) => t.name === spec.name);
    if (!mt) {
      // 古い版の書き出しで、まだ無かった表は空として扱う
      tables.set(spec.name, { spec, columns: [], rows: [] });
      continue;
    }
    const f = files[mt.file];
    if (!f) throw new UserError(`ZIP に ${mt.file} が入っていません`);
    let parsed: ReturnType<typeof parseCsv>;
    try {
      parsed = parseCsv(strFromU8(f));
    } catch (error) {
      throw new UserError(`${mt.file} が CSV として読めません（${error instanceof Error ? error.message : "形が正しくありません"}）`);
    }
    const known = new Map(columnsOf(spec).map((c) => [c.name, c.sqlType]));
    const unknown = parsed.header.filter((h) => !known.has(h));
    if (unknown.length) throw new UserError(`${mt.file} に、今のしめ日ラボに無い列があります（${unknown.join("、")}）。読み込む側を新しくしてからお試しください。`);
    if (new Set(parsed.header).size !== parsed.header.length) throw new UserError(`${mt.file} の見出しに、同じ列が 2 回あります`);
    const rows: Record<string, unknown>[] = [];
    parsed.rows.forEach((cells, i) => {
      if (cells.length !== parsed.header.length) throw new UserError(`${mt.file} の ${i + 2} 行目の列の数が、見出しと合いません`);
      const row: Record<string, unknown> = {};
      parsed.header.forEach((h, k) => {
        try {
          row[h] = fromCell(cells[k], known.get(h)!);
        } catch {
          throw new UserError(`${mt.file} の ${i + 2} 行目の ${h} が読めません`);
        }
      });
      rows.push(row);
    });
    if (rows.length !== mt.rows) throw new UserError(`${mt.file} の行の数（${rows.length}）が、目録（${mt.rows}）と合いません`);
    tables.set(spec.name, { spec, columns: parsed.header, rows });
  }

  // 会社：会社の表は 1 行で、ほかの表の行もすべて同じ会社のもの
  const tenantRows = tables.get("tenants")?.rows ?? [];
  if (tenantRows.length !== 1 || tenantRows[0].id !== manifest.tenantId) throw new UserError("会社の行（csv/tenants.csv）が目録と合いません");
  // デモ（架空の会社・24 時間で消える）の書き出しは、本番の会社として入れない
  if ((tenantRows[0].settings as { demo?: unknown } | null)?.demo === true) {
    throw new UserError("デモ（架空の会社）の書き出しは読み込めません。お使いの会社の書き出しを選んでください。");
  }
  for (const [name, t] of tables) {
    if (t.spec.self) continue;
    const bad = t.rows.findIndex((r) => r.tenant_id !== manifest.tenantId);
    if (bad >= 0) throw new UserError(`csv/${name}.csv の ${bad + 2} 行目が、別の会社の行です。読み込めません。`);
  }

  // 参照が ZIP の中で閉じているか（ほかの会社のドライバーなどを指していないか）
  for (const [name, t] of tables) {
    for (const ref of referencesOf(t.spec)) {
      if (ref.table === "tenants") continue;
      const target = tables.get(ref.table);
      const ids = new Set((target?.rows ?? []).map((r) => r[ref.foreignColumn]));
      const bad = t.rows.findIndex((r) => r[ref.column] !== null && r[ref.column] !== undefined && !ids.has(r[ref.column]));
      if (bad >= 0) {
        throw new UserError(`csv/${name}.csv の ${bad + 2} 行目の ${ref.column} が、ZIP に無い行（${ref.table}）を指しています。読み込めません。`);
      }
    }
  }

  // 明細の版：CSV と JSON のハッシュが同じか
  const versionHashes = new Map<string, string>();
  for (const [name, f] of Object.entries(files)) {
    if (!name.startsWith("statement_versions/") || !name.endsWith(".json")) continue;
    try {
      const v = JSON.parse(strFromU8(f)) as { statementId?: unknown; version?: unknown; hash?: unknown };
      versionHashes.set(`${String(v.statementId)}:${String(v.version)}`, String(v.hash));
    } catch {
      throw new UserError(`${name} が読めません（壊れているおそれがあります）`);
    }
  }
  const versionRows = tables.get("statement_versions")?.rows ?? [];
  if (versionHashes.size !== versionRows.length) throw new UserError("明細の版のファイルの数が、csv/statement_versions.csv と合いません");
  for (const r of versionRows) {
    if (versionHashes.get(`${String(r.statement_id)}:${String(r.version)}`) !== r.hash) {
      throw new UserError("明細の版のハッシュが、csv/statement_versions.csv と statement_versions/ で食い違っています。読み込めません。");
    }
  }
  return { manifest, tables, versionHashes };
}

// ---------------------------------------------------------------- 読み戻す

export type ImportSummary = {
  tenantId: string;
  tenantName: string;
  exportedAt: string;
  schemaVersion: string;
  /** 今のしめ日ラボより前の版で書き出したもの（足りない列は既定の値で入る） */
  olderSchema: boolean;
  tables: { name: string; label: string; rows: number }[];
  rows: number;
  versions: number;
  /** 読み戻したあとに招待のリンクを作るオーナー（止めていない人） */
  owners: { name: string; email: string }[];
};

function summarize(p: ParsedExport): ImportSummary {
  const tables = [...p.tables.values()].map((t) => ({ name: t.spec.name, label: t.spec.label, rows: t.rows.length }));
  const users = p.tables.get("users")?.rows ?? [];
  return {
    tenantId: p.manifest.tenantId,
    tenantName: String(p.tables.get("tenants")?.rows[0]?.name ?? p.manifest.tenantName),
    exportedAt: p.manifest.exportedAt,
    schemaVersion: p.manifest.schemaVersion,
    olderSchema: p.manifest.schemaVersion !== schemaVersion(),
    tables,
    rows: tables.reduce((a, t) => a + t.rows, 0),
    versions: p.versionHashes.size,
    owners: users.filter((u) => u.role === "owner" && !u.disabled_at).map((u) => ({ name: String(u.name ?? ""), email: String(u.email ?? "") })),
  };
}

async function tenantExists(db: Db, tenantId: string): Promise<boolean> {
  const res = await db.execute(sql`select 1 as x from "tenants" where "id" = ${tenantId} limit 1`);
  return rowsOf(res).length > 0;
}

/**
 * 画面からの読み戻しは、移した先の新しい場所（会社が、読み込む人の会社 1 つだけのところ）でだけ使う。
 * 何社も入っている場所（まとめて提供しているところ）で、お客様が会社を増やせないようにする。
 * 運営者がまとめて移すときは、importTenantData を直接呼ぶ。
 */
export async function restoreHostProblem(db: Db, hostTenantId: string): Promise<string | null> {
  const [row] = rowsOf(await db.execute(sql`select count(*)::int as n from "tenants" where "id" <> ${hostTenantId}`));
  return Number(row?.n ?? 0) > 0
    ? "この場所には、すでにほかの会社のデータがあります。読み戻しは、移した先の新しい場所（最初の設定で会社を 1 つだけ作ったところ）で行ってください。前に読み込んだ会社があるときは、そのとき作った招待のリンクから入れます。"
    : null;
}

export async function assertRestoreHost(db: Db, hostTenantId: string): Promise<void> {
  const problem = await restoreHostProblem(db, hostTenantId);
  if (problem) throw new UserError(problem);
}

/** 読み込む前の確かめ（DB には書かない）。読み込めないときは UserError */
export async function previewTenantImport(db: Db, bytes: Uint8Array): Promise<ImportSummary> {
  const parsed = readTenantExport(bytes);
  if (await tenantExists(db, parsed.manifest.tenantId)) {
    throw new UserError("この会社のデータは、すでにこの場所にあります（同じ会社を二重に入れないため、読み込みません）。");
  }
  return summarize(parsed);
}

/**
 * 書き出しの ZIP を、新しい会社として読み戻す（別の場所へ移すとき）。
 * - id はそのまま（同じ会社がすでにあれば断る）。操作の記録の番号だけは振り直す（並びは同じ）
 * - 締めた月の守りに止められないよう、明細などを先に入れ、締めの行（month_closes）は最後に入れる
 * - 入れたあと、表ごとの行数と、明細の全部の版のハッシュが ZIP と同じかを確かめる（違えば全部取り消す）
 */
export async function importTenantData(db: Db, bytes: Uint8Array, opts: { restoredBy?: string | null } = {}): Promise<ImportSummary> {
  const parsed = readTenantExport(bytes);
  const summary = summarize(parsed);
  const tenantId = parsed.manifest.tenantId;
  try {
    await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      if (await tenantExists(t, tenantId)) {
        throw new UserError("この会社のデータは、すでにこの場所にあります（同じ会社を二重に入れないため、読み込みません）。");
      }
      for (const spec of EXPORT_TABLES) {
        const table = parsed.tables.get(spec.name);
        if (!spec.restore || !table || table.rows.length === 0) continue;
        const cols = table.columns.filter((c) => !(spec.renumber && c === "id"));
        const ident = sql.identifier(spec.name);
        const colList = sql.join(
          cols.map((c) => sql.identifier(c)),
          sql`, `,
        );
        const selList = sql.join(
          cols.map((c) => sql`r.${sql.identifier(c)}`),
          sql`, `,
        );
        for (let i = 0; i < table.rows.length; i += CHUNK) {
          const chunk = table.rows.slice(i, i + CHUNK).map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
          await t.execute(
            sql`insert into ${ident} (${colList}) select ${selList} from json_populate_recordset(null::${ident}, ${JSON.stringify(chunk)}::json) with ordinality as r order by r.ordinality`,
          );
        }
      }

      // 入れたものが ZIP と同じか（行数・明細の版のハッシュ）
      for (const spec of EXPORT_TABLES) {
        if (!spec.restore) continue;
        const expected = parsed.tables.get(spec.name)?.rows.length ?? 0;
        const where = spec.self ? sql`"id" = ${tenantId}` : sql`"tenant_id" = ${tenantId}`;
        const [row] = rowsOf(await t.execute(sql`select count(*)::int as n from ${sql.identifier(spec.name)} where ${where}`));
        if (Number(row?.n) !== expected) throw new Error(`count mismatch: ${spec.name}`);
      }
      const saved = rowsOf(await t.execute(sql`select "statement_id"::text as sid, "version", "hash" from "statement_versions" where "tenant_id" = ${tenantId}`));
      for (const v of saved) {
        if (parsed.versionHashes.get(`${String(v.sid)}:${String(v.version)}`) !== v.hash) throw new Error("version hash mismatch");
      }

      await audit(t, {
        tenantId,
        userId: null,
        action: "data.import",
        entity: "tenant",
        entityId: tenantId,
        detail: {
          restoredBy: opts.restoredBy ?? null,
          tenantName: summary.tenantName,
          exportedAt: summary.exportedAt,
          schemaVersion: summary.schemaVersion,
          rows: summary.rows,
          versions: summary.versions,
        },
      });
    });
  } catch (error) {
    if (error instanceof UserError) throw error;
    const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") throw new UserError("同じ id のデータがすでにこの場所にあります。読み込みを取り消しました（何も書き込んでいません）。");
    console.error("import failed", error instanceof Error ? error.message : error);
    throw new UserError("読み込めませんでした。何も書き込んでいません。書き出したままの ZIP かを確かめて、もう一度お試しください。");
  }
  return summary;
}

// ---------------------------------------------------------------- 画面に出すまとめ

export type DataOverview = {
  drivers: number;
  /** 稼働か明細がある月の数と、いちばん古い月・新しい月 */
  months: number;
  firstMonth: string | null;
  lastMonth: string | null;
  statementVersions: number;
  auditRows: number;
  /** 前に書き出した記録（新しいもの） */
  lastExport: { at: Date; byName: string | null; fileName: string | null } | null;
};

/** 全データの画面の上に出す件数（会社で絞る） */
export async function loadDataOverview(db: Db, tenantId: string): Promise<DataOverview> {
  const one = async (q: ReturnType<typeof sql>) => rowsOf(await db.execute(q))[0] ?? {};
  const [d, m, v, a, last] = await Promise.all([
    one(sql`select count(*)::int as n from "drivers" where "tenant_id" = ${tenantId}`),
    one(sql`select count(*)::int as n, min(month)::text as first, max(month)::text as last from (
      select "month" from "work_entries" where "tenant_id" = ${tenantId}
      union select "month" from "statement_versions" where "tenant_id" = ${tenantId}
    ) x`),
    one(sql`select count(*)::int as n from "statement_versions" where "tenant_id" = ${tenantId}`),
    one(sql`select count(*)::int as n from "audit_log" where "tenant_id" = ${tenantId}`),
    one(sql`select (extract(epoch from a."created_at") * 1000)::float8 as at, u."name" as by, a."detail"->>'fileName' as file
      from "audit_log" a left join "users" u on u."id" = a."user_id" and u."tenant_id" = a."tenant_id"
      where a."tenant_id" = ${tenantId} and a."action" = 'data.export'
      order by a."id" desc limit 1`),
  ]);
  return {
    drivers: Number(d.n ?? 0),
    months: Number(m.n ?? 0),
    firstMonth: typeof m.first === "string" ? m.first : null,
    lastMonth: typeof m.last === "string" ? m.last : null,
    statementVersions: Number(v.n ?? 0),
    auditRows: Number(a.n ?? 0),
    lastExport: last.at !== undefined && last.at !== null ? { at: new Date(Number(last.at)), byName: typeof last.by === "string" ? last.by : null, fileName: typeof last.file === "string" ? last.file : null } : null,
  };
}
