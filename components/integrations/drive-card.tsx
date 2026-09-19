"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, HardDriveUpload, PlugZap, Save } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatDateTimeJa } from "@/lib/format";
import { backupToDriveAction, saveDriveSettingsAction, testDriveAction } from "@/lib/actions/integrations";
import { DRIVE_SECRET_LABELS, type DriveConfig, type DriveSecretKey, type DriveSecretsMask, type IntegrationView } from "@/lib/integrations/types";
import { SetupSteps } from "./setup-steps";

const STEPS = [
  "Google Cloud（console.cloud.google.com）でプロジェクトを作る",
  "「APIとサービス」→「ライブラリ」で Google Drive API を有効にする",
  "「OAuth同意画面」を設定し、自分のアカウントをテストユーザーに追加する",
  "「認証情報」→「OAuth クライアント ID」をアプリの種類「デスクトップ」で作る（クライアント ID とシークレットを控える）",
  "OAuth 2.0 Playground（developers.google.com/oauthplayground）の設定で自分のクライアント ID・シークレットを使い、スコープ https://www.googleapis.com/auth/drive.file を許可してリフレッシュトークンを取得する",
  "Google ドライブで保存先フォルダを開き、URL の末尾（folders/ の後ろ）をフォルダ ID として貼り付ける",
  "この画面の「接続テスト」でフォルダ名が出れば設定完了",
];

const KEYS: DriveSecretKey[] = ["clientId", "clientSecret", "refreshToken", "folderId"];

export interface DriveCardProps {
  canEdit: boolean;
  status: IntegrationView;
  config: DriveConfig;
  /** 保存済みの機密はマスクした文字列のみ */
  mask: DriveSecretsMask;
  secretsAvailable: boolean;
}

/** 外部連携：Google ドライブ（バックアップ JSON の保存先） */
export function DriveCard({ canEdit, status, config, mask, secretsAvailable }: DriveCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<DriveSecretKey, string>>({ clientId: "", clientSecret: "", refreshToken: "", folderId: "" });
  const [autoBackup, setAutoBackup] = useState(config.autoBackup);

  const disabled = !canEdit || pending || !secretsAvailable;
  const setValue = (key: DriveSecretKey, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const save = () => {
    startTransition(async () => {
      const res = await saveDriveSettingsAction({ ...values, autoBackup });
      if (res.ok) {
        toast.success(res.message ?? "保存しました。");
        setValues({ clientId: "", clientSecret: "", refreshToken: "", folderId: "" });
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const test = () => {
    startTransition(async () => {
      const res = await testDriveAction();
      if (res.ok) toast.success(res.data.folderName ? `接続できました（${res.data.folderName}）` : "接続できました。");
      else toast.error(res.error);
      router.refresh();
    });
  };

  const backup = () => {
    startTransition(async () => {
      const res = await backupToDriveAction();
      if (res.ok) toast.success(`Google ドライブに保存しました（${res.data.fileName}）`);
      else toast.error(res.error);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CloudUpload className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Google ドライブ</CardTitle>
          {status.isEnabled ? <Badge variant="success">接続済み</Badge> : <Badge variant="secondary">未設定</Badge>}
          {config.folderName && <span className="text-xs text-muted-foreground">{config.folderName}</span>}
        </div>
        <CardDescription>バックアップ JSON を自分の Google ドライブへ保存します。月を締めたときの自動保存もできます。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!secretsAvailable && <Alert variant="warning">SUPABASE_SERVICE_ROLE_KEY が設定されていないため、認証情報の保存・読み出しができません。</Alert>}
        {status.lastError && <Alert variant="destructive">{status.lastError}</Alert>}
        {status.lastOkAt && <p className="text-xs text-muted-foreground">最終成功: {formatDateTimeJa(status.lastOkAt)}</p>}

        <div className="space-y-3">
          {KEYS.map((key) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`drive-${key}`}>{DRIVE_SECRET_LABELS[key]}</Label>
              <Input
                id={`drive-${key}`}
                type="password"
                autoComplete="off"
                value={values[key]}
                onChange={(e) => setValue(key, e.target.value)}
                placeholder={mask[key] || "未設定"}
                disabled={disabled}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">保存済みの値は伏せて表示しています。変更しないときは空のままにしてください。</p>
        </div>

        <div className="flex items-start justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <Label htmlFor="drive-auto-backup">月締めのときに自動保存する</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">月を締めたタイミングでバックアップ JSON をドライブへ保存します。</p>
          </div>
          <Switch id="drive-auto-backup" checked={autoBackup} onCheckedChange={setAutoBackup} disabled={disabled} className="mt-0.5 shrink-0" />
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={disabled}>
              <Save /> {pending ? "処理中…" : "保存"}
            </Button>
            <Button variant="outline" onClick={test} disabled={disabled}>
              <PlugZap /> 接続テスト
            </Button>
            <Button variant="outline" onClick={backup} disabled={disabled || !status.isEnabled}>
              <HardDriveUpload /> 今すぐバックアップを保存
            </Button>
          </div>
        )}
        {!canEdit && <p className="text-xs text-muted-foreground">設定の変更はオーナーのみ行えます。</p>}

        <SetupSteps title="設定の手順（Google Cloud）" steps={STEPS} note="リフレッシュトークンは失効することがあります。保存に失敗するようになったら取り直してください。" />
      </CardContent>
    </Card>
  );
}
