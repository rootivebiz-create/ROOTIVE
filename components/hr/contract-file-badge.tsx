import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * 契約書ファイル（Storage に保管した実ファイル）の見分けと表示
 *
 * `contracts.file_path` には
 *   - アップロードしたファイルの保存先 `<company_id>/<contract_id>/<タイムスタンプ>_<名前>`
 *   - 以前からの手入力の「保管場所メモ」（例: 共有フォルダ/契約書/…）
 * の両方が入りうるため、UUID フォルダで始まるかどうかで見分ける。
 */
const STORED_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i;

/** アップロード済みのファイルか（＝「開く」で表示できるか） */
export function isStoredContractFile(filePath: string): boolean {
  return STORED_PATH_RE.test(filePath ?? "");
}

/** 表示用のファイル名（保存時に付けたタイムスタンプを外す） */
export function contractFileDisplayName(filePath: string): string {
  if (!filePath) return "";
  const last = filePath.split("/").pop() ?? filePath;
  return last.replace(/^\d{8}T\d{6}Z_/, "");
}

/** 契約書を開く URL（ログイン必須。署名付き URL へリダイレクトする） */
export function contractFileUrl(contractId: string): string {
  return `/api/contract-file?id=${encodeURIComponent(contractId)}`;
}

/**
 * 一覧用のバッジ。法令上、締結済みの契約書は保管が必要なため「なし」を目立たせる。
 * 手入力の保管場所メモだけのときは「場所メモのみ」と出す。
 */
export function ContractFileBadge({ filePath }: { filePath: string }) {
  if (isStoredContractFile(filePath)) {
    return (
      <Badge variant="success" className="gap-1">
        <Paperclip className="h-3 w-3" aria-hidden /> あり
      </Badge>
    );
  }
  if (filePath) return <Badge variant="warning">場所メモのみ</Badge>;
  return <Badge variant="destructive">なし</Badge>;
}
