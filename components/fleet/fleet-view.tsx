"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download, FileText, Pencil, Plus, Trash2, Truck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DOCUMENT_KIND_LABELS, VEHICLE_OWNERSHIP_LABELS, type DocumentKind } from "@/lib/db/types";
import { deleteDocumentAction, deleteVehicleAction } from "@/lib/actions/fleet";
import type { FleetTab } from "@/lib/schemas/fleet";
import {
  countExpiry,
  documentTarget,
  documentTitle,
  expiryLabel,
  expiryMessage,
  fleetCsvUrl,
  fleetTabHref,
  formatDate,
  sortDocuments,
  type FleetDocument,
  type FleetVehicle,
} from "@/lib/fleet/helpers";
import { cn } from "@/lib/utils";
import { ExpiryBadge } from "./expiry-badge";
import { VehicleDialog } from "./vehicle-dialog";
import { DocumentDialog } from "./document-dialog";
import type { FleetChoices } from "./choices";

export interface FleetViewProps {
  tab: FleetTab;
  vehicles: FleetVehicle[];
  documents: FleetDocument[];
  /** 日本時間の今日 "YYYY-MM-DD"（期限の判定の基準日） */
  today: string;
  /** 追加・編集ができる（owner/admin） */
  editable: boolean;
  /** 編集できるときだけ渡す（ダイアログの選択肢） */
  choices: FleetChoices | null;
}

interface VehicleDialogState {
  open: boolean;
  mode: "create" | "edit";
  vehicle: FleetVehicle | null;
}

interface DocumentDialogState {
  open: boolean;
  mode: "create" | "edit";
  document: FleetDocument | null;
  defaultVehicleId: string;
  defaultDriverId: string;
}

type DeleteTarget = { kind: "vehicle"; id: string; name: string } | { kind: "document"; id: string; name: string };

/** 車両と書類（/fleet）。稼動月には依存しない */
export function FleetView({ tab, vehicles, documents, today, editable, choices }: FleetViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expandedVehicleId, setExpandedVehicleId] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [targetFilter, setTargetFilter] = useState<string>("");
  const [vehicleDialog, setVehicleDialog] = useState<VehicleDialogState>({ open: false, mode: "create", vehicle: null });
  const [documentDialog, setDocumentDialog] = useState<DocumentDialogState>({
    open: false,
    mode: "create",
    document: null,
    defaultVehicleId: "",
    defaultDriverId: "",
  });
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const sorted = useMemo(() => sortDocuments(documents), [documents]);
  // 件数・名指しの案内は「見張っている書類」（停止中を除く）だけで数える
  const watched = useMemo(() => sorted.filter((d) => d.isActive), [sorted]);
  const counts = useMemo(() => countExpiry(watched), [watched]);
  const urgent = useMemo(() => watched.filter((d) => d.status === "expired"), [watched]);
  const activeVehicles = vehicles.filter((v) => v.isActive).length;

  /** 書類タブの絞り込みの選択肢（実際に書類がある対象だけ出す） */
  const targetOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const d of sorted) {
      if (d.driverId) seen.set(`driver:${d.driverId}`, d.driverName || "（ドライバー）");
      else if (d.vehicleId) seen.set(`vehicle:${d.vehicleId}`, d.vehiclePlate || "（車両）");
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [sorted]);

  const kindOptions = useMemo(() => {
    const seen = new Set<DocumentKind>();
    for (const d of sorted) seen.add(d.kind);
    return [...seen];
  }, [sorted]);

  const effectiveKind = kindFilter && kindOptions.includes(kindFilter as DocumentKind) ? kindFilter : "";
  const effectiveTarget = targetFilter && targetOptions.some((o) => o.value === targetFilter) ? targetFilter : "";
  const filteredDocuments = useMemo(
    () =>
      sorted.filter((d) => {
        if (effectiveKind && d.kind !== effectiveKind) return false;
        if (effectiveTarget) {
          const key = d.driverId ? `driver:${d.driverId}` : d.vehicleId ? `vehicle:${d.vehicleId}` : "";
          if (key !== effectiveTarget) return false;
        }
        return true;
      }),
    [sorted, effectiveKind, effectiveTarget],
  );
  const isFiltered = filteredDocuments.length !== sorted.length;

  const openCreateVehicle = () => setVehicleDialog({ open: true, mode: "create", vehicle: null });
  const openEditVehicle = (vehicle: FleetVehicle) => {
    if (!editable) return;
    setVehicleDialog({ open: true, mode: "edit", vehicle });
  };
  const openCreateDocument = (defaults: { vehicleId?: string; driverId?: string } = {}) =>
    setDocumentDialog({
      open: true,
      mode: "create",
      document: null,
      defaultVehicleId: defaults.vehicleId ?? "",
      defaultDriverId: defaults.driverId ?? "",
    });
  const openEditDocument = (doc: FleetDocument) => {
    if (!editable) return;
    setDocumentDialog({ open: true, mode: "edit", document: doc, defaultVehicleId: "", defaultDriverId: "" });
  };

  const runDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const res = target.kind === "vehicle" ? await deleteVehicleAction(target.id) : await deleteDocumentAction(target.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      setDeleteTarget(null);
      router.refresh();
    });
  };

  const canDialog = editable && choices != null;

  /** その車両の書類（期限が近い順） */
  const documentsOfVehicle = (vehicleId: string) => sorted.filter((d) => d.vehicleId === vehicleId);

  /** 車両の書類の小さな一覧（PC の展開行・スマホのカードで共用） */
  const VehicleDocuments = ({ vehicle }: { vehicle: FleetVehicle }) => {
    const rows = documentsOfVehicle(vehicle.id);
    return (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">{vehicle.plate} の書類（車検・自賠責・任意保険など）</p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ書類が登録されていません。</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm">
                <span className="font-medium">{DOCUMENT_KIND_LABELS[d.kind]}</span>
                {d.label && <span className="text-muted-foreground">{d.label}</span>}
                <span className="num text-muted-foreground">{formatDate(d.expiresOn)}</span>
                <ExpiryBadge status={d.status} daysLeft={d.daysLeft} showDays />
                {!d.isActive && <Badge variant="secondary">停止中</Badge>}
                {editable && (
                  <span className="ml-auto flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="書類を編集" onClick={() => openEditDocument(d)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      aria-label="書類を削除"
                      onClick={() => setDeleteTarget({ kind: "document", id: d.id, name: `${vehicle.plate} の${documentTitle(d)}` })}
                    >
                      <Trash2 />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canDialog && (
          <Button variant="outline" size="sm" onClick={() => openCreateDocument({ vehicleId: vehicle.id })}>
            <Plus /> この車両の書類を追加
          </Button>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="車両と書類"
        description="車両の登録と、免許証・車検・自賠責・任意保険・健康診断などの有効期限を管理します。期限が切れると事業が止まるため、早めの更新を。"
        actions={
          <>
            {canDialog && (
              <>
                <Button onClick={openCreateVehicle}>
                  <Plus /> 車両を追加
                </Button>
                <Button variant="outline" onClick={() => openCreateDocument()}>
                  <Plus /> 書類を追加
                </Button>
              </>
            )}
            <a href={fleetCsvUrl(tab === "vehicles" ? "vehicle" : "document")} download className={buttonVariants({ variant: "outline" })}>
              <Download /> CSV
            </a>
          </>
        }
      />

      {/* 期限の件数 */}
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className={cn("min-w-0 p-3 md:p-4", counts.expired > 0 && "border-destructive/40 bg-destructive/5")}>
          <p className="text-xs text-muted-foreground md:text-sm">期限切れ</p>
          <p className={cn("mt-1 text-lg font-semibold md:text-2xl", counts.expired > 0 && "text-destructive")}>{counts.expired} 件</p>
        </Card>
        <Card className={cn("min-w-0 p-3 md:p-4", counts.soon > 0 && "border-warning/40 bg-warning/5")}>
          <p className="text-xs text-muted-foreground md:text-sm">まもなく期限</p>
          <p className={cn("mt-1 text-lg font-semibold md:text-2xl", counts.soon > 0 && "text-warning")}>{counts.soon} 件</p>
        </Card>
        <Card className="min-w-0 p-3 md:p-4">
          <p className="text-xs text-muted-foreground md:text-sm">有効な書類</p>
          <p className="mt-1 text-lg font-semibold md:text-2xl">{counts.valid} 件</p>
        </Card>
        <Card className="min-w-0 p-3 md:p-4">
          <p className="text-xs text-muted-foreground md:text-sm">車両</p>
          <p className="mt-1 text-lg font-semibold md:text-2xl">{activeVehicles} 台</p>
        </Card>
      </div>

      {/* 期限切れの名指しの案内 */}
      {urgent.length > 0 && (
        <Alert variant="destructive" className="mb-3">
          <p className="font-semibold">期限切れの書類が {urgent.length} 件あります。すぐに更新してください。</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {urgent.slice(0, 3).map((d) => (
              <li key={d.id}>{expiryMessage(d)}</li>
            ))}
          </ul>
          {urgent.length > 3 && <p className="mt-1 text-xs">ほか {urgent.length - 3} 件（「書類」タブで確認できます）</p>}
        </Alert>
      )}

      {/* タブ（稼動月に依存しないのでそのままのリンク） */}
      <div className="-mx-4 mb-3 overflow-x-auto border-b px-4">
        <div className="flex gap-1 whitespace-nowrap">
          {(
            [
              { key: "vehicles" as const, label: `車両（${vehicles.length}）` },
              { key: "documents" as const, label: `書類（${documents.length}）` },
            ] satisfies { key: FleetTab; label: string }[]
          ).map((t) => (
            <Link
              key={t.key}
              href={fleetTabHref(t.key)}
              className={cn("border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground")}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {tab === "vehicles" ? (
        vehicles.length === 0 ? (
          <Empty title="まだ車両がありません" description={canDialog ? "「車両を追加」で黒ナンバーの車両を登録してください。" : "登録された車両はありません。"}>
            {canDialog && (
              <Button onClick={openCreateVehicle}>
                <Plus /> 車両を追加
              </Button>
            )}
          </Empty>
        ) : (
          <>
            {/* PC：表 */}
            <Card className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>車両番号</TableHead>
                    <TableHead>メーカー／車種</TableHead>
                    <TableHead>所有区分</TableHead>
                    <TableHead>割当ドライバー</TableHead>
                    <TableHead>次の期限</TableHead>
                    <TableHead className="text-right">期限切れ</TableHead>
                    <TableHead className="text-right">月額リース料</TableHead>
                    {editable && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vehicles.map((v) => {
                    const expanded = expandedVehicleId === v.id;
                    return (
                      <Fragment key={v.id}>
                        <TableRow>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={expanded ? "書類を閉じる" : "書類を開く"}
                              aria-expanded={expanded}
                              onClick={() => setExpandedVehicleId(expanded ? "" : v.id)}
                            >
                              {expanded ? <ChevronDown /> : <ChevronRight />}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">
                            <span className="flex flex-wrap items-center gap-1.5">
                              {v.plate}
                              {!v.isActive && <Badge variant="secondary">停止中</Badge>}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{[v.maker, v.model].filter(Boolean).join(" ") || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{VEHICLE_OWNERSHIP_LABELS[v.ownership]}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{v.driverName || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            {v.nextExpiresOn ? (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <span className="num">{formatDate(v.nextExpiresOn)}</span>
                                <ExpiryBadge status={v.status} daysLeft={v.daysLeft} showDays />
                                {v.nextKind && <span className="text-xs text-muted-foreground">{DOCUMENT_KIND_LABELS[v.nextKind]}</span>}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="num text-right">{v.expiredCount > 0 ? <span className="font-semibold text-destructive">{v.expiredCount}</span> : "0"}</TableCell>
                          <TableCell className="text-right">
                            <Money value={v.leaseMonthly} showZeroAsDash />
                          </TableCell>
                          {editable && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="編集" onClick={() => openEditVehicle(v)}>
                                  <Pencil />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive"
                                  aria-label="削除"
                                  onClick={() => setDeleteTarget({ kind: "vehicle", id: v.id, name: v.plate })}
                                >
                                  <Trash2 />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                        {expanded && (
                          <TableRow>
                            <TableCell colSpan={editable ? 9 : 8} className="bg-muted/40">
                              <VehicleDocuments vehicle={v} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            {/* スマホ：カード */}
            <div className="flex flex-col gap-2 md:hidden">
              {vehicles.map((v) => {
                const expanded = expandedVehicleId === v.id;
                return (
                  <Card key={v.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                          <Truck className="h-4 w-4 text-muted-foreground" />
                          {v.plate}
                          {!v.isActive && <Badge variant="secondary">停止中</Badge>}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {[v.maker, v.model].filter(Boolean).join(" ") || "—"} ・ {VEHICLE_OWNERSHIP_LABELS[v.ownership]}
                        </p>
                      </div>
                      {v.nextExpiresOn && <ExpiryBadge status={v.status} daysLeft={v.daysLeft} showDays />}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                      <dt className="text-muted-foreground">割当ドライバー</dt>
                      <dd className="text-right">{v.driverName || "—"}</dd>
                      <dt className="text-muted-foreground">次の期限</dt>
                      <dd className="num text-right">{v.nextExpiresOn ? formatDate(v.nextExpiresOn) : "—"}</dd>
                      {v.expiredCount > 0 && (
                        <>
                          <dt className="text-muted-foreground">期限切れ</dt>
                          <dd className="num text-right font-semibold text-destructive">{v.expiredCount} 件</dd>
                        </>
                      )}
                      {v.leaseMonthly > 0 && (
                        <>
                          <dt className="text-muted-foreground">月額リース料</dt>
                          <dd className="text-right">
                            <Money value={v.leaseMonthly} />
                          </dd>
                        </>
                      )}
                    </dl>
                    <div className="mt-2 flex flex-wrap justify-between gap-2">
                      <Button variant="outline" size="sm" onClick={() => setExpandedVehicleId(expanded ? "" : v.id)} aria-expanded={expanded}>
                        <FileText /> 書類 {documentsOfVehicle(v.id).length} 件
                      </Button>
                      {editable && (
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEditVehicle(v)}>
                            <Pencil /> 編集
                          </Button>
                          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteTarget({ kind: "vehicle", id: v.id, name: v.plate })}>
                            <Trash2 /> 削除
                          </Button>
                        </div>
                      )}
                    </div>
                    {expanded && (
                      <div className="mt-3 border-t pt-3">
                        <VehicleDocuments vehicle={v} />
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        )
      ) : documents.length === 0 ? (
        <Empty
          title="まだ書類がありません"
          description={canDialog ? "「書類を追加」で免許証・車検・自賠責・任意保険・健康診断などの期限を登録してください。" : "登録された書類はありません。"}
        >
          {canDialog && (
            <Button onClick={() => openCreateDocument()}>
              <Plus /> 書類を追加
            </Button>
          )}
        </Empty>
      ) : (
        <>
          {/* 絞り込み */}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select value={effectiveKind} onChange={(e) => setKindFilter(e.target.value)} className="sm:w-56" aria-label="種類で絞り込み">
              <option value="">すべての種類</option>
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
            <Select value={effectiveTarget} onChange={(e) => setTargetFilter(e.target.value)} className="sm:w-56" aria-label="対象で絞り込み">
              <option value="">すべての対象</option>
              {targetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {isFiltered && (
              <p className="text-sm text-muted-foreground">
                {filteredDocuments.length} / {sorted.length} 件
              </p>
            )}
          </div>

          {filteredDocuments.length === 0 ? (
            <Empty title="該当する書類がありません" description="絞り込み条件を変更してください。" />
          ) : (
            <>
              {/* PC：表 */}
              <Card className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>対象</TableHead>
                      <TableHead>種類</TableHead>
                      <TableHead>名称・番号</TableHead>
                      <TableHead>取得日</TableHead>
                      <TableHead>有効期限</TableHead>
                      <TableHead className="text-right">残り日数</TableHead>
                      <TableHead>状態</TableHead>
                      {editable && <TableHead className="w-24" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocuments.map((d) => (
                      <TableRow key={d.id} className={cn(editable && "cursor-pointer")} onClick={() => openEditDocument(d)}>
                        <TableCell className="font-medium">
                          <span className="flex flex-wrap items-center gap-1.5">
                            {documentTarget(d) || "—"}
                            {d.vehicleId && <Badge variant="outline">車両</Badge>}
                            {!d.isActive && <Badge variant="secondary">停止中</Badge>}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{DOCUMENT_KIND_LABELS[d.kind]}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {d.label || "—"}
                          {d.number && <span className="num ml-1 text-xs">{d.number}</span>}
                        </TableCell>
                        <TableCell className="num whitespace-nowrap text-muted-foreground">{formatDate(d.issuedOn)}</TableCell>
                        <TableCell className="num whitespace-nowrap">{formatDate(d.expiresOn)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-right">{expiryLabel(d)}</TableCell>
                        <TableCell>
                          <ExpiryBadge status={d.status} daysLeft={d.daysLeft} />
                        </TableCell>
                        {editable && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="編集" onClick={() => openEditDocument(d)}>
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                aria-label="削除"
                                onClick={() => setDeleteTarget({ kind: "document", id: d.id, name: `${documentTarget(d)} の${documentTitle(d)}` })}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>

              {/* スマホ：カード */}
              <div className="flex flex-col gap-2 md:hidden">
                {filteredDocuments.map((d) => (
                  <Card
                    key={d.id}
                    className={cn("p-3", editable && "active:bg-muted")}
                    onClick={() => openEditDocument(d)}
                    role={editable ? "button" : undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{documentTarget(d) || "—"}</p>
                        <p className="text-sm text-muted-foreground">
                          {DOCUMENT_KIND_LABELS[d.kind]}
                          {d.label ? `／${d.label}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <ExpiryBadge status={d.status} daysLeft={d.daysLeft} />
                        <p className="num mt-1 text-sm">{expiryLabel(d)}</p>
                      </div>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                      <dt className="text-muted-foreground">有効期限</dt>
                      <dd className="num text-right">{formatDate(d.expiresOn)}</dd>
                      {d.issuedOn && (
                        <>
                          <dt className="text-muted-foreground">取得日</dt>
                          <dd className="num text-right">{formatDate(d.issuedOn)}</dd>
                        </>
                      )}
                      {d.number && (
                        <>
                          <dt className="text-muted-foreground">番号</dt>
                          <dd className="num text-right">{d.number}</dd>
                        </>
                      )}
                    </dl>
                    {d.memo && <p className="mt-1 break-words text-xs text-muted-foreground">備考：{d.memo}</p>}
                    {editable && (
                      <div className="mt-2 flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button variant="outline" size="sm" onClick={() => openEditDocument(d)}>
                          <Pencil /> 編集
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDeleteTarget({ kind: "document", id: d.id, name: `${documentTarget(d)} の${documentTitle(d)}` })}
                        >
                          <Trash2 /> 削除
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* 追加・編集ダイアログ */}
      {canDialog && (
        <>
          <VehicleDialog
            open={vehicleDialog.open}
            onOpenChange={(open) => setVehicleDialog((d) => ({ ...d, open }))}
            mode={vehicleDialog.mode}
            choices={choices}
            vehicle={vehicleDialog.vehicle}
          />
          <DocumentDialog
            open={documentDialog.open}
            onOpenChange={(open) => setDocumentDialog((d) => ({ ...d, open }))}
            mode={documentDialog.mode}
            choices={choices}
            document={documentDialog.document}
            defaultVehicleId={documentDialog.defaultVehicleId}
            defaultDriverId={documentDialog.defaultDriverId}
            today={today}
          />
        </>
      )}

      {/* 削除確認 */}
      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && !pending && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deleteTarget?.kind === "vehicle" ? "車両を削除" : "書類を削除"}</DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  {deleteTarget.name} を削除します。この操作は取り消せません。
                  {deleteTarget.kind === "vehicle" && "（日報・事故の記録・書類がある車両は削除できません。停止中にしてください。）"}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={pending}>
              {pending ? "削除中…" : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
