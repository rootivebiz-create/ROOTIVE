/**
 * 取り込み：ファイルの名前を台帳のドライバー・案件に当てる（純関数。DB に触らない）。
 * - 当たらない名前は「どれのことですか？」の候補（近い順）をつけて返す
 * - 「取り込まない」と決めた名前の行は外す
 * - 案件ごと・ドライバーごとの合計、先月との比べ
 */
import { matchName, normalizeName, rankCandidates, similarity, type Candidate, type MatchResult } from "~/server/names";
import { CHANGE_THRESHOLD, type RawRecord, type SkipLists } from "./types";

export type KnownDriver = Candidate & { active: boolean };
export type KnownProject = Candidate & { unit: string; active: boolean };
export type Known = { drivers: KnownDriver[]; projects: KnownProject[] };

export type NameGroup = {
  /** 名前を比べるための値（取り込まないリスト・覚えるときの鍵） */
  key: string;
  /** ファイルの書き方（最初に出てきたもの）と、ほかの書き方 */
  raw: string;
  spellings: string[];
  rows: number;
  qty: number;
  match: { id: string; name: string; how: MatchResult["how"] } | null;
  /** 当たったが「念のため確かめて」（名前の一部だけで当たった） */
  needsCheck: boolean;
  skipped: boolean;
  inactive: boolean;
  candidates: { id: string; name: string }[];
};

export type ResolvedRecord = RawRecord & { driverId: string; projectId: string };

export type Resolution = {
  drivers: NameGroup[];
  projects: NameGroup[];
  resolved: ResolvedRecord[];
  /** 名前が決まっていない行（このままでは反映できない） */
  unresolvedRecords: number;
  /** 「取り込まない」にした名前の行 */
  skippedRecords: number;
  skippedQty: number;
  /** 「すべて同じ案件」の案件が台帳に無い */
  fixedProjectMissing: boolean;
};

/** 近い候補（文字の重なりがあるものだけ、近い順に 5 つまで） */
export function closeCandidates(raw: string, candidates: Candidate[], limit = 5): { id: string; name: string }[] {
  const norm = normalizeName(raw);
  return rankCandidates(raw, candidates, limit)
    .filter((c) => [c.name, ...(c.aliases ?? []), c.kana ?? ""].filter(Boolean).some((k) => similarity(norm, normalizeName(k)) > 0))
    .map((c) => ({ id: c.id, name: c.name }));
}

export function nameKey(raw: string): string {
  return normalizeName(raw) || raw.normalize("NFKC").trim().toLowerCase();
}

function looseCode(v: string): string {
  return v.normalize("NFKC").toLowerCase().replace(/\s/g, "");
}

/** 読み取った行の名前を台帳に当てる */
export function resolveRecords(records: RawRecord[], known: Known, fixedProjectId: string | null, skip: SkipLists): Resolution {
  const driverCache = new Map<string, MatchResult | null>();
  const projectCache = new Map<string, MatchResult | null>();
  const byCode = new Map<string, KnownDriver>();
  for (const d of known.drivers) if (d.code) byCode.set(looseCode(d.code), d);
  const activeDriver = new Map(known.drivers.map((d) => [d.id, d.active]));
  const activeProject = new Map(known.projects.map((p) => [p.id, p.active]));
  const fixed = fixedProjectId ? (known.projects.find((p) => p.id === fixedProjectId) ?? null) : null;
  const skipDrivers = new Set(skip.drivers);
  const skipProjects = new Set(skip.projects);

  const driverGroups = new Map<string, NameGroup>();
  const projectGroups = new Map<string, NameGroup>();

  const group = (map: Map<string, NameGroup>, key: string, raw: string, qty: number, match: MatchResult | null, skipped: boolean, inactive: boolean) => {
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        raw,
        spellings: [],
        rows: 0,
        qty: 0,
        match: match ? { id: match.id, name: match.name, how: match.how } : null,
        needsCheck: match?.how === "partial",
        skipped,
        inactive,
        candidates: [],
      };
      map.set(key, g);
    }
    if (!g.spellings.includes(raw)) g.spellings.push(raw);
    g.rows++;
    g.qty = Math.round((g.qty + qty) * 1e4) / 1e4;
    return g;
  };

  const resolved: ResolvedRecord[] = [];
  let unresolvedRecords = 0;
  let skippedRecords = 0;
  let skippedQty = 0;

  for (const r of records) {
    // ドライバー：番号が台帳にあれば番号で、無ければ名前で
    const coded = r.code ? byCode.get(looseCode(r.code)) : undefined;
    const driverRaw = r.driver || r.code;
    let dMatch: MatchResult | null;
    let dKey: string;
    if (coded) {
      dMatch = { id: coded.id, name: coded.name, how: "code", score: 0.97 };
      dKey = `code:${looseCode(r.code)}`;
    } else {
      dKey = nameKey(driverRaw);
      if (!driverCache.has(dKey)) driverCache.set(dKey, matchName(driverRaw, known.drivers));
      dMatch = driverCache.get(dKey) ?? null;
    }
    const dSkipped = skipDrivers.has(dKey);
    group(
      driverGroups,
      dKey,
      coded ? `${driverRaw}${r.driver && r.code ? `（${r.code}）` : ""}` : driverRaw,
      r.qty,
      dMatch,
      dSkipped,
      dMatch ? activeDriver.get(dMatch.id) === false : false,
    );

    // 案件：すべて同じ案件か、名前で
    let pMatch: MatchResult | null = null;
    let pSkipped = false;
    if (fixedProjectId) {
      pMatch = fixed ? { id: fixed.id, name: fixed.name, how: "exact", score: 1 } : null;
    } else {
      const pKey = nameKey(r.project);
      if (!projectCache.has(pKey)) projectCache.set(pKey, matchName(r.project, known.projects));
      pMatch = projectCache.get(pKey) ?? null;
      pSkipped = skipProjects.has(pKey);
      group(projectGroups, pKey, r.project, r.qty, pMatch, pSkipped, pMatch ? activeProject.get(pMatch.id) === false : false);
    }

    if (dSkipped || pSkipped) {
      skippedRecords++;
      skippedQty += r.qty;
      continue;
    }
    if (!dMatch || !pMatch) {
      unresolvedRecords++;
      continue;
    }
    resolved.push({ ...r, driverId: dMatch.id, projectId: pMatch.id });
  }

  // 当たらなかった名前・念のための名前には、近い候補をつける（まったく似ていないものは出さない）
  for (const g of driverGroups.values()) {
    if (!g.match || g.needsCheck) g.candidates = closeCandidates(g.spellings[0], known.drivers);
  }
  for (const g of projectGroups.values()) {
    if (!g.match || g.needsCheck) g.candidates = closeCandidates(g.spellings[0], known.projects);
  }

  const order = (a: NameGroup, b: NameGroup) => Number(!!a.match) - Number(!!b.match) || Number(b.needsCheck) - Number(a.needsCheck) || b.rows - a.rows;
  return {
    drivers: [...driverGroups.values()].sort(order),
    projects: [...projectGroups.values()].sort(order),
    resolved,
    unresolvedRecords,
    skippedRecords,
    skippedQty: Math.round(skippedQty * 1e4) / 1e4,
    fixedProjectMissing: !!fixedProjectId && !fixed,
  };
}

// ---------------------------------------------------------------- 合計

export type DriverTotal = { driverId: string; name: string; lines: { projectId: string; name: string; unit: string; qty: number }[] };
export type ProjectTotal = { projectId: string; name: string; unit: string; qty: number; drivers: number };

export type Work = { driverId: string; projectId: string; qty: number };

function add(map: Map<string, number>, key: string, qty: number) {
  map.set(key, Math.round(((map.get(key) ?? 0) + qty) * 1e4) / 1e4);
}

/** ドライバー × 案件ごとの合計（キーは driverId:projectId） */
export function sumByPair(work: Work[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of work) add(m, `${w.driverId}:${w.projectId}`, w.qty);
  return m;
}

/** 人の並び順：フリガナがあればフリガナ、無ければ名前（あいうえお順） */
export function byKana<T extends { name: string; kana?: string | null }>(a: T, b: T): number {
  return (a.kana || a.name).localeCompare(b.kana || b.name, "ja");
}

export function totalsOf(work: Work[], known: Known): { byDriver: DriverTotal[]; byProject: ProjectTotal[] } {
  const dName = new Map(known.drivers.map((d) => [d.id, d.name]));
  const dKana = new Map(known.drivers.map((d) => [d.id, d.kana ?? null]));
  const p = new Map(known.projects.map((x) => [x.id, x]));
  const pairs = sumByPair(work);
  const byDriver = new Map<string, DriverTotal>();
  const byProject = new Map<string, ProjectTotal & { set: Set<string> }>();
  for (const [key, qty] of pairs) {
    const [driverId, projectId] = key.split(":");
    const proj = p.get(projectId);
    const d = byDriver.get(driverId) ?? { driverId, name: dName.get(driverId) ?? "（台帳に無い人）", lines: [] };
    d.lines.push({ projectId, name: proj?.name ?? "（台帳に無い案件）", unit: proj?.unit ?? "", qty });
    byDriver.set(driverId, d);
    const t = byProject.get(projectId) ?? {
      projectId,
      name: proj?.name ?? "（台帳に無い案件）",
      unit: proj?.unit ?? "",
      qty: 0,
      drivers: 0,
      set: new Set<string>(),
    };
    t.qty = Math.round((t.qty + qty) * 1e4) / 1e4;
    t.set.add(driverId);
    t.drivers = t.set.size;
    byProject.set(projectId, t);
  }
  for (const d of byDriver.values()) d.lines.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return {
    byDriver: [...byDriver.values()].sort((a, b) => byKana({ name: a.name, kana: dKana.get(a.driverId) }, { name: b.name, kana: dKana.get(b.driverId) })),
    byProject: [...byProject.values()].map(({ set: _set, ...rest }) => rest).sort((a, b) => a.name.localeCompare(b.name, "ja")),
  };
}

// ---------------------------------------------------------------- 先月との比べ

export type CompareRow = {
  driverId: string;
  driverName: string;
  projectId: string;
  projectName: string;
  unit: string;
  prev: number;
  now: number;
  /** 変化の割合（先月が 0 なら null） */
  change: number | null;
  flag: "up" | "down" | "new" | "gone" | null;
};

/** 先月と今月（反映したあと）の数量を、ドライバー × 案件で比べる。±50% を超えたもの・増えた人・いなくなった人に印 */
export function compareWithPrev(now: Work[], prev: Work[], known: Known, threshold = CHANGE_THRESHOLD): CompareRow[] {
  const a = sumByPair(now);
  const b = sumByPair(prev);
  const dName = new Map(known.drivers.map((d) => [d.id, d.name]));
  const p = new Map(known.projects.map((x) => [x.id, x]));
  const keys = new Set([...a.keys(), ...b.keys()]);
  const rows: CompareRow[] = [];
  for (const key of keys) {
    const [driverId, projectId] = key.split(":");
    const nowQty = a.get(key) ?? 0;
    const prevQty = b.get(key) ?? 0;
    const change = prevQty > 0 ? (nowQty - prevQty) / prevQty : null;
    let flag: CompareRow["flag"] = null;
    if (prevQty === 0 && nowQty > 0) flag = "new";
    else if (prevQty > 0 && nowQty === 0) flag = "gone";
    else if (change !== null && change > threshold) flag = "up";
    else if (change !== null && change < -threshold) flag = "down";
    rows.push({
      driverId,
      driverName: dName.get(driverId) ?? "（台帳に無い人）",
      projectId,
      projectName: p.get(projectId)?.name ?? "（台帳に無い案件）",
      unit: p.get(projectId)?.unit ?? "",
      prev: prevQty,
      now: nowQty,
      change,
      flag,
    });
  }
  const dKana = new Map(known.drivers.map((d) => [d.id, d.kana ?? null]));
  return rows.sort(
    (x, y) =>
      byKana({ name: x.driverName, kana: dKana.get(x.driverId) }, { name: y.driverName, kana: dKana.get(y.driverId) }) ||
      x.projectName.localeCompare(y.projectName, "ja"),
  );
}
