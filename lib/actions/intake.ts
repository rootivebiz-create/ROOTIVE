"use server";

import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/session";
import { ActionError, ensureNoError, runAction, unwrap, type ActionResult } from "@/lib/actions/result";
import { AI_DISABLED_MESSAGE, isAiInsightsEnabled } from "@/lib/ai/config";
import { loadExpenseCategories, loadMasters } from "@/lib/db/queries";
import { dateToMonth, monthToDate } from "@/lib/month";
import { fd, monthSchema } from "@/lib/schemas/common";
import {
  deleteImportProfileSchema,
  deleteReceiptSchema,
  MAX_IMPORT_ROWS,
  MAX_RECEIPT_BYTES,
  MAX_SHEET_BYTES,
  receiptExpenseSchema,
  runImportSchema,
  saveImportProfileSchema,
  type ReceiptExpenseInput,
  type ReceiptOcr,
  type RunImportInput,
  type SaveImportProfileInput,
} from "@/lib/schemas/intake";
import {
  detectReceiptImageType,
  isAiReadableMediaType,
  isOwnedReceiptPath,
  normalizeName,
  taxExcludedAmount,
  type ReceiptMediaType,
} from "@/lib/intake/helpers";
import { readReceipt } from "@/lib/intake/receipt";
import { removeReceipt, uploadReceipt } from "@/lib/intake/storage";
import { detectHeader, parseSheet, SheetParseError } from "@/lib/intake/sheet";
import {
  applyMapping,
  columnIndex,
  EMPTY_MAPPING,
  guessMapping,
  matchNames,
  missingMappingFields,
  monthsOf,
  normalizeMapping,
  normalizeMatchMap,
  restrictToMonth,
  type MappingField,
  type MatchedRow,
  type SheetMapping,
} from "@/lib/intake/mapping";
import type { ImportProfile } from "@/lib/db/types";

/** 経費（レシート）の変更が影響する画面 */
function revalidateExpenses(): void {
  for (const p of ["/expenses", "/dashboard", "/reports", "/cashflow"]) revalidatePath(p);
}

/** 稼働の取り込みが影響する画面 */
function revalidateIntake(): void {
  for (const p of ["/intake", "/entries", "/daily", "/dashboard", "/reports"]) revalidatePath(p);
}

// ===========================================================================
// A. レシートを撮るだけで経費登録
// ===========================================================================

/** 読み取りの結果（画像は保存済み。この時点では経費を作らない） */
export interface ReadReceiptResult {
  /** Storage（receipts）のパス */
  receiptPath: string;
  mediaType: ReceiptMediaType;
  /** AI が読み取れたか */
  read: boolean;
  /** 読み取れなかった理由・注意（日本語。無ければ ""） */
  note: string;
  /** 読み取った内容（確認フォームの初期値。expenses.ocr にもこの形で保存する） */
  draft: ReceiptOcr;
  /** 会社の消費税率（税込 → 税抜の計算に使う） */
  taxRate: number;
}

function emptyOcr(): ReceiptOcr {
  return {
    amount: null,
    incurred_on: null,
    vendor: "",
    category_id: null,
    label: "",
    tax_included: null,
    confidence: 0,
    model: "",
    read_at: "",
  };
}

/**
 * レシート画像のアップロードと読み取り（admin+）。
 * FormData の "file" に画像（JPEG / PNG / WebP / HEIC、5MB まで）。
 * 先に Storage へ保存してから AI に渡すので、読み取りに失敗しても画像は残る。この時点では経費を作らない。
 */
export async function readReceiptAction(formData: FormData): Promise<ActionResult<ReadReceiptResult>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("レシートの画像を選んでください。");
    if (file.size > MAX_RECEIPT_BYTES) {
      throw new ActionError(`画像は ${MAX_RECEIPT_BYTES / 1024 / 1024}MB 以下にしてください（${(file.size / 1024 / 1024).toFixed(1)}MB）。`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mediaType = detectReceiptImageType(bytes);
    if (!mediaType) throw new ActionError("レシートの画像は JPEG・PNG・WebP・HEIC のいずれかを選んでください。");

    // 画像は先に保存する（読み取りに失敗しても残す）
    const receiptPath = await uploadReceipt(company.id, bytes, mediaType);
    const taxRate = Number(company.tax_rate ?? 0);
    const base: ReadReceiptResult = { receiptPath, mediaType, read: false, note: "", draft: emptyOcr(), taxRate };

    if (!isAiInsightsEnabled()) return { ...base, note: AI_DISABLED_MESSAGE };
    if (!isAiReadableMediaType(mediaType)) {
      return { ...base, note: "HEIC の画像は自動で読み取れません。内容を手で入力してください（画像は保存されています）。" };
    }

    const categories = await loadExpenseCategories(supabase, company.id, { activeOnly: true });
    try {
      const draft = await readReceipt(Buffer.from(bytes).toString("base64"), mediaType, categories);
      return {
        ...base,
        read: true,
        draft: {
          amount: draft.amount,
          incurred_on: draft.incurred_on,
          vendor: draft.vendor,
          category_id: draft.category_id,
          label: draft.label,
          tax_included: draft.tax_included,
          confidence: draft.confidence,
          model: draft.model,
          read_at: new Date().toISOString(),
        },
      };
    } catch (e) {
      // 読み取りに失敗しても画像は残し、手入力で登録できるようにする
      const note = e instanceof ActionError ? e.message : "レシートを読み取れませんでした。内容を手で入力してください。";
      return { ...base, note };
    }
  });
}

/**
 * 確認した内容で経費を 1 件作る（admin+）。
 * 金額が税込のときは会社の税率で税抜へ直して保存する（expenses.amount はすべて税抜）。
 * 締め済みの月は DB のトリガーが拒否する（MONTH_CLOSED → 日本語のメッセージ）。
 */
export async function createExpenseFromReceiptAction(input: ReceiptExpenseInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireAdminAction();
    const v = receiptExpenseSchema.parse(input);

    const category = unwrap<{ id: string }>(
      await supabase.from("expense_categories").select("id").eq("company_id", company.id).eq("id", v.category_id).maybeSingle(),
      "経費カテゴリが見つかりません。画面を再読み込みしてください。",
    );
    if (v.receipt_path && !isOwnedReceiptPath(company.id, v.receipt_path)) throw new ActionError("レシート画像のパスが不正です。");

    const amount = v.tax_included ? taxExcludedAmount(v.amount, Number(company.tax_rate ?? 0)) : v.amount;
    const saved = unwrap<{ id: string }>(
      await supabase
        .from("expenses")
        .insert({
          company_id: company.id,
          month: monthToDate(v.month),
          category_id: category.id,
          label: v.label,
          amount,
          tax_mode: v.tax_mode,
          incurred_on: v.incurred_on,
          vendor: v.vendor,
          memo: v.memo,
          receipt_path: v.receipt_path ?? "",
          ocr: v.ocr ?? {},
          created_by: user.id,
        })
        .select("id")
        .single(),
    );

    revalidateExpenses();
    return { id: saved.id };
  }, "レシートから経費を登録しました。");
}

/** レシート画像の削除（admin+）。経費に添付済みの画像は消せない */
export async function deleteReceiptAction(path: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = deleteReceiptSchema.parse({ path });
    if (!isOwnedReceiptPath(company.id, v.path)) throw new ActionError("レシート画像のパスが不正です。");

    const used = await supabase.from("expenses").select("id").eq("company_id", company.id).eq("receipt_path", v.path).limit(1);
    ensureNoError(used);
    if ((used.data ?? []).length > 0) {
      throw new ActionError("この画像は経費に添付されています。先に経費を削除してください。");
    }
    await removeReceipt(v.path);
    return null;
  }, "レシート画像を削除しました。");
}

// ===========================================================================
// B. 元請の実績ファイルの取り込み
// ===========================================================================

/** プレビュー（この時点では書き込まない） */
export interface ImportPreview {
  profileId: string;
  fileName: string;
  sheetName: string;
  encoding: string;
  headerRow: number;
  headers: string[];
  mapping: SheetMapping;
  /** 対応が付いていない必須の列 */
  missing: MappingField[];
  rows: MatchedRow[];
  unmatched: { drivers: string[]; items: string[] };
  counts: { total: number; ok: number; ng: number };
  /** ファイルに含まれる稼動月 */
  months: string[];
  /** 行数が上限を超えて打ち切ったか */
  truncated: boolean;
  /** 画面に出す注意（日本語） */
  notes: string[];
}

/** 画面から渡された列の対応（JSON 文字列）。指定が無ければ null */
function parseMappingParam(raw: string): SheetMapping | null {
  if (!raw.trim()) return null;
  try {
    const mapping = normalizeMapping(JSON.parse(raw));
    return Object.values(mapping).some((v) => v !== "") ? mapping : null;
  } catch {
    return null;
  }
}

/** 取り込み定義の mapping が、そのヘッダー行に何列あてはまるか */
function mappingHits(mapping: SheetMapping, headers: string[]): number {
  return (Object.values(mapping) as string[]).filter((name) => name !== "" && columnIndex(headers, name) >= 0).length;
}

/**
 * 元請ファイルの読み込みとプレビュー（admin+）。
 * FormData: "file"（CSV / TSV、5MB まで）、"profile_id"（任意）、"m"（稼動月）。
 * 解析 → 列の対応の推測 → 名前の突き合わせ まで行い、DB には書き込まない。
 */
export async function previewImportAction(formData: FormData): Promise<ActionResult<ImportPreview>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const month = monthSchema.parse(fd(formData, "m"));
    const profileId = fd(formData, "profile_id");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("実績ファイルを選んでください。");
    if (file.size > MAX_SHEET_BYTES) {
      throw new ActionError(`ファイルは ${MAX_SHEET_BYTES / 1024 / 1024}MB 以下にしてください（${(file.size / 1024 / 1024).toFixed(1)}MB）。`);
    }

    let parsed;
    try {
      parsed = parseSheet(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (e) {
      throw e instanceof SheetParseError ? new ActionError(e.message) : e;
    }
    const sheet = parsed.sheets[0];
    if (!sheet || sheet.rows.length === 0) throw new ActionError("ファイルに中身がありません。内容を確認してください。");

    // 取り込み定義（覚えている列・名前の対応）
    let profile: ImportProfile | null = null;
    if (profileId) {
      const res = await supabase.from("import_profiles").select("*").eq("company_id", company.id).eq("id", profileId).maybeSingle();
      ensureNoError(res);
      profile = res.data ?? null;
      if (!profile) throw new ActionError("取り込み定義が見つかりません。画面を再読み込みしてください。");
    }

    const notes: string[] = [];
    const detected = detectHeader(sheet.rows);
    let headerRow = detected.headerRow;
    let headers = detected.headers;

    // 画面から列の対応・見出しの行を指定して読み直すこともできる
    const overrideMapping = parseMappingParam(fd(formData, "mapping"));
    const headerRowParam = fd(formData, "header_row").trim();
    const overrideHeaderRow = headerRowParam === "" ? -1 : Number(headerRowParam);
    if (overrideMapping && Number.isInteger(overrideHeaderRow) && overrideHeaderRow >= 0 && overrideHeaderRow < sheet.rows.length) {
      headerRow = overrideHeaderRow;
      headers = (sheet.rows[overrideHeaderRow] ?? []).map((c) => normalizeName(c));
    }

    const savedMapping = profile ? normalizeMapping(profile.mapping) : { ...EMPTY_MAPPING };
    if (!overrideMapping && profile && profile.header_row >= 0 && profile.header_row < sheet.rows.length) {
      const savedHeaders = (sheet.rows[profile.header_row] ?? []).map((c) => normalizeName(c));
      if (mappingHits(savedMapping, savedHeaders) >= 2) {
        headerRow = profile.header_row;
        headers = savedHeaders;
      }
    }

    const useSaved = !overrideMapping && mappingHits(savedMapping, headers) >= 2;
    const mapping = overrideMapping ?? (useSaved ? savedMapping : guessMapping(headers));
    if (!overrideMapping && profile && !useSaved) notes.push("覚えている列の対応がこのファイルに合わなかったため、見出しから推測し直しました。");

    const rowsAll = applyMapping(sheet.rows, mapping, headerRow, month);
    const truncated = parsed.truncated || rowsAll.length > MAX_IMPORT_ROWS;
    const rows = rowsAll.slice(0, MAX_IMPORT_ROWS);
    if (truncated) notes.push(`行が多いため先頭 ${MAX_IMPORT_ROWS} 行だけを表示しています。期間を分けて取り込んでください。`);

    const masters = await loadMasters(supabase, company.id);
    const items = masters.projects.flatMap((p) =>
      p.items.map((i) => ({ id: i.id, name: i.name, project_id: p.id, project_name: p.name, is_active: i.is_active && p.is_active })),
    );
    const result = matchNames(
      rows,
      masters.drivers.map((d) => ({ id: d.id, name: d.name, is_active: d.is_active })),
      items,
      profile ? normalizeMatchMap(profile.driver_match) : {},
      profile ? normalizeMatchMap(profile.item_match) : {},
    );
    const checked = restrictToMonth(result.rows, month);
    const ok = checked.filter((r) => r.ok).length;

    const missing = missingMappingFields(mapping);
    if (missing.length > 0) notes.push("日付・ドライバー・数量の列を見つけられませんでした。見出しの行が正しいか確認してください。");
    if (parsed.encoding === "shift_jis") notes.push("Shift_JIS のファイルとして読み込みました。");

    return {
      profileId: profile?.id ?? "",
      fileName: file.name,
      sheetName: sheet.name,
      encoding: parsed.encoding,
      headerRow,
      headers,
      mapping,
      missing,
      rows: checked,
      unmatched: result.unmatched,
      counts: { total: checked.length, ok, ng: checked.length - ok },
      months: monthsOf(checked),
      truncated,
      notes,
    };
  });
}

/** 取り込みの結果 */
export interface RunImportResult {
  runId: string;
  /** 日別の稼働として登録・承認した件数 */
  applied: number;
  /** 取り込まなかった件数 */
  skipped: number;
  /** 保存した取り込み定義（無ければ ""） */
  profileId: string;
}

/** 1 回の RPC でまとめて送る件数（同時に走らせる本数） */
const RPC_CONCURRENCY = 6;
const APPROVE_CHUNK = 200;

async function runInChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/**
 * 確定した対応で日別の稼働として取り込む（admin+）。
 * submit_day_entries（日付 × ドライバーごと）→ approve_day_entries（承認）の順に呼ぶと、
 * DB のトリガーがその月の稼働行（work_entries.qty）へ自動で反映する。
 * 取り込み結果は import_runs に記録し、列・名前の対応は import_profiles に覚える。
 */
export async function runImportAction(input: RunImportInput): Promise<ActionResult<RunImportResult>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireAdminAction();
    const v = runImportSchema.parse(input);

    // 別の月（締め済みかもしれない）へ書き込まないよう、選択中の稼動月の行だけを受け付ける
    const outside = v.rows.filter((r) => dateToMonth(r.date) !== v.month);
    if (outside.length > 0) throw new ActionError(`${v.month} 以外の日付が ${outside.length} 件あります。プレビューで除いてから取り込んでください。`);

    const driverIds = [...new Set(v.rows.map((r) => r.driver_id))];
    const itemIds = [...new Set(v.rows.map((r) => r.item_id))];
    const [driverRes, itemRes] = await Promise.all([
      supabase.from("drivers").select("id").eq("company_id", company.id).in("id", driverIds),
      supabase.from("project_items").select("id").eq("company_id", company.id).in("id", itemIds),
    ]);
    ensureNoError(driverRes);
    ensureNoError(itemRes);
    if ((driverRes.data ?? []).length !== driverIds.length) throw new ActionError("ドライバーが見つかりません。画面を再読み込みしてください。");
    if ((itemRes.data ?? []).length !== itemIds.length) throw new ActionError("案件内容が見つかりません。画面を再読み込みしてください。");

    // 日付 × ドライバーごとにまとめる（同じ内容が複数行あれば合計する）
    const groups = new Map<string, { date: string; driverId: string; qtys: Map<string, number> }>();
    for (const row of v.rows) {
      const key = `${row.date}|${row.driver_id}`;
      const group = groups.get(key) ?? { date: row.date, driverId: row.driver_id, qtys: new Map<string, number>() };
      group.qtys.set(row.item_id, Math.round(((group.qtys.get(row.item_id) ?? 0) + row.qty) * 100) / 100);
      groups.set(key, group);
    }
    const memo = v.file_name ? `取り込み: ${v.file_name}`.slice(0, 200) : "取り込み";

    const list = [...groups.values()];
    await runInChunks(list, RPC_CONCURRENCY, async (group) => {
      const res = await supabase.rpc("submit_day_entries", {
        p_work_date: group.date,
        p_item_ids: [...group.qtys.keys()],
        p_qtys: [...group.qtys.values()],
        p_driver_id: group.driverId,
        p_memo: memo,
      });
      ensureNoError(res);
      return Number(res.data ?? 0);
    });

    // 登録した行を承認する（承認すると月次の稼働へ反映される）
    const dates = [...new Set(list.map((g) => g.date))];
    const wanted = new Set(v.rows.map((r) => `${r.date}|${r.driver_id}|${r.item_id}`));
    const entriesRes = await supabase
      .from("work_day_entries")
      .select("id, work_date, driver_id, project_item_id")
      .eq("company_id", company.id)
      .in("work_date", dates)
      .in("driver_id", driverIds);
    ensureNoError(entriesRes);
    const ids = (entriesRes.data ?? [])
      .filter((e) => wanted.has(`${e.work_date}|${e.driver_id}|${e.project_item_id}`))
      .map((e) => e.id);

    let applied = 0;
    for (let i = 0; i < ids.length; i += APPROVE_CHUNK) {
      const res = await supabase.rpc("approve_day_entries", { p_ids: ids.slice(i, i + APPROVE_CHUNK), p_approve: true, p_reason: "" });
      ensureNoError(res);
      applied += Number(res.data ?? 0);
    }

    // 取り込み定義に覚えさせる（次回から自動で当たる）
    let profileId = v.profile_id ?? "";
    const profileRow = {
      mapping: v.mapping,
      header_row: v.header_row,
      last_used_at: new Date().toISOString(),
    };
    if (profileId) {
      const current = await supabase.from("import_profiles").select("driver_match, item_match").eq("company_id", company.id).eq("id", profileId).maybeSingle();
      ensureNoError(current);
      if (!current.data) throw new ActionError("取り込み定義が見つかりません。画面を再読み込みしてください。");
      const res = await supabase
        .from("import_profiles")
        .update({
          ...profileRow,
          driver_match: { ...normalizeMatchMap(current.data.driver_match), ...v.driver_match },
          item_match: { ...normalizeMatchMap(current.data.item_match), ...v.item_match },
          ...(v.client_id ? { client_id: v.client_id } : {}),
          ...(v.project_id ? { project_id: v.project_id } : {}),
        })
        .eq("company_id", company.id)
        .eq("id", profileId)
        .select("id");
      ensureNoError(res);
    } else if (v.profile_name) {
      const res = unwrap<{ id: string }>(
        await supabase
          .from("import_profiles")
          .insert({
            company_id: company.id,
            name: v.profile_name,
            client_id: v.client_id,
            project_id: v.project_id,
            driver_match: v.driver_match,
            item_match: v.item_match,
            created_by: user.id,
            ...profileRow,
          })
          .select("id")
          .single(),
      );
      profileId = res.id;
    }

    const run = unwrap<{ id: string }>(
      await supabase
        .from("import_runs")
        .insert({
          company_id: company.id,
          profile_id: profileId || null,
          file_name: v.file_name,
          month: monthToDate(v.month),
          row_count: v.rows.length + v.skipped,
          applied_count: applied,
          skipped_count: v.skipped,
          unmatched: v.unmatched,
          created_by: user.id,
        })
        .select("id")
        .single(),
    );

    revalidateIntake();
    return { runId: run.id, applied, skipped: v.skipped, profileId };
  }, "取り込みました。日別の稼働として承認し、月次の稼働に反映しました。");
}

/** 取り込み定義の追加・更新（admin+） */
export async function saveImportProfileAction(input: SaveImportProfileInput): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { supabase, company, user } = await requireAdminAction();
    const v = saveImportProfileSchema.parse(input);

    const row = {
      name: v.name,
      client_id: v.client_id,
      project_id: v.project_id,
      mapping: v.mapping,
      header_row: v.header_row,
      memo: v.memo,
      is_active: v.is_active,
    };
    const saved = v.id
      ? unwrap<{ id: string }>(
          await supabase.from("import_profiles").update(row).eq("company_id", company.id).eq("id", v.id).select("id").maybeSingle(),
          "取り込み定義が見つかりません（既に削除された可能性があります）。",
        )
      : unwrap<{ id: string }>(
          await supabase
            .from("import_profiles")
            .insert({ ...row, company_id: company.id, created_by: user.id })
            .select("id")
            .single(),
        );

    revalidatePath("/intake");
    return { id: saved.id };
  }, "取り込み定義を保存しました。");
}

/** 取り込み定義の削除（admin+） */
export async function deleteImportProfileAction(id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { supabase, company } = await requireAdminAction();
    const v = deleteImportProfileSchema.parse({ id });
    const res = await supabase.from("import_profiles").delete().eq("company_id", company.id).eq("id", v.id).select("id");
    ensureNoError(res);
    if ((res.data ?? []).length === 0) throw new ActionError("取り込み定義が見つかりません（既に削除された可能性があります）。");
    revalidatePath("/intake");
    return null;
  }, "取り込み定義を削除しました。");
}
