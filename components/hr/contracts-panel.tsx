"use client";

import { useMemo, useState } from "react";
import { ExternalLink, FileSignature, Plus, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Empty } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { contractAlerts, contractAlertText, driversWithoutContract, periodLabel, sortContracts, type ContractView, type DriverLike } from "@/lib/hr/helpers";
import { CONTRACT_STATUS_LABELS } from "@/lib/db/types";
import { formatDateJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import { ContractDialog, EndContractDialog } from "./contract-dialog";
import { ContractFileBadge, contractFileDisplayName, contractFileUrl, isStoredContractFile } from "./contract-file-badge";

export interface ContractsPanelProps {
  contracts: ContractView[];
  drivers: DriverLike[];
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
  /** owner / admin */
  canEdit: boolean;
}

/** 期間の状態のバッジ */
function PeriodBadge({ contract }: { contract: ContractView }) {
  const variant = contract.periodStatus === "expired" ? "destructive" : contract.periodStatus === "renewal" ? "warning" : contract.periodStatus === "ended" ? "secondary" : "outline";
  return <Badge variant={variant}>{periodLabel(contract.periodStatus)}</Badge>;
}

/** 契約書ファイルの欄（あれば「開く」リンク） */
function ContractFileCell({ contract }: { contract: ContractView }) {
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      <ContractFileBadge filePath={contract.filePath} />
      {isStoredContractFile(contract.filePath) ? (
        <a
          href={contractFileUrl(contract.id)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
          title={contractFileDisplayName(contract.filePath)}
        >
          <ExternalLink className="h-3 w-3" aria-hidden /> 開く
        </a>
      ) : contract.filePath ? (
        <span className="max-w-[10rem] truncate text-xs text-muted-foreground">{contract.filePath}</span>
      ) : null}
    </span>
  );
}

/** 残り日数の表示 */
function daysLeftText(contract: ContractView): string {
  if (contract.daysLeft == null) return "—";
  if (contract.daysLeft < 0) return `${-contract.daysLeft} 日超過`;
  return `あと ${contract.daysLeft} 日`;
}

function dateText(date: string): string {
  return date ? formatDateJa(date) : "—";
}

export function ContractsPanel({ contracts, drivers, today, canEdit }: ContractsPanelProps) {
  const [editing, setEditing] = useState<ContractView | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDriverId, setCreateDriverId] = useState<string | undefined>(undefined);
  const [ending, setEnding] = useState<ContractView | null>(null);

  const rows = useMemo(() => sortContracts(contracts), [contracts]);
  const alerts = useMemo(() => contractAlerts(contracts), [contracts]);
  const missing = useMemo(
    () => driversWithoutContract(drivers, contracts.map((c) => ({ driverId: c.driverId, status: c.status }))),
    [drivers, contracts],
  );
  // 法令上、締結済みの契約書は保管が必要（終了した契約は除いて促す）
  const noFile = useMemo(() => contracts.filter((c) => c.status !== "ended" && !isStoredContractFile(c.filePath)), [contracts]);

  const openCreate = (driverId?: string) => {
    setCreateDriverId(driverId);
    setCreating(true);
  };

  return (
    <div className="space-y-4">
      {/* 更新時期・期間切れ */}
      {(alerts.expired.length > 0 || alerts.renewal.length > 0) && (
        <Alert variant={alerts.expired.length > 0 ? "destructive" : "warning"}>
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4" />
            確認が必要な契約 {alerts.expired.length + alerts.renewal.length} 件
          </p>
          <ul className="mt-1.5 space-y-1">
            {[...alerts.expired, ...alerts.renewal].map((c) => (
              <li key={c.id} className="text-sm">
                <button type="button" onClick={() => setEditing(c)} className="text-left underline-offset-2 hover:underline">
                  {c.driverName}：{c.title} — {contractAlertText(c)}
                  {c.autoRenew ? "（自動更新）" : ""}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {noFile.length > 0 && (
        <Alert variant="warning">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4" />
            契約書ファイルが未登録の契約 {noFile.length} 件
          </p>
          <p className="mt-1 text-sm">
            締結済みの業務委託契約書は書面（写し）の保管が必要です。契約を開いて、スキャンや写真をアップロードしてください。
          </p>
          <ul className="mt-1.5 space-y-1">
            {noFile.map((c) => (
              <li key={c.id} className="text-sm">
                <button type="button" onClick={() => setEditing(c)} className="text-left underline-offset-2 hover:underline">
                  {c.driverName}：{c.title}
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          契約 <span className="num font-semibold text-foreground">{contracts.length}</span> 件
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => openCreate()}>
            <Plus /> 契約を追加
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty title="まだ契約が登録されていません" description={canEdit ? "「契約を追加」から登録できます。" : "管理者が登録すると表示されます。"}>
          <FileSignature className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：カード表示 */}
          <ul className="space-y-2 md:hidden">
            {rows.map((c) => (
              <li key={c.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{c.driverName}</p>
                    <p className="break-words text-sm text-muted-foreground">{c.title}</p>
                  </div>
                  <PeriodBadge contract={c} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">開始日</dt>
                  <dd className="num text-right">{dateText(c.startOn)}</dd>
                  <dt className="text-muted-foreground">終了日</dt>
                  <dd className="num text-right">{c.endOn ? dateText(c.endOn) : "期限なし"}</dd>
                  <dt className="text-muted-foreground">残り</dt>
                  <dd className={cn("num text-right", c.periodStatus === "expired" && "text-destructive", c.periodStatus === "renewal" && "text-warning")}>{daysLeftText(c)}</dd>
                  <dt className="text-muted-foreground">自動更新</dt>
                  <dd className="text-right">{c.autoRenew ? "あり" : "なし"}</dd>
                  <dt className="text-muted-foreground">契約書</dt>
                  <dd className="text-right">
                    <ContractFileCell contract={c} />
                  </dd>
                </dl>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                    {canEdit ? "編集" : "内容を見る"}
                  </Button>
                  {canEdit && c.status !== "ended" && (
                    <Button size="sm" variant="ghost" onClick={() => setEnding(c)}>
                      終了にする
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {/* PC：一覧表 */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ドライバー</TableHead>
                  <TableHead>契約</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>開始日</TableHead>
                  <TableHead>終了日</TableHead>
                  <TableHead className="text-right">残り</TableHead>
                  <TableHead>自動更新</TableHead>
                  <TableHead>契約書</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap font-medium">{c.driverName}</TableCell>
                    <TableCell className="max-w-[16rem] break-words">{c.title}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        <Badge variant="outline">{CONTRACT_STATUS_LABELS[c.status]}</Badge>
                        <PeriodBadge contract={c} />
                      </span>
                    </TableCell>
                    <TableCell className="num whitespace-nowrap">{dateText(c.startOn)}</TableCell>
                    <TableCell className="num whitespace-nowrap">{c.endOn ? dateText(c.endOn) : "期限なし"}</TableCell>
                    <TableCell className={cn("num whitespace-nowrap text-right", c.periodStatus === "expired" && "text-destructive", c.periodStatus === "renewal" && "text-warning")}>
                      {daysLeftText(c)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{c.autoRenew ? "あり" : "なし"}</TableCell>
                    <TableCell className="max-w-[14rem] whitespace-nowrap">
                      <ContractFileCell contract={c} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <span className="inline-flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                          {canEdit ? "編集" : "内容"}
                        </Button>
                        {canEdit && c.status !== "ended" && (
                          <Button size="sm" variant="ghost" onClick={() => setEnding(c)}>
                            終了にする
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* 契約が無い稼働中のドライバー */}
      {missing.length > 0 && (
        <div className="rounded-lg border border-dashed p-3">
          <p className="font-medium">契約が無い稼働中のドライバー（{missing.length} 人）</p>
          <p className="mt-1 text-sm text-muted-foreground">業務委託契約を登録してください。</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {missing.map((d) => (
              <li key={d.id}>
                {canEdit ? (
                  <Button size="sm" variant="outline" onClick={() => openCreate(d.id)}>
                    <Plus /> {d.name}
                  </Button>
                ) : (
                  <Badge variant="secondary">{d.name}</Badge>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ダイアログ（閲覧者は保存できないが、内容は確認できる） */}
      {canEdit && (
        <>
          <ContractDialog open={creating} onOpenChange={setCreating} drivers={drivers} today={today} defaultDriverId={createDriverId} />
          {editing && <ContractDialog key={editing.id} open onOpenChange={(v) => !v && setEditing(null)} contract={editing} drivers={drivers} today={today} />}
          {ending && <EndContractDialog key={ending.id} open onOpenChange={(v) => !v && setEnding(null)} contract={ending} today={today} />}
        </>
      )}
      {!canEdit && <ContractReadOnlyDialog contract={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** 閲覧者向け：内容だけを見る（編集はできない） */
function ContractReadOnlyDialog({ contract, onClose }: { contract: ContractView | null; onClose: () => void }) {
  return (
    <Dialog open={contract != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{contract ? `${contract.driverName}：${contract.title}` : "契約"}</DialogTitle>
          <DialogDescription>内容の変更は管理者のみ行えます。</DialogDescription>
        </DialogHeader>
        {contract && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">状態</dt>
            <dd className="text-right">
              {CONTRACT_STATUS_LABELS[contract.status]}／{periodLabel(contract.periodStatus)}
            </dd>
            <dt className="text-muted-foreground">期間</dt>
            <dd className="text-right">
              {dateText(contract.startOn)} 〜 {contract.endOn ? dateText(contract.endOn) : "期限なし"}
            </dd>
            <dt className="text-muted-foreground">残り</dt>
            <dd className="num text-right">{daysLeftText(contract)}</dd>
            <dt className="text-muted-foreground">自動更新</dt>
            <dd className="text-right">{contract.autoRenew ? "あり" : "なし"}</dd>
            <dt className="text-muted-foreground">通知日数</dt>
            <dd className="num text-right">{contract.noticeDays} 日</dd>
            <dt className="text-muted-foreground">契約書</dt>
            <dd className="text-right">
              <ContractFileCell contract={contract} />
            </dd>
            <dt className="text-muted-foreground">備考</dt>
            <dd className="break-words text-right">{contract.memo || "—"}</dd>
          </dl>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
