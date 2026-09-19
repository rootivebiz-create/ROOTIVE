"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { deleteContractFileAction, uploadContractFileAction } from "@/lib/actions/contracts";
import { contractFileDisplayName, contractFileUrl, isStoredContractFile } from "./contract-file-badge";

/** lib/actions/contracts.ts はサーバー専用のため、画面で必要な制限はここに持つ */
const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;
const ACCEPT = "application/pdf,image/jpeg,image/png,image/heic,.pdf,.jpg,.jpeg,.png,.heic";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface ContractFileFieldProps {
  /** null = まだ保存していない契約（先に保存が必要） */
  contractId: string | null;
  /** contracts.file_path（アップロード済みのパス、または手入力の保管場所メモ） */
  filePath: string;
  /** アップロード・削除のあとに親フォームの file_path を合わせる */
  onChange?: (filePath: string) => void;
  /** owner / admin のみ登録・削除できる */
  canEdit: boolean;
  disabled?: boolean;
}

/**
 * 締結済みの契約書ファイルの登録・表示・削除。
 * 新規作成は行わず、すでにある契約書（スキャン・写真）を保管するための欄。
 */
export function ContractFileField({ contractId, filePath, onChange, canEdit, disabled }: ContractFileFieldProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const stored = isStoredContractFile(filePath);
  const busy = pending || disabled === true;

  const reset = () => {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    if (selected && selected.size > MAX_CONTRACT_BYTES) {
      toast.error(`契約書のファイルは 10MB 以下にしてください（${formatBytes(selected.size)}）。`);
      reset();
      return;
    }
    setFile(selected);
  };

  const upload = () => {
    if (!file || !contractId) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadContractFileAction(contractId, fd);
      if (res.ok) {
        toast.success(res.message ?? "契約書を登録しました");
        onChange?.(res.data.path);
        reset();
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    if (!contractId) return;
    if (!window.confirm("登録した契約書ファイルを削除します。よろしいですか？")) return;
    startTransition(async () => {
      const res = await deleteContractFileAction(contractId);
      if (res.ok) {
        toast.success(res.message ?? "契約書を削除しました");
        onChange?.("");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="contract-file-upload">契約書ファイル</Label>
      <p className="text-xs text-muted-foreground">
        すでに締結済みの契約書を登録してください（スキャンや写真で構いません）。PDF・JPEG・PNG・HEIC、10MB まで。
      </p>

      {stored && contractId ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 break-all text-sm">{contractFileDisplayName(filePath)}</span>
          <a
            href={contractFileUrl(contractId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm underline underline-offset-2"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden /> 開く
          </a>
          {canEdit && (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={remove} disabled={busy}>
              <Trash2 /> 削除
            </Button>
          )}
        </div>
      ) : !contractId ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          先に契約を保存すると、締結済みの契約書ファイルを登録できます。
        </p>
      ) : canEdit ? (
        <div className="space-y-2">
          <input
            ref={inputRef}
            id="contract-file-upload"
            type="file"
            accept={ACCEPT}
            aria-label="契約書のファイル"
            onChange={onFileChange}
            disabled={busy}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-muted"
          />
          {file && (
            <p className="truncate text-xs text-muted-foreground">
              {file.name}（{formatBytes(file.size)}）
            </p>
          )}
          <Button type="button" onClick={upload} disabled={busy || !file}>
            <Upload /> {pending ? "アップロード中…" : "契約書をアップロード"}
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">契約書ファイルは登録されていません。</p>
      )}
    </div>
  );
}
