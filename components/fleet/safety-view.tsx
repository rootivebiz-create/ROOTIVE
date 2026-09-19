"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GraduationCap, Pencil, Plus, ShieldAlert, TriangleAlert, Trash2, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Money } from "@/components/ui/money";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INCIDENT_KIND_LABELS, INSTRUCTION_KIND_LABELS, type DriverInstruction, type Incident, type SafetyManager } from "@/lib/db/types";
import { qty } from "@/lib/format";
import { deleteIncidentAction, deleteInstructionAction, deleteSafetyManagerAction } from "@/lib/actions/fleet";
import { formatDate, formatDateTime, missingInitialInstruction, nextTrainingDue, TRAINING_INTERVAL_YEARS } from "@/lib/fleet/helpers";
import type { InstructionKind } from "@/lib/schemas/fleet";
import { ExpiryBadge } from "./expiry-badge";
import { SafetyManagerDialog } from "./safety-manager-dialog";
import { InstructionDialog } from "./instruction-dialog";
import { IncidentDialog } from "./incident-dialog";
import { nameOf, type ChoiceOption } from "./choices";

export interface SafetyViewProps {
  managers: SafetyManager[];
  instructions: DriverInstruction[];
  incidents: Incident[];
  /** 全ドライバー（停止中も含む。名前の解決にも使う） */
  drivers: ChoiceOption[];
  /** 全車両（name は車両番号） */
  vehicles: ChoiceOption[];
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
  /** 追加・編集ができる（owner/admin） */
  editable: boolean;
}

type DeleteTarget =
  | { kind: "manager"; id: string; name: string }
  | { kind: "instruction"; id: string; name: string }
  | { kind: "incident"; id: string; name: string };

interface ManagerDialogState {
  open: boolean;
  mode: "create" | "edit";
  manager: SafetyManager | null;
}
interface InstructionDialogState {
  open: boolean;
  mode: "create" | "edit";
  instruction: DriverInstruction | null;
  defaultDriverId: string;
  defaultKind: InstructionKind;
}
interface IncidentDialogState {
  open: boolean;
  mode: "create" | "edit";
  incident: Incident | null;
}

/** 安全管理（/settings/safety）。安全管理者・指導監督・事故の 3 つ */
export function SafetyView({ managers, instructions, incidents, drivers, vehicles, today, editable }: SafetyViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [managerDialog, setManagerDialog] = useState<ManagerDialogState>({ open: false, mode: "create", manager: null });
  const [instructionDialog, setInstructionDialog] = useState<InstructionDialogState>({
    open: false,
    mode: "create",
    instruction: null,
    defaultDriverId: "",
    defaultKind: "regular",
  });
  const [incidentDialog, setIncidentDialog] = useState<IncidentDialogState>({ open: false, mode: "create", incident: null });
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const appointed = managers.filter((m) => m.is_active && m.appointed_on);
  const missingInitial = useMemo(() => missingInitialInstruction(drivers, instructions), [drivers, instructions]);
  const driverName = (id: string | null) => (id ? nameOf(drivers, id) || "（削除されたドライバー）" : "—");
  const vehiclePlate = (id: string | null) => (id ? nameOf(vehicles, id) || "（削除された車両）" : "—");

  const runDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      const res =
        target.kind === "manager"
          ? await deleteSafetyManagerAction(target.id)
          : target.kind === "instruction"
            ? await deleteInstructionAction(target.id)
            : await deleteIncidentAction(target.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "削除しました");
      setDeleteTarget(null);
      router.refresh();
    });
  };

  const openInstruction = (driverId: string, kind: InstructionKind) =>
    setInstructionDialog({ open: true, mode: "create", instruction: null, defaultDriverId: driverId, defaultKind: kind });

  return (
    <div className="space-y-6">
      <PageHeader
        title="安全管理"
        description="貨物軽自動車安全管理者の選任、運転者への指導・監督、事故の記録です。2025 年 4 月施行の制度で、いずれも記録を残すことが求められます。"
      />

      {/* 1. 貨物軽自動車安全管理者 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <UserCheck className="h-5 w-5 text-muted-foreground" />
              貨物軽自動車安全管理者
            </h2>
            <p className="text-sm text-muted-foreground">営業所ごとに 1 名以上を選任し、運輸支局へ届け出ます。講習は {TRAINING_INTERVAL_YEARS} 年ごとに受講します。</p>
          </div>
          {editable && (
            <Button onClick={() => setManagerDialog({ open: true, mode: "create", manager: null })}>
              <Plus /> 安全管理者を追加
            </Button>
          )}
        </div>

        {appointed.length === 0 && (
          <Alert variant="destructive">
            <p className="font-semibold">貨物軽自動車安全管理者が選任されていません。</p>
            <p className="mt-1">
              2025 年 4 月施行の制度で、貨物軽自動車運送事業者は営業所ごとに 1 名以上の安全管理者を選任し、運輸支局へ届け出る必要があります（2027 年 3 月末まで猶予）。
              選任には国土交通大臣の認定を受けた講習の受講が必要です。
            </p>
          </Alert>
        )}

        {managers.length === 0 ? (
          <Empty title="まだ安全管理者が登録されていません" description={editable ? "「安全管理者を追加」から選任した人を登録してください。" : "登録された安全管理者はありません。"} />
        ) : (
          <>
            {/* PC：表 */}
            <Card className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>氏名</TableHead>
                    <TableHead>営業所</TableHead>
                    <TableHead>選任日</TableHead>
                    <TableHead>届出日</TableHead>
                    <TableHead>講習受講日</TableHead>
                    <TableHead>次回講習</TableHead>
                    <TableHead>状態</TableHead>
                    {editable && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managers.map((m) => {
                    const due = nextTrainingDue(m, today);
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="text-muted-foreground">{m.office}</TableCell>
                        <TableCell className="num whitespace-nowrap">{formatDate(m.appointed_on)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-muted-foreground">{formatDate(m.notified_on)}</TableCell>
                        <TableCell className="num whitespace-nowrap text-muted-foreground">{formatDate(m.training_on)}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {due.dueOn ? (
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="num">{formatDate(due.dueOn)}</span>
                              <ExpiryBadge status={due.status} daysLeft={due.daysLeft} showDays />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>{m.is_active ? <Badge variant="success">選任中</Badge> : <Badge variant="secondary">解任</Badge>}</TableCell>
                        {editable && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="編集" onClick={() => setManagerDialog({ open: true, mode: "edit", manager: m })}>
                                <Pencil />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                aria-label="削除"
                                onClick={() => setDeleteTarget({ kind: "manager", id: m.id, name: m.name })}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            {/* スマホ：カード */}
            <div className="flex flex-col gap-2 md:hidden">
              {managers.map((m) => {
                const due = nextTrainingDue(m, today);
                return (
                  <Card key={m.id} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{m.name}</p>
                        <p className="text-sm text-muted-foreground">{m.office}</p>
                      </div>
                      {m.is_active ? <Badge variant="success">選任中</Badge> : <Badge variant="secondary">解任</Badge>}
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                      <dt className="text-muted-foreground">選任日</dt>
                      <dd className="num text-right">{formatDate(m.appointed_on)}</dd>
                      <dt className="text-muted-foreground">講習受講日</dt>
                      <dd className="num text-right">{formatDate(m.training_on)}</dd>
                      <dt className="text-muted-foreground">次回講習</dt>
                      <dd className="num text-right">{due.dueOn ? formatDate(due.dueOn) : "—"}</dd>
                    </dl>
                    {due.dueOn && (
                      <p className="mt-1 text-right">
                        <ExpiryBadge status={due.status} daysLeft={due.daysLeft} showDays />
                      </p>
                    )}
                    {editable && (
                      <div className="mt-2 flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setManagerDialog({ open: true, mode: "edit", manager: m })}>
                          <Pencil /> 編集
                        </Button>
                        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setDeleteTarget({ kind: "manager", id: m.id, name: m.name })}>
                          <Trash2 /> 削除
                        </Button>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* 2. 指導・監督の記録 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <GraduationCap className="h-5 w-5 text-muted-foreground" />
              指導・監督の記録
            </h2>
            <p className="text-sm text-muted-foreground">運転者への指導・監督の記録は 3 年間保存します。初任運転者には、運転させる前に特別な指導（15 時間以上）が必要です。</p>
          </div>
          {editable && (
            <Button onClick={() => openInstruction("", "regular")}>
              <Plus /> 指導を記録
            </Button>
          )}
        </div>

        {missingInitial.length > 0 && (
          <Card className="border-warning/40 bg-warning/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TriangleAlert className="h-4 w-4 text-warning" />
                初任運転者の指導が記録されていないドライバーが {missingInitial.length} 人います
              </CardTitle>
              <CardDescription>新しく雇い入れたドライバーには、運転させる前に特別な指導（15 時間以上）と適性診断が必要です。実施したら記録を残してください。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {missingInitial.map((d) =>
                editable ? (
                  <Button key={d.id} variant="outline" size="sm" onClick={() => openInstruction(d.id, "initial")}>
                    <Plus /> {d.name} の初任指導を記録
                  </Button>
                ) : (
                  <Badge key={d.id} variant="outline">
                    {d.name}
                  </Badge>
                ),
              )}
            </CardContent>
          </Card>
        )}

        {instructions.length === 0 ? (
          <Empty title="まだ指導・監督の記録がありません" description={editable ? "「指導を記録」から実施した指導を登録してください。" : "登録された記録はありません。"} />
        ) : (
          <>
            {/* PC：表 */}
            <Card className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>実施日</TableHead>
                    <TableHead>ドライバー</TableHead>
                    <TableHead>種類</TableHead>
                    <TableHead className="text-right">時間</TableHead>
                    <TableHead>内容</TableHead>
                    <TableHead>実施者</TableHead>
                    {editable && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {instructions.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="num whitespace-nowrap">{formatDate(i.instructed_on)}</TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{driverName(i.driver_id)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={i.kind === "initial" ? "default" : "secondary"}>{INSTRUCTION_KIND_LABELS[i.kind] ?? i.kind}</Badge>
                      </TableCell>
                      <TableCell className="num text-right">{qty(i.hours)} 時間</TableCell>
                      <TableCell className="max-w-[20rem] truncate text-muted-foreground" title={i.topics}>
                        {i.topics || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{i.instructor || "—"}</TableCell>
                      {editable && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label="編集"
                              onClick={() => setInstructionDialog({ open: true, mode: "edit", instruction: i, defaultDriverId: "", defaultKind: "regular" })}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              aria-label="削除"
                              onClick={() => setDeleteTarget({ kind: "instruction", id: i.id, name: `${driverName(i.driver_id)}（${formatDate(i.instructed_on)}）の記録` })}
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
              {instructions.map((i) => (
                <Card key={i.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{driverName(i.driver_id)}</p>
                      <p className="num text-sm text-muted-foreground">{formatDate(i.instructed_on)}</p>
                    </div>
                    <Badge variant={i.kind === "initial" ? "default" : "secondary"}>{INSTRUCTION_KIND_LABELS[i.kind] ?? i.kind}</Badge>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-muted-foreground">時間</dt>
                    <dd className="num text-right">{qty(i.hours)} 時間</dd>
                    {i.instructor && (
                      <>
                        <dt className="text-muted-foreground">実施者</dt>
                        <dd className="text-right">{i.instructor}</dd>
                      </>
                    )}
                  </dl>
                  {i.topics && <p className="mt-1 break-words text-sm text-muted-foreground">{i.topics}</p>}
                  {editable && (
                    <div className="mt-2 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setInstructionDialog({ open: true, mode: "edit", instruction: i, defaultDriverId: "", defaultKind: "regular" })}
                      >
                        <Pencil /> 編集
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeleteTarget({ kind: "instruction", id: i.id, name: `${driverName(i.driver_id)}（${formatDate(i.instructed_on)}）の記録` })}
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
      </section>

      {/* 3. 事故・違反・ヒヤリハット */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
              事故・違反・ヒヤリハット
            </h2>
            <p className="text-sm text-muted-foreground">原因と再発防止策まで記録します。ヒヤリハットも残しておくと、同じ事故を防げます。</p>
          </div>
          {editable && (
            <Button onClick={() => setIncidentDialog({ open: true, mode: "create", incident: null })}>
              <Plus /> 事故を記録
            </Button>
          )}
        </div>

        {incidents.length === 0 ? (
          <Empty title="まだ事故の記録がありません" description={editable ? "事故・違反・ヒヤリハットが起きたら記録してください。" : "登録された記録はありません。"} />
        ) : (
          <>
            {/* PC：表 */}
            <Card className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>発生日時</TableHead>
                    <TableHead>種類</TableHead>
                    <TableHead>ドライバー</TableHead>
                    <TableHead>車両</TableHead>
                    <TableHead>場所</TableHead>
                    <TableHead>内容</TableHead>
                    <TableHead>原因</TableHead>
                    <TableHead>再発防止策</TableHead>
                    <TableHead>報告</TableHead>
                    <TableHead className="text-right">費用</TableHead>
                    {editable && <TableHead className="w-24" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {incidents.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="num whitespace-nowrap">{formatDateTime(n.occurred_at)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge variant={n.kind === "accident" ? "destructive" : n.kind === "violation" ? "warning" : "secondary"}>{INCIDENT_KIND_LABELS[n.kind]}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{driverName(n.driver_id)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{vehiclePlate(n.vehicle_id)}</TableCell>
                      <TableCell className="max-w-[10rem] truncate text-muted-foreground" title={n.place}>
                        {n.place || "—"}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate" title={n.description}>
                        {n.description || "—"}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-muted-foreground" title={n.cause}>
                        {n.cause || "—"}
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-muted-foreground" title={n.prevention}>
                        {n.prevention || "—"}
                      </TableCell>
                      <TableCell>{n.reported ? <Badge variant="success">済み</Badge> : <Badge variant="outline">未</Badge>}</TableCell>
                      <TableCell className="text-right">
                        <Money value={n.cost} showZeroAsDash />
                      </TableCell>
                      {editable && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="編集" onClick={() => setIncidentDialog({ open: true, mode: "edit", incident: n })}>
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              aria-label="削除"
                              onClick={() => setDeleteTarget({ kind: "incident", id: n.id, name: `${formatDateTime(n.occurred_at)} の${INCIDENT_KIND_LABELS[n.kind]}` })}
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
              {incidents.map((n) => (
                <Card key={n.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="num font-semibold">{formatDateTime(n.occurred_at)}</p>
                      <p className="text-sm text-muted-foreground">
                        {driverName(n.driver_id)} ・ {vehiclePlate(n.vehicle_id)}
                      </p>
                    </div>
                    <Badge variant={n.kind === "accident" ? "destructive" : n.kind === "violation" ? "warning" : "secondary"}>{INCIDENT_KIND_LABELS[n.kind]}</Badge>
                  </div>
                  {n.place && <p className="mt-1 text-sm text-muted-foreground">場所：{n.place}</p>}
                  {n.description && <p className="mt-1 break-words text-sm">{n.description}</p>}
                  {n.cause && <p className="mt-1 break-words text-sm text-muted-foreground">原因：{n.cause}</p>}
                  {n.prevention && <p className="mt-1 break-words text-sm text-muted-foreground">再発防止：{n.prevention}</p>}
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                    <dt className="text-muted-foreground">報告</dt>
                    <dd className="text-right">{n.reported ? "済み" : "未"}</dd>
                    {Number(n.cost) !== 0 && (
                      <>
                        <dt className="text-muted-foreground">費用</dt>
                        <dd className="text-right">
                          <Money value={n.cost} />
                        </dd>
                      </>
                    )}
                  </dl>
                  {editable && (
                    <div className="mt-2 flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setIncidentDialog({ open: true, mode: "edit", incident: n })}>
                        <Pencil /> 編集
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setDeleteTarget({ kind: "incident", id: n.id, name: `${formatDateTime(n.occurred_at)} の${INCIDENT_KIND_LABELS[n.kind]}` })}
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
      </section>

      {/* 追加・編集ダイアログ */}
      {editable && (
        <>
          <SafetyManagerDialog
            open={managerDialog.open}
            onOpenChange={(open) => setManagerDialog((d) => ({ ...d, open }))}
            mode={managerDialog.mode}
            drivers={drivers}
            manager={managerDialog.manager}
            today={today}
          />
          <InstructionDialog
            open={instructionDialog.open}
            onOpenChange={(open) => setInstructionDialog((d) => ({ ...d, open }))}
            mode={instructionDialog.mode}
            drivers={drivers}
            instruction={instructionDialog.instruction}
            defaultDriverId={instructionDialog.defaultDriverId}
            defaultKind={instructionDialog.defaultKind}
            today={today}
          />
          <IncidentDialog
            open={incidentDialog.open}
            onOpenChange={(open) => setIncidentDialog((d) => ({ ...d, open }))}
            mode={incidentDialog.mode}
            drivers={drivers}
            vehicles={vehicles}
            incident={incidentDialog.incident}
            today={today}
          />
        </>
      )}

      {/* 削除確認 */}
      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && !pending && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleteTarget?.kind === "manager" ? "安全管理者を削除" : deleteTarget?.kind === "instruction" ? "指導・監督の記録を削除" : "事故の記録を削除"}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget && (
                <>
                  {deleteTarget.name} を削除します。この操作は取り消せません。
                  {deleteTarget.kind === "instruction" && "（指導・監督の記録は 3 年間の保存が必要です。誤って登録した記録だけ削除してください。）"}
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
