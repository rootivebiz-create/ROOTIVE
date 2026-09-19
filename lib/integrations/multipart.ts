/**
 * Google ドライブへの multipart アップロード用のボディ組み立て（純関数）。
 * files?uploadType=multipart は「メタデータ ＋ 本体」を multipart/related で送る。
 */

export const DRIVE_BOUNDARY = "rootive-drive-boundary";

export function driveMultipartContentType(boundary: string = DRIVE_BOUNDARY): string {
  return `multipart/related; boundary=${boundary}`;
}

/** メタデータ（ファイル名・親フォルダ）と JSON 本体を 1 つのボディにまとめる */
export function buildDriveMultipart(metadata: unknown, jsonText: string, boundary: string = DRIVE_BOUNDARY): string {
  return [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    jsonText,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** ファイル名用のタイムスタンプ（UTC：20260919T013045Z） */
export function driveTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * 同名ファイルを上書きしないよう、拡張子の手前に日時を入れる。
 * "backup.json" → "backup_20260919T013045Z.json"
 */
export function withTimestamp(fileName: string, now: Date = new Date()): string {
  const name = fileName.trim() || "backup.json";
  const ts = driveTimestamp(now);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return `${name}_${ts}`;
  return `${name.slice(0, dot)}_${ts}${name.slice(dot)}`;
}
