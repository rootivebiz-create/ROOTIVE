/**
 * 移行ライブラリの公開 API
 * - detectFormat(json): 試作アプリ JSON か本システムのバックアップかを判定
 * - convertPrototype(json, companyId): 試作アプリ JSON → BackupJson（uuid v5 で決定的な ID）
 * - normalizeBackup(json): 本システムのバックアップ JSON を検証
 * - previewBackup(backup): 件数と月別集計（売上／利益／支払）を lib/calc で算出
 * - buildPreview(json, companyId): 上記をまとめて行い、import_backup に渡せる BackupJson と MigratePreview を返す
 */
export * from "./types";
export { detectFormat, convertPrototype, normalizeBackup, previewBackup, buildPreview, deterministicId, MIGRATION_NAMESPACE } from "./convert";
