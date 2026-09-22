"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, BellOff, Loader2, Send, Smartphone } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  currentSubscription,
  deviceLabel,
  isIos,
  isStandalone,
  permissionState,
  pushSupported,
  subscribeToPush,
  subscriptionToInput,
  unsubscribeFromPush,
} from "@/lib/push/client";
import { deletePushSubscriptionAction, savePushSubscriptionAction, sendTestPushAction } from "@/lib/actions/push";

export interface DeviceNotificationCardProps {
  /** この環境でプッシュ通知を使えるか（VAPID の公開鍵があるか） */
  pushConfigured: boolean;
  vapidPublicKey: string;
  /** 登録済みの端末（自分のものだけ） */
  devices: { id: string; label: string; createdAt: string }[];
  description?: string;
}

/** 端末の状態 */
type DeviceState = "loading" | "unsupported" | "needs-home-screen" | "denied" | "subscribed" | "off";

/**
 * 「この端末で通知を受け取る」カード（スタッフの設定画面とドライバーのアカウント画面で共用）
 *
 * 許可を求めるのはボタンを押したときだけ。一度断られると設定から戻すまで聞き直せないため。
 */
export function DeviceNotificationCard({ pushConfigured, vapidPublicKey, devices, description }: DeviceNotificationCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<DeviceState>("loading");
  const [busy, setBusy] = useState(false);

  const refreshState = useCallback(async () => {
    if (!pushSupported()) {
      setState("unsupported");
      return;
    }
    const ua = navigator.userAgent;
    if (isIos(ua) && !isStandalone()) {
      setState("needs-home-screen");
      return;
    }
    if (permissionState() === "denied") {
      setState("denied");
      return;
    }
    const sub = await currentSubscription();
    setState(sub ? "subscribed" : "off");
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const subscribe = () => {
    setBusy(true);
    void (async () => {
      try {
        const sub = await subscribeToPush(vapidPublicKey);
        const res = await savePushSubscriptionAction({
          ...subscriptionToInput(sub),
          user_agent: navigator.userAgent.slice(0, 300),
          label: deviceLabel(navigator.userAgent),
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(res.message ?? "この端末で通知を受け取ります");
        await refreshState();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "通知を設定できませんでした。");
        await refreshState();
      } finally {
        setBusy(false);
      }
    })();
  };

  const unsubscribe = () => {
    setBusy(true);
    void (async () => {
      try {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) {
          const res = await deletePushSubscriptionAction(endpoint);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
        }
        toast.success("この端末の通知をやめました");
        await refreshState();
        router.refresh();
      } finally {
        setBusy(false);
      }
    })();
  };

  const sendTest = () => {
    startTransition(async () => {
      const res = await sendTestPushAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "テストの通知を送りました");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-4 w-4" /> この端末の通知
        </CardTitle>
        <CardDescription>{description ?? "アプリを開いていなくても、端末に通知が出るようにします。端末ごとに設定します。"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!pushConfigured ? (
          <Alert>この環境では端末への通知をまだ使えません（通知の鍵が未設定です）。LINE への通知とアプリ内のお知らせは使えます。</Alert>
        ) : state === "loading" ? (
          <p className="text-sm text-muted-foreground">確認しています…</p>
        ) : state === "unsupported" ? (
          <Alert>このブラウザは通知に対応していません。Safari・Chrome の最新版でお試しください。</Alert>
        ) : state === "needs-home-screen" ? (
          <Alert variant="warning">
            iPhone・iPad で通知を受け取るには、先に<strong>ホーム画面に追加</strong>してください。 共有ボタン →
            「ホーム画面に追加」→ 追加したアイコンから開き直すと、ここに設定のボタンが出ます。
          </Alert>
        ) : state === "denied" ? (
          <Alert variant="destructive">
            通知がブロックされています。ブラウザの設定（サイトの設定 → 通知）でこのサイトを「許可」にしてから、もう一度お試しください。
          </Alert>
        ) : state === "subscribed" ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              <Badge variant="success">受け取る</Badge> この端末は通知を受け取ります。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={sendTest} disabled={pending || busy}>
                {pending ? <Loader2 className="animate-spin" /> : <Send />} テスト通知を送る
              </Button>
              <Button variant="ghost" onClick={unsubscribe} disabled={busy}>
                <BellOff /> この端末では受け取らない
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">この端末はまだ通知を受け取りません。</p>
            <Button onClick={subscribe} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Bell />} この端末で通知を受け取る
            </Button>
          </>
        )}

        {devices.length > 0 && (
          <div className="border-t pt-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">通知を受け取る端末（{devices.length} 台）</p>
            <ul className="space-y-1 text-sm">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{d.label || "端末"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{d.createdAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
