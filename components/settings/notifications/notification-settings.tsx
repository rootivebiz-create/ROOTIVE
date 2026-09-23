"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DeviceNotificationCard } from "./device-card";
import { NOTIFY_CHAT_LABELS, type NotifyChatMode } from "@/lib/push/targets";
import { setNotifyPrefsAction } from "@/lib/actions/push";

export interface NotificationSettingsProps {
  /** いまの受け取り方 */
  notifyChat: NotifyChatMode;
  notifyLine: boolean;
  /** LINE 公式アカウントと連携済みか */
  lineLinked: boolean;
  /** この環境でプッシュ通知を使えるか（VAPID の公開鍵があるか） */
  pushConfigured: boolean;
  vapidPublicKey: string;
  /** 登録済みの端末（自分のものだけ） */
  devices: { id: string; label: string; createdAt: string }[];
}

const MODES: NotifyChatMode[] = ["all", "mention", "off"];

export function NotificationSettings({ notifyChat, notifyLine, lineLinked, pushConfigured, vapidPublicKey, devices }: NotificationSettingsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<NotifyChatMode>(notifyChat);
  const [line, setLine] = useState(notifyLine);

  const savePrefs = () => {
    startTransition(async () => {
      const res = await setNotifyPrefsAction({ notify_chat: mode, notify_line: line });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
    });
  };

  const dirty = mode !== notifyChat || line !== notifyLine;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <DeviceNotificationCard pushConfigured={pushConfigured} vapidPublicKey={vapidPublicKey} devices={devices} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" /> 受け取り方
          </CardTitle>
          <CardDescription>チャットの通知をどこまで受け取るかを決めます。すべての端末に共通の設定です。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">チャットの通知</legend>
            {MODES.map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="notify-chat"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                <span>{NOTIFY_CHAT_LABELS[m]}</span>
                {m === "mention" && <span className="text-xs text-muted-foreground">（おすすめ）</span>}
              </label>
            ))}
          </fieldset>

          <div className="space-y-1.5 border-t pt-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={line} onCheckedChange={(v) => setLine(v === true)} aria-label="自分あての発言を LINE にも送る" />
              自分あての発言を LINE にも送る
            </label>
            {!lineLinked && (
              <p className="text-xs text-muted-foreground">
                まだ LINE 公式アカウントと連携していません。下の「LINE で受け取る」で合言葉を出して連携すると届くようになります。
              </p>
            )}
          </div>

          <div>
            <Button onClick={savePrefs} disabled={pending || !dirty}>
              {pending ? <Loader2 className="animate-spin" /> : null} 保存
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">稼働報告の承認・差戻しの結果は、この設定に関わらずドライバー本人へ届きます。</p>
        </CardContent>
      </Card>
    </div>
  );
}
