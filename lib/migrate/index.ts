/**
 * 移行ライブラリの公開 API（実装は同ディレクトリ内。ここは公開関数の窓口）
 * - detectFormat(json): 試作アプリ JSON か本システムのバックアップかを判定
 * - convertPrototype(json, companyId): 試作アプリ JSON → BackupJson（uuid v5 で決定的な ID）
 * - previewBackup(backup): 件数と月別集計（売上／利益／支払）を lib/calc で算出
 * - buildPreview(json, companyId): 上記をまとめて行い、import_backup に渡せる BackupJson と MigratePreview を返す
 */
export * from "./types";
export { detectFormat, convertPrototype, previewBackup, buildPreview } from "./convert";
