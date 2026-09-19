"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Loader2, Save, Trash2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { deleteImportProfileAction, previewImportAction, runImportAction, saveImportProfileAction, type ImportPreview } from "@/lib/actions/intake";
import { MAPPING_FIELDS, MAPPING_LABELS, matchNames, restrictToMonth, type MappingField, type SheetMapping } from "@/lib/intake/mapping";
import { learnedMatches } from "@/lib/intake/mapping";
import { MAX_SHEET_BYTES, SHEET_ACCEPT, SHEET_SUPPORT_TEXT } from "@/lib/schemas/intake";
import { parseNumberInput } from "@/lib/calc/parse";
import { formatDateTimeJa } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import { PreviewTable, type DriverOption, type ItemOption } from "./preview-table";
import { formatBytes, previewSummaryText, runResultText, sanitizeMatchMap, type ProfileRow, type RunRow } from "./helpers";

export interface IntakeViewProps {
  month: string;
  profiles: ProfileRow[];
  runs: RunRow[];
  drivers: DriverOption[];
  items: ItemOption[];
  /** 取り込めるか（admin 以上かつ未締め） */
  editable: boolean;
  closed: boolean;
}

/** 一度に表示するプレビューの行数 */
const PREVIEW_CHUNK = 50;

export function IntakeView({ month, profiles, runs, drivers, items, editable, closed }: IntakeViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [profileId, setProfileId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<SheetMapping | null>(null);
  const [driverMap, setDriverMap] = useState<Record<string, string>>({});
  const [itemMap, setItemMap] = useState<Record<string, string>>({});
  const [headerRow, setHeaderRow] = useState(0);
  const [profileName, setProfileName] = useState("");
  const [limit, setLimit] = useState(PREVIEW_CHUNK);
  const [deleteTarget, setDeleteTarget] = useState<ProfileRow | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 対応づけを直したら、その場で突き合わせ直す（サーバーと同じ純関数を使う）
  const rows = useMemo(() => {
    if (!preview) return [];
    const matched = matchNames(
      preview.rows,
      drivers.map((d) => ({ id: d.id, name: d.name, is_active: d.isActive })),
      items.map((i) => ({ id: i.id, name: i.name, project_id: i.projectId, project_name: i.projectName, is_active: i.isActive })),
      driverMap,
      itemMap,
    );
    return restrictToMonth(matched.rows, month);
  }, [preview, drivers, items, driverMap, itemMap, month]);

  const okRows = useMemo(() => rows.filter((r) => r.ok), [rows]);
  const counts = { total: rows.length, ok: okRows.length, ng: rows.length - okRows.length };
  const unmatchedDrivers = useMemo(() => [...new Set(rows.filter((r) => r.driverName && !r.driverId).map((r) => r.driverName))], [rows]);
  const unmatchedItems = useMemo(() => [...new Set(rows.filter((r) => r.itemLabel && !r.itemId).map((r) => r.itemLabel))], [rows]);

  const resetPreview = () => {
    setPreview(null);
    setMapping(null);
    setHeaderRow(0);
    setDriverMap({});
    setItemMap({});
    setLimit(PREVIEW_CHUNK);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    if (selected && selected.size > MAX_SHEET_BYTES) {
      toast.error(`ファイルは ${MAX_SHEET_BYTES / 1024 / 1024}MB 以下にしてください（${formatBytes(selected.size)}）。`);
      if (inputRef.current) inputRef.current.value = "";
      setFile(null);
      return;
    }
    resetPreview();
    setFile(selected);
  };

  /** ファイルを読み込んでプレビューを作る（overrides を渡すと列の対応を指定して読み直す） */
  const load = (overrides?: { mapping: SheetMapping; headerRow: number }) => {
    if (!file) return;
    setLoading(true);
    startTransition(async () => {
      const data = new FormData();
      data.append("file", file);
      data.append("m", month);
      data.append("profile_id", profileId);
      if (overrides) {
        data.append("mapping", JSON.stringify(overrides.mapping));
        data.append("header_row", String(overrides.headerRow));
      }
      const res = await previewImportAction(data);
      setLoading(false);
      if (!res.ok) {
        toast.error(res.error, { duration: 10000 });
        return;
      }
      const learned = learnedMatches(res.data.rows);
      setPreview(res.data);
      setMapping(res.data.mapping);
      setHeaderRow(res.data.headerRow);
      setDriverMap(learned.drivers);
      setItemMap(learned.items);
      setLimit(PREVIEW_CHUNK);
      for (const note of res.data.notes) toast.info(note, { duration: 8000 });
    });
  };

  const runImport = () => {
    if (!preview || okRows.length === 0) return;
    startTransition(async () => {
      const res = await runImportAction({
        profile_id: profileId || null,
        profile_name: profileId ? "" : profileName.trim(),
        month,
        file_name: preview.fileName,
        header_row: headerRow,
        mapping: mapping ?? preview.mapping,
        driver_match: sanitizeMatchMap(driverMap),
        item_match: sanitizeMatchMap(itemMap),
        rows: okRows.map((r) => ({ date: r.date, driver_id: r.driverId, item_id: r.itemId, qty: r.qty })),
        skipped: counts.ng,
        unmatched: [...unmatchedDrivers, ...unmatchedItems].slice(0, 200).map((n) => n.slice(0, 200)),
        client_id: null,
        project_id: null,
      });
      if (!res.ok) {
        toast.error(res.error, { duration: 10000 });
        return;
      }
      toast.success(runResultText(res.data), { duration: 10000 });
      if (res.data.profileId) setProfileId(res.data.profileId);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      resetPreview();
      setProfileName("");
      router.refresh();
    });
  };

  const saveProfile = () => {
    if (!preview) return;
    const name = profileId ? (profiles.find((p) => p.id === profileId)?.name ?? "") : profileName.trim();
    if (!name) {
      toast.error("取り込み定義の名前を入力してください。");
      return;
    }
    startTransition(async () => {
      const res = await saveImportProfileAction({
        id: profileId || null,
        name,
        client_id: null,
        project_id: null,
        mapping: mapping ?? preview.mapping,
        header_row: headerRow,
        memo: "",
        is_active: true,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました。");
      setProfileId(res.data.id);
      router.refresh();
    });
  };

  const runDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const res = await deleteImportProfileAction(target.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`「${target.name}」を削除しました。`);
      if (profileId === target.id) setProfileId("");
      setDeleteTarget(null);
      router.refresh();
    });
  };

  const selectedProfile = profiles.find((p) => p.id === profileId) ?? null;
  const busy = pending || loading;

  return (
    <div className="space-y-4">
      <PageHeader
        title="実績ファイルの取り込み"
        description={`${formatMonthJa(month)} の稼働として取り込みます。日付・ドライバー・案件内容・数量を読み取り、承認済みの日別の稼働として登録します。`}
      />

      {closed && <Alert variant="warning">{formatMonthJa(month)} は締め済みのため取り込めません。締めを解除してから操作してください。</Alert>}
      {!editable && !closed && <Alert>閲覧のみのため取り込みはできません。</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>ファイルを読み込む</CardTitle>
          <CardDescription>{SHEET_SUPPORT_TEXT}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="intake-profile">取り込み定義</Label>
              <Select
                id="intake-profile"
                value={profileId}
                onChange={(e) => {
                  setProfileId(e.target.value);
                  resetPreview();
                }}
                disabled={busy || !editable}
              >
                <option value="">新規（見出しから自動で判定）</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.clientName ? `（${p.clientName}）` : ""}
                  </option>
                ))}
              </Select>
              {selectedProfile && (
                <p className="text-xs text-muted-foreground">
                  これまで {selectedProfile.runCount} 回使用
                  {selectedProfile.lastUsedAt ? `／最終 ${formatDateTimeJa(selectedProfile.lastUsedAt)}` : ""}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="intake-file">実績ファイル</Label>
              <input
                ref={inputRef}
                id="intake-file"
                type="file"
                accept={SHEET_ACCEPT}
                onChange={onFileChange}
                disabled={busy || !editable}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-muted"
              />
              {file && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {file.name}（{formatBytes(file.size)}）
                </p>
              )}
            </div>
          </div>

          <Button onClick={() => load()} disabled={!file || busy || !editable}>
            {loading ? <Loader2 className="animate-spin" /> : <Upload />}
            {loading ? "読み込み中…" : "読み込む"}
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>プレビュー</CardTitle>
            <CardDescription>
              {preview.fileName}／{preview.headerRow + 1} 行目を見出しとして読みました。{previewSummaryText(counts)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.missing.length > 0 && (
              <Alert variant="warning">
                {preview.missing.map((f) => MAPPING_LABELS[f]).join("・")}の列を見つけられませんでした。下の「列の対応」で選んでから読み直してください。
              </Alert>
            )}
            {preview.months.length > 1 && (
              <Alert variant="warning">ファイルに {preview.months.join("・")} の日付が含まれています。{formatMonthJa(month)} 以外の行は取り込みません。</Alert>
            )}

            {/* 列の対応（見出しから選び直せる） */}
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">列の対応を変える</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {MAPPING_FIELDS.map((field: MappingField) => (
                  <div key={field} className="space-y-1.5">
                    <Label htmlFor={`map-${field}`}>{MAPPING_LABELS[field]}</Label>
                    <Select
                      id={`map-${field}`}
                      value={(mapping ?? preview.mapping)[field]}
                      onChange={(e) => setMapping({ ...(mapping ?? preview.mapping), [field]: e.target.value })}
                      disabled={busy || !editable}
                    >
                      <option value="">（使わない）</option>
                      {preview.headers.map((h, i) => (
                        <option key={`${h}-${i}`} value={h}>
                          {h || `（${i + 1} 列目）`}
                        </option>
                      ))}
                    </Select>
                  </div>
                ))}
                <div className="space-y-1.5">
                  <Label htmlFor="map-header-row">見出しの行（何行目）</Label>
                  <NumberInput
                    id="map-header-row"
                    decimal={false}
                    value={String(headerRow + 1)}
                    onChange={(e) => setHeaderRow(Math.max(0, (parseNumberInput(e.target.value) ?? 1) - 1))}
                    disabled={busy || !editable}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => mapping && load({ mapping, headerRow })} disabled={busy || !editable}>
                  <Wand2 /> この対応で読み直す
                </Button>
                <Button variant="outline" size="sm" onClick={saveProfile} disabled={busy || !editable}>
                  <Save /> 列の対応を保存
                </Button>
              </div>
            </details>

            {(unmatchedDrivers.length > 0 || unmatchedItems.length > 0) && (
              <Alert variant="warning">
                対応が付いていない名前があります（表の赤い行で選んでください）。
                {unmatchedDrivers.length > 0 && <> ドライバー：{unmatchedDrivers.slice(0, 5).join("・")}{unmatchedDrivers.length > 5 ? " ほか" : ""}。</>}
                {unmatchedItems.length > 0 && <> 案件内容：{unmatchedItems.slice(0, 5).join("・")}{unmatchedItems.length > 5 ? " ほか" : ""}。</>}
              </Alert>
            )}

            {rows.length === 0 ? (
              <Empty title="取り込める行がありません" description="見出しの行と列の対応を確認してください。" />
            ) : (
              <>
                <PreviewTable
                  rows={rows.slice(0, limit)}
                  drivers={drivers}
                  items={items}
                  disabled={busy || !editable}
                  onAssignDriver={(name, id) => setDriverMap((m) => ({ ...m, [name]: id }))}
                  onAssignItem={(label, id) => setItemMap((m) => ({ ...m, [label]: id }))}
                />
                {rows.length > limit && (
                  <Button variant="outline" size="sm" onClick={() => setLimit((v) => v + PREVIEW_CHUNK * 4)}>
                    残り {rows.length - limit} 行を表示
                  </Button>
                )}
              </>
            )}

            {!profileId && (
              <div className="space-y-1.5">
                <Label htmlFor="intake-profile-name">取り込み定義として覚える（任意）</Label>
                <Input
                  id="intake-profile-name"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="〇〇運輸 月次実績"
                  disabled={busy || !editable}
                />
                <p className="text-xs text-muted-foreground">名前を入れて取り込むと、列と名前の対応を覚えて次回から自動で当てはめます。</p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={runImport} disabled={busy || !editable || okRows.length === 0}>
                {pending ? <Loader2 className="animate-spin" /> : <Upload />}
                {pending ? "取り込み中…" : `${okRows.length} 行を取り込む`}
              </Button>
              {counts.ng > 0 && <Badge variant="outline">{counts.ng} 行は取り込みません</Badge>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>取り込み履歴</CardTitle>
          <CardDescription>直近 {runs.length} 件</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <Empty title="まだ取り込みはありません" description="元請からもらった CSV を読み込むと、ここに履歴が残ります。" />
          ) : (
            <ul className="divide-y rounded-md border">
              {runs.map((run) => (
                <li key={run.id} className="p-2.5">
                  <p className="truncate text-sm font-medium" title={run.fileName}>
                    {run.fileName || "（ファイル名なし）"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeJa(run.createdAt)}
                    {run.month ? `／${formatMonthJa(run.month)}` : ""}／{run.rowCount} 行中 {run.appliedCount} 件を反映
                    {run.skippedCount > 0 ? `・${run.skippedCount} 行は取り込まず` : ""}
                  </p>
                  {run.unmatched.length > 0 && (
                    <p className="text-xs text-muted-foreground">対応が付かなかった名前：{run.unmatched.slice(0, 5).join("・")}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {profiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>取り込み定義</CardTitle>
            <CardDescription>覚えている列と名前の対応です。元請ごとに 1 つ作ると、次回から選ぶだけで取り込めます。</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-md border">
              {profiles.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.clientName ? `${p.clientName}／` : ""}
                      {MAPPING_FIELDS.filter((f) => p.mapping[f]).map((f) => `${MAPPING_LABELS[f]}＝${p.mapping[f]}`).join("・") || "列の対応は未設定"}
                    </p>
                  </div>
                  {editable && (
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteTarget(p)} disabled={busy}>
                      <Trash2 /> 削除
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && !busy && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>取り込み定義を削除する</DialogTitle>
            <DialogDescription>
              {deleteTarget && <>「{deleteTarget.name}」を削除します。覚えている列と名前の対応も消えます（取り込み済みの稼働はそのまま残ります）。</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={busy}>
              {busy ? "削除中…" : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
