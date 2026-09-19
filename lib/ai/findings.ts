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

/* -------------------------------------------------------------------------
 * 月次の分析と改善策（ai_insights の kind='monthly'）
 * 応答 JSON は {"summary": "...", "findings": [...], "actions": [...]}
 * 既存の normalizeFindings / extractFindings は所見だけを扱う形のまま残す。
 * ---------------------------------------------------------------------- */

/** 所見の重さ */
export type InsightSeverity = "high" | "medium" | "low";
export const INSIGHT_SEVERITIES: InsightSeverity[] = ["high", "medium", "low"];
export const INSIGHT_SEVERITY_LABELS: Record<InsightSeverity, string> = {
  high: "重要",
  medium: "注意",
  low: "参考",
};

/** 重さ付きの所見（InsightFinding と互換。jsonb へそのまま保存するので型エイリアスにする） */
export type InsightFindingDetail = {
  title: string;
  detail: string;
  severity: InsightSeverity;
};

/** 改善策 1 件（effect は「月 +12 万円程度」のような短い文字列。不明なら空） */
export type InsightAction = {
  title: string;
  detail: string;
  effect: string;
};

/** 月次分析の中身 */
export type InsightPayload = {
  summary: string;
  findings: InsightFindingDetail[];
  actions: InsightAction[];
};

/** 改善策の最大件数（§AI：3 件まで） */
export const MAX_ACTIONS = 3;

/** 総括の最大文字数（画面・DB を荒らさないため） */
export const MAX_SUMMARY_LENGTH = 400;

function asSeverity(v: unknown): InsightSeverity {
  const s = asText(v).toLowerCase();
  if (s === "high" || s === "重要" || s === "高") return "high";
  if (s === "low" || s === "参考" || s === "低") return "low";
  return "medium";
}

function toList(json: unknown, key: string): unknown[] {
  let list: unknown = json;
  if (list && typeof list === "object" && !Array.isArray(list) && key in list) {
    list = (list as Record<string, unknown>)[key];
  }
  return Array.isArray(list) ? list : [];
}

/** 所見（重さ付き）の正規化。重さが無い・読めないときは medium とみなす */
export function normalizeInsightFindings(json: unknown): InsightFindingDetail[] {
  const out: InsightFindingDetail[] = [];
  for (const item of toList(json, "findings")) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ title: t, detail: "", severity: "medium" });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const title = asText(o.title) || asText(o.heading) || asText(o.summary);
      const detail = asText(o.detail) || asText(o.description) || asText(o.body) || asText(o.text);
      if (!title && !detail) continue;
      const severity = asSeverity(o.severity ?? o.level ?? o.priority);
      out.push(title ? { title, detail, severity } : { title: detail, detail: "", severity });
    }
  }
  return out.slice(0, MAX_FINDINGS);
}

/** 改善策の正規化 */
export function normalizeActions(json: unknown): InsightAction[] {
  const out: InsightAction[] = [];
  for (const item of toList(json, "actions")) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ title: t, detail: "", effect: "" });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const title = asText(o.title) || asText(o.heading) || asText(o.action);
      const detail = asText(o.detail) || asText(o.description) || asText(o.body) || asText(o.text);
      const effect = asText(o.effect) || asText(o.impact) || asText(o.amount);
      if (!title && !detail) continue;
      out.push(title ? { title, detail, effect } : { title: detail, detail: "", effect });
    }
  }
  return out.slice(0, MAX_ACTIONS);
}

/** JSON（{summary, findings, actions} / 配列 / 文字列）を月次分析の形に正規化する */
export function normalizeInsight(json: unknown): InsightPayload {
  if (typeof json === "string") {
    const t = json.trim();
    return { summary: t.slice(0, MAX_SUMMARY_LENGTH), findings: [], actions: [] };
  }
  const isArray = Array.isArray(json);
  const obj = json && typeof json === "object" && !isArray ? (json as Record<string, unknown>) : {};
  const summary = (asText(obj.summary) || asText(obj.overview) || asText(obj.conclusion)).slice(0, MAX_SUMMARY_LENGTH);
  return {
    summary,
    // 配列だけが返ってきた場合は所見の配列とみなす（改善策は無い）
    findings: normalizeInsightFindings(json),
    actions: isArray ? [] : normalizeActions(json),
  };
}

/** 中身があるか（抽出の候補を選ぶのに使う） */
export function hasInsightContent(p: InsightPayload): boolean {
  return Boolean(p.summary) || p.findings.length > 0 || p.actions.length > 0;
}

/** JSON らしき候補を前から順に返す（コードフェンス → 全体 → 配列の範囲 → オブジェクトの範囲） */
function jsonCandidates(trimmed: string): string[] {
  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(trimmed);
  const oStart = trimmed.indexOf("{");
  const oEnd = trimmed.lastIndexOf("}");
  if (oStart >= 0 && oEnd > oStart) candidates.push(trimmed.slice(oStart, oEnd + 1));
  const aStart = trimmed.indexOf("[");
  const aEnd = trimmed.lastIndexOf("]");
  if (aStart >= 0 && aEnd > aStart) candidates.push(trimmed.slice(aStart, aEnd + 1));
  return candidates;
}

/**
 * モデルの応答テキストから月次分析（summary / findings / actions）を取り出す。
 * コードフェンス・前置き・後書きが付いていても JSON を探す。
 * どうしても解釈できない場合は本文をそのまま総括として返す。
 */
export function extractInsight(text: string): InsightPayload {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { summary: "", findings: [], actions: [] };
  for (const c of jsonCandidates(trimmed)) {
    try {
      const payload = normalizeInsight(JSON.parse(c));
      if (hasInsightContent(payload)) return payload;
    } catch {
      // 次の候補を試す
    }
  }
  return { summary: trimmed.slice(0, MAX_SUMMARY_LENGTH), findings: [{ title: "分析結果", detail: trimmed, severity: "medium" }], actions: [] };
}
