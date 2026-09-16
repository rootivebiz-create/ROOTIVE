"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteCompanyAssetAction, uploadCompanyAssetAction } from "@/lib/actions/company-assets";

/** lib/company-assets.ts は server-only のため、クライアント側で必要な定数はここに持つ */
type AssetKind = "logo" | "seal";
const ASSET_LABELS: Record<AssetKind, string> = { logo: "ロゴ", seal: "認印" };
const ASSET_MAX_BYTES = 2 * 1024 * 1024;
const ASSET_HINTS: Record<AssetKind, string> = {
  logo: "明細の左上に印字します。横長の画像がきれいに収まります。",
  seal: "会社名の横に印字します。背景が透明の PNG がきれいに印字されます。",
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface AssetItemProps {
  kind: AssetKind;
  path: string | null;
  canEdit: boolean;
}

function AssetItem({ kind, path, canEdit }: AssetItemProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = ASSET_LABELS[kind];
  const inputId = `company-asset-${kind}`;

  const reset = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    if (selected && selected.size > ASSET_MAX_BYTES) {
      toast.error(`${label}の画像は 2MB 以下にしてください（${formatBytes(selected.size)}）。`);
      reset();
      return;
    }
    setFile(selected);
  };

  const upload = () => {
    if (!file) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadCompanyAssetAction(kind, fd);
      if (res.ok) {
        toast.success(res.message ?? "画像を保存しました。");
        reset();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    startTransition(async () => {
      const res = await deleteCompanyAssetAction(kind);
      setConfirmOpen(false);
      if (res.ok) {
        toast.success(res.message ?? "画像を削除しました。");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex items-start gap-3">
        {path ? (
          <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white p-1">
            {/* ログイン必須の API から読むため next/image は使わない。更新直後のキャッシュはパスをクエリに付けて回避する */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/company-asset/${kind}?v=${encodeURIComponent(path)}`} alt={label} className="max-h-24 max-w-full object-contain" />
          </div>
        ) : (
          <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground" data-testid={`company-asset-${kind}-empty`}>
            未設定
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-muted-foreground">{ASSET_HINTS[kind]}</p>
          {canEdit && (
            <>
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept="image/png,image/jpeg"
                aria-label={`${label}の画像ファイル`}
                onChange={onFileChange}
                disabled={pending}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-muted"
              />
              {file && (
                <p className="truncate text-xs text-muted-foreground">
                  {file.name}（{formatBytes(file.size)}）
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={upload} disabled={pending || !file}>
                  <Upload /> {pending && file ? "アップロード中…" : `${label}をアップロード`}
                </Button>
                {path && (
                  <Button variant="outline" onClick={() => setConfirmOpen(true)} disabled={pending}>
                    <Trash2 /> {label}を削除
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}を削除しますか？</DialogTitle>
            <DialogDescription>支払明細（PDF・印刷用ページ）に{label}が印字されなくなります。この操作は取り消せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={remove} disabled={pending}>
              {pending ? "削除中…" : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export interface CompanyAssetsCardProps {
  logoPath: string | null;
  sealPath: string | null;
  /** owner 以外は表示のみ */
  canEdit: boolean;
}

/** 会社設定：ロゴ・認印のアップロード（支払明細に印字する画像） */
export function CompanyAssetsCard({ logoPath, sealPath, canEdit }: CompanyAssetsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>ロゴ・認印</CardTitle>
        <CardDescription>支払明細（PDF・印刷用ページ）に印字します。PNG または JPEG、2MB まで。認印は背景が透明の PNG がきれいに印字されます。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <AssetItem kind="logo" path={logoPath} canEdit={canEdit} />
        <AssetItem kind="seal" path={sealPath} canEdit={canEdit} />
      </CardContent>
    </Card>
  );
}
