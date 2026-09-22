/**
 * 監査一式 ZIP の中身を決める純関数（§8.1）。
 *
 * 「監査で記録を出してください」と言われたときに、これ 1 つ渡せば済むようにする。
 * どのファイルを入れるか・README に何を書くかだけを扱い、ファイルの中身は route が作る。
 */

/** 入れられるもの */
export const AUDIT_PACK_PARTS = ["roster", "daily", "instruction", "incident", "aptitude", "fleet", "labor"] as const;
export type AuditPackPart = (typeof AUDIT_PACK_PARTS)[number];

export const AUDIT_PACK_LABELS: Record<AuditPackPart, string> = {
  roster: "運転者台帳（PDF・CSV）",
  daily: "運転日報・点呼記録（CSV）",
  instruction: "指導・監督の記録（CSV）",
  incident: "事故・違反の記録（CSV）",
  aptitude: "適性診断の記録（CSV）",
  fleet: "車両と書類の期限（CSV）",
  labor: "拘束時間・休息（CSV）",
};

/** ?parts= を読む（空・不正なら全部） */
export function parseAuditPackParts(param: string | string[] | null | undefined): AuditPackPart[] {
  const raw = Array.isArray(param) ? param[0] : param;
  if (!raw) return [...AUDIT_PACK_PARTS];
  const wanted = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AuditPackPart => (AUDIT_PACK_PARTS as readonly string[]).includes(s));
  return wanted.length === 0 ? [...AUDIT_PACK_PARTS] : AUDIT_PACK_PARTS.filter((p) => wanted.includes(p));
}

export interface AuditPackFile {
  /** ZIP の中のファイル名 */
  name: string;
  /** 何件入っているか（README に出す） */
  rows: number;
}

export interface AuditPackError {
  part: AuditPackPart;
  message: string;
}

/** ファイル名（期間が分かるようにする） */
export function auditPackFilename(from: string, to: string): string {
  return `監査一式_${from}_${to}.zip`;
}

/** 同梱する README（何が入っているか・保存期間の考え方） */
export function auditPackReadme(input: {
  companyName: string;
  from: string;
  to: string;
  generatedAt: string;
  files: AuditPackFile[];
  errors: AuditPackError[];
  retention: { label: string; years: number; basis: string }[];
}): string {
  const lines: string[] = [];
  lines.push("監査一式");
  lines.push("");
  lines.push(`会社: ${input.companyName}`);
  lines.push(`期間: ${input.from} 〜 ${input.to}`);
  lines.push(`作成日時: ${input.generatedAt}`);
  lines.push("");
  lines.push("■ 入っているファイル");
  if (input.files.length === 0) {
    lines.push("  （ありません）");
  } else {
    for (const f of input.files) lines.push(`  ${f.name}（${f.rows} 件）`);
  }
  if (input.errors.length > 0) {
    lines.push("");
    lines.push("■ 作れなかったもの");
    for (const e of input.errors) lines.push(`  ${AUDIT_PACK_LABELS[e.part]}: ${e.message}`);
  }
  lines.push("");
  lines.push("■ 保存期間の目安（設定 → 安全管理 で変えられます）");
  for (const r of input.retention) lines.push(`  ${r.label}: ${r.years} 年（${r.basis}）`);
  lines.push("");
  lines.push("※ CSV は UTF-8（BOM 付き）です。Excel でそのまま開けます。");
  lines.push("※ 運転者台帳の PDF は 1 人 1 ページです。");
  return lines.join("\r\n") + "\r\n";
}
