"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, UserCog, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { inviteUserAction, setUserActiveAction, updateUserRoleAction, type InvitationResult } from "@/lib/actions/users";
import { ROLE_LABELS, type Role } from "@/lib/db/types";
import { formatDateTimeJa } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { InviteResultDialog } from "./invite-link";
import type { DriverOption } from "./invite-dialog";

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  driverId: string | null;
  driverName: string | null;
  isActive: boolean;
  lastSignInAt: string | null;
  createdAt: string;
}

const ROLES: Role[] = ["owner", "admin", "viewer", "driver"];

function RoleBadge({ role }: { role: Role }) {
  const variant = role === "owner" ? "default" : role === "admin" ? "success" : role === "driver" ? "outline" : "secondary";
  return <Badge variant={variant}>{ROLE_LABELS[role]}</Badge>;
}

export function UsersTable({ rows, drivers, selfId, lastSignInAvailable }: { rows: UserRow[]; drivers: DriverOption[]; selfId: string; lastSignInAvailable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [roleTarget, setRoleTarget] = useState<UserRow | null>(null);
  const [role, setRole] = useState<Role>("admin");
  const [driverId, setDriverId] = useState("");
  const [activeTarget, setActiveTarget] = useState<UserRow | null>(null);
  const [linkResult, setLinkResult] = useState<InvitationResult | null>(null);

  const openRole = (u: UserRow) => {
    setRole(u.role);
    setDriverId(u.driverId ?? "");
    setRoleTarget(u);
  };

  const saveRole = () => {
    if (!roleTarget) return;
    const target = roleTarget;
    startTransition(async () => {
      const res = await updateUserRoleAction(target.id, role, role === "driver" ? driverId : null);
      if (res.ok) {
        setRoleTarget(null);
        toast.success(res.message ?? "ロールを変更しました。");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const toggleActive = (u: UserRow) => {
    startTransition(async () => {
      const res = await setUserActiveAction(u.id, !u.isActive);
      if (res.ok) {
        setActiveTarget(null);
        toast.success(res.message ?? "更新しました。");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const reissueLink = (u: UserRow) => {
    startTransition(async () => {
      const res = await inviteUserAction({ email: u.email, role: u.role, driverId: u.driverId, displayName: u.displayName, sendEmail: false });
      if (res.ok) {
        setLinkResult(res.data);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const selectableDrivers = (current: string | null) => drivers.filter((d) => d.isActive || d.id === current);

  const actionButtons = (u: UserRow) => {
    const self = u.id === selfId;
    return (
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => openRole(u)} disabled={pending || self} title={self ? "自分自身のロールは変更できません" : undefined}>
          <UserCog /> ロール変更
        </Button>
        {u.isActive ? (
          <Button size="sm" variant="outline" onClick={() => setActiveTarget(u)} disabled={pending || self} title={self ? "自分自身は無効化できません" : undefined}>
            <UserMinus /> 無効化
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => toggleActive(u)} disabled={pending || self}>
            <UserPlus /> 有効化
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => reissueLink(u)} disabled={pending} title="招待リンクを再発行して直接送れます（未ログインの人向け）">
          <Link2 /> 招待リンク
        </Button>
      </div>
    );
  };

  const lastSignIn = (u: UserRow) => {
    if (!lastSignInAvailable) return <span className="text-muted-foreground">—</span>;
    if (!u.lastSignInAt) return <Badge variant="warning">未ログイン</Badge>;
    return <span className="num">{formatDateTimeJa(u.lastSignInAt)}</span>;
  };

  return (
    <>
      {rows.length === 0 ? (
        <Empty title="ユーザーがいません" />
      ) : (
        <>
          {/* スマホ：カード */}
          <div className="space-y-2 md:hidden">
            {rows.map((u) => (
              <Card key={u.id} className={cn("p-3", !u.isActive && "bg-muted/40 text-muted-foreground")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {u.displayName || "（表示名なし）"}
                      {u.id === selfId && <span className="ml-1 text-xs font-normal text-muted-foreground">（自分）</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <RoleBadge role={u.role} />
                    {u.isActive ? <Badge variant="success">有効</Badge> : <Badge variant="destructive">無効</Badge>}
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  {u.role === "driver" && (
                    <>
                      <dt className="text-muted-foreground">対応ドライバー</dt>
                      <dd className="text-right">{u.driverName ?? "（未設定）"}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">最終ログイン</dt>
                  <dd className="text-right">{lastSignIn(u)}</dd>
                </dl>
                <div className="mt-3">{actionButtons(u)}</div>
              </Card>
            ))}
          </div>

          {/* PC：表 */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>メール</TableHead>
                  <TableHead>表示名</TableHead>
                  <TableHead>ロール</TableHead>
                  <TableHead>対応ドライバー</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>最終ログイン</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => (
                  <TableRow key={u.id} className={cn(!u.isActive && "bg-muted/40 text-muted-foreground")}>
                    <TableCell className="max-w-[16rem] truncate" title={u.email}>
                      {u.email}
                    </TableCell>
                    <TableCell>
                      {u.displayName || "（表示名なし）"}
                      {u.id === selfId && <span className="ml-1 text-xs text-muted-foreground">（自分）</span>}
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={u.role} />
                    </TableCell>
                    <TableCell>{u.role === "driver" ? (u.driverName ?? "（未設定）") : "—"}</TableCell>
                    <TableCell>{u.isActive ? <Badge variant="success">有効</Badge> : <Badge variant="destructive">無効</Badge>}</TableCell>
                    <TableCell className="whitespace-nowrap">{lastSignIn(u)}</TableCell>
                    <TableCell>{actionButtons(u)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* ロール変更 */}
      <Dialog open={roleTarget != null} onOpenChange={(o) => !o && !pending && setRoleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ロールを変更</DialogTitle>
            <DialogDescription>{roleTarget ? `${roleTarget.displayName || roleTarget.email}（${roleTarget.email}）` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="role-select">ロール</Label>
              <Select id="role-select" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={pending}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            {role === "driver" && (
              <div className="space-y-1.5">
                <Label htmlFor="role-driver">対応ドライバー</Label>
                <Select id="role-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={pending}>
                  <option value="">選択してください</option>
                  {selectableDrivers(roleTarget?.driverId ?? null).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {!d.isActive ? "（停止中）" : ""}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleTarget(null)} disabled={pending}>
              キャンセル
            </Button>
            <Button onClick={saveRole} disabled={pending || (role === "driver" && !driverId)}>
              {pending ? "保存中…" : "変更する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 無効化の確認 */}
      <ConfirmDialog
        open={activeTarget != null}
        onOpenChange={(o) => !o && setActiveTarget(null)}
        title="ユーザーを無効にしますか？"
        description={activeTarget ? `${activeTarget.displayName || activeTarget.email}（${activeTarget.email}）はログインしてもデータにアクセスできなくなります。あとから有効に戻せます。` : undefined}
        confirmLabel="無効にする"
        destructive
        pending={pending}
        onConfirm={() => activeTarget && toggleActive(activeTarget)}
      />

      <InviteResultDialog result={linkResult} onClose={() => setLinkResult(null)} title="招待リンクを再発行しました" />
    </>
  );
}
