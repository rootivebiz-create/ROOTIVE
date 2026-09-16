// 仮実装（移行担当が本実装で置き換える）
import type { BackupJson, MigratePreview, SourceFormat } from "./types";

export function detectFormat(_json: unknown): SourceFormat {
  throw new Error("not implemented");
}
export function convertPrototype(_json: unknown, _companyId: string): { backup: BackupJson; warnings: string[] } {
  throw new Error("not implemented");
}
export function previewBackup(_backup: BackupJson, _format: "prototype" | "backup" = "backup"): MigratePreview {
  throw new Error("not implemented");
}
export function buildPreview(_json: unknown, _companyId: string): { backup: BackupJson; preview: MigratePreview } {
  throw new Error("not implemented");
}
