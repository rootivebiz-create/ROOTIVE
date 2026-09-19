"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createChannelSchema, updateChannelSchema } from "@/lib/schemas/chat";
import { createChannelAction, updateChannelAction } from "@/lib/actions/chat";
import type { ChatChannelItem } from "@/lib/chat/helpers";

type FieldErrors = Record<string, string[]>;

function toFieldErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export interface ChannelDialogProps {
  /** 渡すと編集、省略すると追加 */
  channel?: Pick<ChatChannelItem, "id" | "name" | "description" | "isActive">;
  /** ボタンの見た目（一覧の見出しでは小さく出す） */
  size?: "sm" | "default";
  className?: string;
}

/** ルームの追加・編集（admin 以上の画面からのみ描画する） */
export function ChannelDialog({ channel, size = "default", className }: ChannelDialogProps) {
  const [open, setOpen] = useState(false);
  const editing = channel != null;
  return (
    <>
      {editing ? (
        <Button type="button" variant="outline" size={size} className={className} onClick={() => setOpen(true)}>
          <Pencil />
          ルームの設定
        </Button>
      ) : (
        <Button type="button" size={size} className={className} onClick={() => setOpen(true)}>
          <Plus />
          ルームを追加
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "ルームの設定" : "ルームを追加"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "ルーム名と説明を変更できます。使わなくなったルームは「一覧に表示する」をオフにすると隠せます（発言は残ります）。"
                : "話題ごとにルームを分けられます（例: 全体、経営、現場）。ルーム名は会社の中で重複できません。"}
            </DialogDescription>
          </DialogHeader>
          {open && <ChannelForm channel={channel} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChannelForm({ channel, onClose }: { channel?: ChannelDialogProps["channel"]; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(channel?.name ?? "");
  const [description, setDescription] = useState(channel?.description ?? "");
  const [isActive, setIsActive] = useState(channel?.isActive ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = () => {
    const parsed = channel
      ? updateChannelSchema.safeParse({ id: channel.id, name, description, is_active: isActive })
      : createChannelSchema.safeParse({ name, description });
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = channel
        ? await updateChannelAction(channel.id, { name, description, is_active: isActive })
        : await createChannelAction(name, description);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="channel-name">ルーム名</Label>
        <Input
          id="channel-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 現場"
          maxLength={60}
          disabled={pending}
          aria-invalid={!!errors.name}
          autoFocus
        />
        {errors.name?.[0] && <p className="text-xs text-destructive">{errors.name[0]}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="channel-description">説明（任意）</Label>
        <Input
          id="channel-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="例: 当日の連絡・引き継ぎ"
          maxLength={200}
          disabled={pending}
          aria-invalid={!!errors.description}
        />
        {errors.description?.[0] && <p className="text-xs text-destructive">{errors.description[0]}</p>}
      </div>
      {channel && (
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">一覧に表示する</p>
            <p className="text-xs text-muted-foreground">オフにすると一覧から隠れます（発言は残ります）。</p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} disabled={pending} aria-label="一覧に表示する" />
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          キャンセル
        </Button>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "保存中…" : "保存"}
        </Button>
      </DialogFooter>
    </div>
  );
}
