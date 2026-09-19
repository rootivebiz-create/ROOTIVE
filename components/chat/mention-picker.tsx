"use client";

import { useMemo, useState } from "react";
import { AtSign } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import type { ChatStaff } from "@/lib/chat/helpers";

/**
 * メンションの相手を選ぶ（入力欄の「@」ボタン）
 * 選ぶと入力欄へ「@表示名 」を差し込む（差し込み位置の計算は message-composer 側）。
 */
export function MentionPicker({
  staff,
  onSelect,
  disabled,
}: {
  staff: ChatStaff[];
  /** 選ばれたスタッフの表示名 */
  onSelect: (name: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");

  const list = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    const active = staff.filter((s) => s.isActive);
    if (k === "") return active;
    return active.filter((s) => s.name.toLowerCase().includes(k) || s.email.toLowerCase().includes(k));
  }, [staff, keyword]);

  const pick = (name: string) => {
    onSelect(name);
    setOpen(false);
    setKeyword("");
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-10 w-10 shrink-0"
        onClick={() => setOpen(true)}
        disabled={disabled || staff.length === 0}
        aria-label="宛先を選ぶ"
        title="宛先を選ぶ"
      >
        <AtSign />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>宛先を選ぶ</DialogTitle>
            <DialogDescription>選んだ人の名前を本文へ差し込みます（@名前）。相手の画面では自分宛の発言として目立ちます。</DialogDescription>
          </DialogHeader>
          <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="名前で絞り込む" autoFocus aria-label="名前で絞り込む" />
          {list.length === 0 ? (
            <Empty title="該当するスタッフがいません" description="別の名前で探してください。" />
          ) : (
            <ul className="max-h-[50dvh] divide-y overflow-y-auto rounded-lg border">
              {list.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left hover:bg-muted"
                    onClick={() => pick(s.name)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{s.name}</span>
                      {s.email !== "" && <span className="block truncate text-xs text-muted-foreground">{s.email}</span>}
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      {s.roleLabel}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
