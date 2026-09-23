"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { inviteUserAction, type InvitationResult } from "@/lib/actions/users";
import { ROLE_SUMMARIES } from "@/lib/auth/access";
import { ROLE_LABELS, type Role } from "@/lib/db/types";
import { InviteResultDialog } from "./invite-link";

export interface DriverOption {
  id: string;
  name: string;
  isActive: boolean;
}

const ROLES: Role[] = ["admin", "clerk", "viewer", "driver", "owner"];

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

/** 「＋ ユーザーを招待」ダイアログ */
export function InviteDialog({ drivers }: { drivers: DriverOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<InvitationResult | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("admin");
  const [driverId, setDriverId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [sendEmail, setSendEmail] = useState(true);

  const activeDrivers = drivers.filter((d) => d.isActive);

  const reset = () => {
    setEmail("");
    setRole("admin");
    setDriverId("");
    setDisplayName("");
    setSendEmail(true);
    setErrors({});
  };

  const submit = () =>
    startTransition(async () => {
      const res = await inviteUserAction({ email, role, driverId: role === "driver" ? driverId : null, displayName, sendEmail });
      if (res.ok) {
        setErrors({});
        toast.success(res.message ?? "招待を作成しました。");
        setOpen(false);
        reset();
        setResult(res.data);
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> ユーザーを招待
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ユーザーを招待</DialogTitle>
            <DialogDescription>招待リンクを発行します。メールが届かない場合はリンクを直接送れます（有効期限 7 日）。</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">メールアドレス</Label>
              <Input id="invite-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="driver@example.com" disabled={pending} />
              <FieldError messages={errors.email} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">ロール</Label>
              <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={pending}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_SUMMARIES[role]}</p>
              <FieldError messages={errors.role} />
            </div>
            {role === "driver" && (
              <div className="space-y-1.5">
                <Label htmlFor="invite-driver">対応ドライバー</Label>
                <Select id="invite-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} required disabled={pending}>
                  <option value="">選択してください</option>
                  {activeDrivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                {activeDrivers.length === 0 && <p className="text-xs text-warning">稼働中のドライバーがありません。先にドライバーを登録してください。</p>}
                <FieldError messages={errors.driverId} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">表示名（任意）</Label>
              <Input id="invite-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} placeholder="例: 山田 太郎" disabled={pending} />
              <FieldError messages={errors.displayName} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="invite-send" checked={sendEmail} onCheckedChange={(v) => setSendEmail(v === true)} disabled={pending} />
              <Label htmlFor="invite-send">招待メールも送る</Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                キャンセル
              </Button>
              <Button type="submit" disabled={pending || (role === "driver" && !driverId)}>
                <Send /> {pending ? "招待中…" : "招待する"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <InviteResultDialog result={result} onClose={() => setResult(null)} title="招待リンクを発行しました" />
    </>
  );
}
