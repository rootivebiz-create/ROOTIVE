"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, PlugZap, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDateTimeJa } from "@/lib/format";
import { saveLineSettingsAction, sendLineTestAction, testLineAction } from "@/lib/actions/integrations";
import type { IntegrationView, LineConfig, LineSecretsMask, LinkedPerson } from "@/lib/integrations/types";
import { CopyField } from "./copy-field";
import { LinkedPeople } from "./linked-people";
import { SetupSteps } from "./setup-steps";

const STEPS = [
  "LINE Developers（developers.line.biz）でプロバイダーを作り、Messaging API のチャネルを作る",
  "「Messaging API設定」でチャネルアクセストークン（長期）を発行し、この画面に貼り付ける",
  "「チャネル基本設定」のチャネルシークレットも貼り付けて保存する",
  "「Messaging API設定」の Webhook URL に下の URL を貼り付け、「Webhookの利用」をオンにする",
  "同じ画面の「応答メッセージ」をオフにする（自動の定型返信が混ざらないようにする）",
  "この画面の「接続テスト」で Bot の表示名が出れば設定完了",
];

function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5 shrink-0" />
    </div>
  );
}

export interface LineCardProps {
  /** owner のみ編集できる */
  canEdit: boolean;
  status: IntegrationView;
  config: LineConfig;
  /** 保存済みの機密はマスクした文字列のみ（生の値は画面に渡さない） */
  mask: LineSecretsMask;
  webhookUrl: string;
  people: LinkedPerson[];
  /** SUPABASE_SERVICE_ROLE_KEY が無いと保存できない */
  secretsAvailable: boolean;
}

/** 外部連携：LINE 公式アカウント */
export function LineCard({ canEdit, status, config, mask, webhookUrl, people, secretsAvailable }: LineCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [channelAccessToken, setChannelAccessToken] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [notifyStatement, setNotifyStatement] = useState(config.notifyStatement);
  const [notifyAlerts, setNotifyAlerts] = useState(config.notifyAlerts);

  const disabled = !canEdit || pending || !secretsAvailable;

  const save = () => {
    startTransition(async () => {
      const res = await saveLineSettingsAction({ channelAccessToken, channelSecret, notifyStatement, notifyAlerts });
      if (res.ok) {
        toast.success(res.message ?? "保存しました。");
        setChannelAccessToken("");
        setChannelSecret("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const test = () => {
    startTransition(async () => {
      const res = await testLineAction();
      if (res.ok) toast.success(res.data.displayName ? `接続できました（${res.data.displayName}）` : "接続できました。");
      else toast.error(res.error);
      // 成功・失敗どちらでも状態（最終成功・エラー）が変わるので読み直す
      router.refresh();
    });
  };

  const sendTest = () => {
    startTransition(async () => {
      const res = await sendLineTestAction();
      if (res.ok) toast.success(res.message ?? "テスト送信しました。");
      else toast.error(res.error);
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <CardTitle>LINE 公式アカウント</CardTitle>
          {status.isEnabled ? <Badge variant="success">接続済み</Badge> : <Badge variant="secondary">未設定</Badge>}
          {config.botName && <span className="text-xs text-muted-foreground">{config.botName}</span>}
        </div>
        <CardDescription>
          支払明細ができたことや重要なお知らせを LINE で送ります。ドライバーは合言葉（6 桁）を公式アカウントに送るだけで連携できます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!secretsAvailable && <Alert variant="warning">SUPABASE_SERVICE_ROLE_KEY が設定されていないため、トークンの保存・読み出しができません。</Alert>}
        {status.lastError && <Alert variant="destructive">{status.lastError}</Alert>}
        {status.lastOkAt && <p className="text-xs text-muted-foreground">最終成功: {formatDateTimeJa(status.lastOkAt)}</p>}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="line-token">チャネルアクセストークン（長期）</Label>
            <Input
              id="line-token"
              type="password"
              autoComplete="off"
              value={channelAccessToken}
              onChange={(e) => setChannelAccessToken(e.target.value)}
              placeholder={mask.channelAccessToken || "未設定"}
              disabled={disabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="line-secret">チャネルシークレット</Label>
            <Input
              id="line-secret"
              type="password"
              autoComplete="off"
              value={channelSecret}
              onChange={(e) => setChannelSecret(e.target.value)}
              placeholder={mask.channelSecret || "未設定"}
              disabled={disabled}
            />
          </div>
          <p className="text-xs text-muted-foreground">保存済みの値は伏せて表示しています。変更しないときは空のままにしてください。</p>
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <ToggleRow
            id="line-notify-statement"
            label="支払明細ができたとき"
            description="月を締めたあと、ドライバーへお支払額と振込予定日を送ります。"
            checked={notifyStatement}
            onChange={setNotifyStatement}
            disabled={disabled}
          />
          <ToggleRow
            id="line-notify-alerts"
            label="重要なアラート"
            description="採算の急な悪化など、重要なお知らせをスタッフへ送ります。"
            checked={notifyAlerts}
            onChange={setNotifyAlerts}
            disabled={disabled}
          />
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={disabled}>
              <Save /> {pending ? "処理中…" : "保存"}
            </Button>
            <Button variant="outline" onClick={test} disabled={disabled}>
              <PlugZap /> 接続テスト
            </Button>
            <Button variant="outline" onClick={sendTest} disabled={disabled}>
              <Send /> 自分にテスト送信
            </Button>
          </div>
        )}
        {!canEdit && <p className="text-xs text-muted-foreground">設定の変更はオーナーのみ行えます。</p>}

        <CopyField value={webhookUrl} label="Webhook URL" hint="LINE Developers の「Messaging API設定」に貼り付け、「Webhookの利用」をオンにしてください。" />

        <div className="space-y-2">
          <p className="text-sm font-medium">連携している人</p>
          <LinkedPeople people={people} />
        </div>

        <SetupSteps title="設定の手順（LINE Developers）" steps={STEPS} note="チャネルアクセストークンは再発行すると古いものが無効になります。再発行したらこの画面でも保存し直してください。" />
      </CardContent>
    </Card>
  );
}
