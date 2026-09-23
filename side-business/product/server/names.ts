/**
 * 名前の照合（ドライバー・案件・元請）。Excel の表記ゆれ（全角/半角・空白・カナ/かな・「株式会社」・括弧の補足）を吸収して当てる。
 * 取り込みと突合の両方で使う。純関数。
 */

export type Candidate = { id: string; name: string; aliases?: string[]; code?: string | null; kana?: string | null };
export type MatchResult = { id: string; name: string; how: "exact" | "alias" | "code" | "normalized" | "partial"; score: number };

/** 比べるための正規化：NFKC・小文字・空白と記号を消す・ひらがな→カタカナ・会社の種類と「（架空）」などの括弧書きを外す */
export function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/(株式会社|有限会社|合同会社|\(株\)|\(有\)|\(同\)|㈱|㈲)/g, "")
    .replace(/[(（][^)）]*[)）]/g, "")
    .replace(/[\s　・.,、。\-－ー_/／'"「」【】]/g, "");
}

/** 括弧書きを外さない正規化（「企業配（日当）」と「企業配」を別に見たいときの最初の比較に使う） */
function looseName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[\s　]/g, "");
}

/**
 * いちばん近い候補を返す（当たらなければ null）。順番：
 * 1. 名前・別名が完全に同じ（空白と全角半角を無視）
 * 2. 番号（code）が同じ
 * 3. 正規化した名前・別名・カナが同じ
 * 4. 片方がもう片方を含む（3 文字以上で、候補が 1 つに絞れるときだけ）
 */
export function matchName(raw: string, candidates: Candidate[]): MatchResult | null {
  const value = raw.trim();
  if (!value) return null;
  const loose = looseName(value);
  for (const c of candidates) {
    if (looseName(c.name) === loose) return { id: c.id, name: c.name, how: "exact", score: 1 };
  }
  for (const c of candidates) {
    if ((c.aliases ?? []).some((a) => looseName(a) === loose)) return { id: c.id, name: c.name, how: "alias", score: 0.98 };
  }
  for (const c of candidates) {
    if (c.code && looseName(c.code) === loose) return { id: c.id, name: c.name, how: "code", score: 0.97 };
  }
  const norm = normalizeName(value);
  if (!norm) return null;
  for (const c of candidates) {
    const keys = [c.name, ...(c.aliases ?? []), c.kana ?? ""].filter(Boolean).map(normalizeName);
    if (keys.includes(norm)) return { id: c.id, name: c.name, how: "normalized", score: 0.95 };
  }
  if (norm.length >= 2) {
    const hits = candidates.filter((c) => {
      const keys = [c.name, ...(c.aliases ?? [])].map(normalizeName).filter((k) => k.length >= 2);
      return keys.some((k) => (k.includes(norm) && norm.length >= Math.min(3, k.length)) || (norm.includes(k) && k.length >= 2));
    });
    if (hits.length === 1) return { id: hits[0].id, name: hits[0].name, how: "partial", score: 0.8 };
  }
  return null;
}

/** 候補をすべて近い順に（取り込みの「どれのことですか？」の選択肢に使う） */
export function rankCandidates(raw: string, candidates: Candidate[], limit = 5): Candidate[] {
  const norm = normalizeName(raw);
  const scored = candidates.map((c) => {
    const keys = [c.name, ...(c.aliases ?? [])].map(normalizeName);
    const best = Math.max(...keys.map((k) => similarity(norm, k)));
    return { c, best };
  });
  return scored
    .sort((a, b) => b.best - a.best)
    .slice(0, limit)
    .map((s) => s.c);
}

/** 文字の 2-gram の重なり（0〜1） */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const g = new Map<string, number>();
    if (s.length === 1) g.set(s, 1);
    for (let i = 0; i < s.length - 1; i++) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) ?? 0) + 1);
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [k, v] of ga) inter += Math.min(v, gb.get(k) ?? 0);
  const total = [...ga.values()].reduce((x, y) => x + y, 0) + [...gb.values()].reduce((x, y) => x + y, 0);
  return total === 0 ? 0 : (2 * inter) / total;
}
