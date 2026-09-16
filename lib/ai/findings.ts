/**
 * AI 月次分析の所見（ai_insights.findings）の正規化・抽出。
 * サーバー・クライアント共用の純関数（SDK には依存しない）。
 */

/** 所見 1 件（DB には string[] または { title, detail }[] で保存されている想定） */
export type InsightFinding = {
  title: string;
  detail: string;
};

/** 所見の最大件数（§4.1：5 項目以内） */
export const MAX_FINDINGS = 5;

function asText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

/**
 * JSON（string[] / { title, detail }[] / { findings: [...] }）を所見の配列に正規化する。
 * 解釈できない要素は捨て、空なら [] を返す。
 */
export function normalizeFindings(json: unknown): InsightFinding[] {
  let list: unknown = json;
  if (list && typeof list === "object" && !Array.isArray(list) && "findings" in list) {
    list = (list as { findings: unknown }).findings;
  }
  if (!Array.isArray(list)) return [];
  const out: InsightFinding[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ title: t, detail: "" });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const title = asText(o.title) || asText(o.heading) || asText(o.summary);
      const detail = asText(o.detail) || asText(o.description) || asText(o.body) || asText(o.text);
      if (!title && !detail) continue;
      out.push(title ? { title, detail } : { title: detail, detail: "" });
    }
  }
  return out;
}

/**
 * モデルの応答テキストから所見の JSON 配列を取り出す。
 * コードフェンス（```json ... ```）や前置きの文章が付いていても最初の配列を探す。
 * どうしても解釈できない場合は本文をそのまま 1 項目にして返す。
 */
export function extractFindings(text: string): InsightFinding[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(trimmed);
  const aStart = trimmed.indexOf("[");
  const aEnd = trimmed.lastIndexOf("]");
  if (aStart >= 0 && aEnd > aStart) candidates.push(trimmed.slice(aStart, aEnd + 1));
  const oStart = trimmed.indexOf("{");
  const oEnd = trimmed.lastIndexOf("}");
  if (oStart >= 0 && oEnd > oStart) candidates.push(trimmed.slice(oStart, oEnd + 1));

  for (const c of candidates) {
    try {
      const findings = normalizeFindings(JSON.parse(c));
      if (findings.length > 0) return findings.slice(0, MAX_FINDINGS);
    } catch {
      // 次の候補を試す
    }
  }
  return [{ title: "分析結果", detail: trimmed }];
}
