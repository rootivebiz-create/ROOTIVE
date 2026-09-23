/**
 * 元請の支払通知と当社の記録を、案件ごとに突き合わせる（純関数。DB に触らない）。
 *
 * - 当社の記録 ＝ その月の稼働の数量の合計 × 案件の受注単価（端数は会社の設定 amountRounding。明細の売上と同じ roundYen）
 * - お支払通知 ＝ その案件に当たった行の合計
 * - 差 ＝ お支払通知 − 当社の記録（マイナスは「受け取りが少ない可能性」）
 * - 数量と単価の両方が違うときは 2 つに分ける：
 *     数量の差 ＝ （通知の数量 × 当社の単価）− 当社の記録
 *     単価の差 ＝ 通知の金額 −（通知の数量 × 当社の単価）
 *   2 つを足すと、必ず差の全体になる
 * - 当社に案件が無い行（待機料など）は「お支払通知にだけある」として、そのまま並べる（どちらが正しいとは言わない）
 */
import { roundYen } from "@/lib/payroll/money";
import type { Rounding } from "@/lib/payroll/types";
import { isChargeName, lineKey, type ItemKind } from "./labels";

export type CmpProject = { id: string; name: string; clientId: string | null; unit: string; billRate: number };
export type CmpDriver = { id: string; name: string };
export type CmpWork = { projectId: string; driverId: string; qty: number };
/** role：project（案件に当たった）・extra（追加の料金と確認済み）・ignore（対象外）・unknown（まだ決めていない） */
export type LineRole = "project" | "extra" | "ignore" | "unknown";
export type CmpLine = {
  id: string;
  rawProject: string;
  rawDriver: string | null;
  projectId: string | null;
  driverId: string | null;
  qty: number | null;
  unitPrice: number | null;
  amount: number;
  role: LineRole;
};

export type CompareInput = {
  clientId: string | null;
  projects: CmpProject[];
  drivers: CmpDriver[];
  work: CmpWork[];
  lines: CmpLine[];
  rounding: Rounding;
};

export type CompareItem = {
  /** 作り直しても扱い（状態・メモ）を引き継ぐための鍵：種類 ＋ 案件 ＋ 名前 */
  key: string;
  kind: ItemKind;
  projectId: string | null;
  driverId: string | null;
  label: string;
  unit: string | null;
  ourQty: number | null;
  theirQty: number | null;
  ourPrice: number | null;
  theirPrice: number | null;
  ourAmount: number;
  theirAmount: number;
  diff: number;
  /** 数量と単価の両方が違うため 2 つに分けたうちの 1 つ */
  split: boolean;
  /** お支払通知の同じ案件に、単価の違う行が混ざっている（単価は平均） */
  mixedPrices: boolean;
  /** extra のとき：追加の料金と確認済みか */
  confirmedExtra: boolean;
};

/** 案件ごとの突き合わせ（一致したものも含む） */
export type ProjectRow = {
  projectId: string;
  name: string;
  unit: string;
  ourQty: number;
  ourPrice: number;
  ourAmount: number;
  theirQty: number | null;
  theirPrice: number | null;
  theirAmount: number;
  lineCount: number;
  diff: number;
  mixedPrices: boolean;
};

/** ドライバー別の内訳（お支払通知にドライバーの列があるときだけ） */
export type DriverRow = {
  projectId: string;
  projectName: string;
  unit: string;
  driverId: string | null;
  driverName: string;
  ourQty: number;
  theirQty: number | null;
  /** 数量の差を当社の単価で円にしたもの */
  diffAtOurPrice: number | null;
};

export type ChargeWarning = { projectId: string; name: string; unit: string; qty: number; amount: number };

export type CompareResult = {
  items: CompareItem[];
  projects: ProjectRow[];
  drivers: DriverRow[] | null;
  /** 当社の記録（突き合わせた案件の合計） */
  ourTotal: number;
  /** お支払通知（対象外を除いた合計） */
  theirTotal: number;
  /** 対象外にした行の合計 */
  ignoredTotal: number;
  /** 当社に待機料・高速代などの記録があるのに、お支払通知に無い */
  chargeWarnings: ChargeWarning[];
  /** 案件に当たらず、まだ決めていない行の数 */
  unknownLines: number;
};

const EPS = 1e-6;

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < EPS;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

export function itemKey(kind: string, projectId: string | null, label: string): string {
  return `${kind}:${projectId ?? ""}:${label}`;
}

/** 行の束から、数量の合計（1 行でも無ければ null）・単価（1 つならそれ、違えば平均）を出す */
function summarizeLines(lines: CmpLine[]): { qty: number | null; price: number | null; amount: number; mixed: boolean } {
  const amount = lines.reduce((a, l) => a + l.amount, 0);
  const allQty = lines.every((l) => l.qty !== null);
  const qty = allQty ? round4(lines.reduce((a, l) => a + (l.qty ?? 0), 0)) : null;
  const prices = [...new Set(lines.filter((l) => l.unitPrice !== null).map((l) => l.unitPrice as number))];
  const mixed = prices.length > 1;
  let price: number | null = null;
  if (prices.length === 1 && lines.every((l) => l.unitPrice !== null)) price = prices[0];
  else if (qty !== null && qty !== 0) price = round4(amount / qty);
  else if (prices.length === 1) price = prices[0];
  return { qty, price, amount, mixed };
}

export function compareNotice(input: CompareInput): CompareResult {
  const { rounding } = input;
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  const driverName = new Map(input.drivers.map((d) => [d.id, d.name]));

  // 当社の記録：案件ごと・案件 × ドライバーごとの数量
  const ourQty = new Map<string, number>();
  const ourQtyByDriver = new Map<string, Map<string, number>>();
  for (const w of input.work) {
    if (!(w.qty > 0) || !projectById.has(w.projectId)) continue;
    ourQty.set(w.projectId, round4((ourQty.get(w.projectId) ?? 0) + w.qty));
    const m = ourQtyByDriver.get(w.projectId) ?? new Map<string, number>();
    m.set(w.driverId, round4((m.get(w.driverId) ?? 0) + w.qty));
    ourQtyByDriver.set(w.projectId, m);
  }

  const linesByProject = new Map<string, CmpLine[]>();
  for (const l of input.lines) {
    if (l.role !== "project" || !l.projectId || !projectById.has(l.projectId)) continue;
    const arr = linesByProject.get(l.projectId) ?? [];
    arr.push(l);
    linesByProject.set(l.projectId, arr);
  }

  // 突き合わせる案件：その元請の案件で当社に稼働があるもの ＋ お支払通知の行が当たった案件
  const scope = input.projects.filter(
    (p) => (input.clientId !== null && p.clientId === input.clientId && (ourQty.get(p.id) ?? 0) > 0) || linesByProject.has(p.id),
  );
  scope.sort((a, b) => a.name.localeCompare(b.name, "ja"));

  const items: CompareItem[] = [];
  const projects: ProjectRow[] = [];
  const chargeWarnings: ChargeWarning[] = [];
  const base = { driverId: null, split: false, mixedPrices: false, confirmedExtra: false };

  for (const p of scope) {
    const oq = ourQty.get(p.id) ?? 0;
    const ourAmount = roundYen(oq * p.billRate, rounding);
    const lines = linesByProject.get(p.id) ?? [];
    if (lines.length === 0) {
      projects.push({ projectId: p.id, name: p.name, unit: p.unit, ourQty: oq, ourPrice: p.billRate, ourAmount, theirQty: null, theirPrice: null, theirAmount: 0, lineCount: 0, diff: -ourAmount, mixedPrices: false });
      if (isChargeName(p.name) && oq > 0) chargeWarnings.push({ projectId: p.id, name: p.name, unit: p.unit, qty: oq, amount: ourAmount });
      if (ourAmount !== 0) {
        items.push({
          ...base,
          key: itemKey("missing", p.id, p.name),
          kind: "missing",
          projectId: p.id,
          label: p.name,
          unit: p.unit,
          ourQty: oq,
          theirQty: null,
          ourPrice: p.billRate,
          theirPrice: null,
          ourAmount,
          theirAmount: 0,
          diff: -ourAmount,
        });
      }
      continue;
    }

    const t = summarizeLines(lines);
    const diff = t.amount - ourAmount;
    projects.push({ projectId: p.id, name: p.name, unit: p.unit, ourQty: oq, ourPrice: p.billRate, ourAmount, theirQty: t.qty, theirPrice: t.price, theirAmount: t.amount, lineCount: lines.length, diff, mixedPrices: t.mixed });
    if (diff === 0) continue;

    const common = { ...base, projectId: p.id, label: p.name, unit: p.unit, mixedPrices: t.mixed };
    if (t.qty === null) {
      // 通知に数量が無い：金額だけで比べる
      items.push({ ...common, key: itemKey("amount", p.id, p.name), kind: "amount", ourQty: oq, theirQty: null, ourPrice: p.billRate, theirPrice: null, ourAmount, theirAmount: t.amount, diff });
      continue;
    }
    const qtySame = same(t.qty, oq);
    const priceSame = t.price !== null && same(t.price, p.billRate);
    const atOurPrice = roundYen(t.qty * p.billRate, rounding);
    const qtyPart = atOurPrice - ourAmount;
    const pricePart = t.amount - atOurPrice;

    if (qtySame && priceSame) {
      items.push({ ...common, key: itemKey("amount", p.id, p.name), kind: "amount", ourQty: oq, theirQty: t.qty, ourPrice: p.billRate, theirPrice: t.price, ourAmount, theirAmount: t.amount, diff });
    } else if (qtySame || qtyPart === 0) {
      items.push({ ...common, key: itemKey("price", p.id, p.name), kind: "price", ourQty: oq, theirQty: t.qty, ourPrice: p.billRate, theirPrice: t.price, ourAmount, theirAmount: t.amount, diff });
    } else if (priceSame || pricePart === 0) {
      items.push({ ...common, key: itemKey("qty", p.id, p.name), kind: "qty", ourQty: oq, theirQty: t.qty, ourPrice: p.billRate, theirPrice: t.price ?? p.billRate, ourAmount, theirAmount: t.amount, diff });
    } else {
      // 両方違う：数量の差（当社の単価で）＋ 単価の差（通知の数量で）に分ける
      items.push({ ...common, split: true, key: itemKey("qty", p.id, p.name), kind: "qty", ourQty: oq, theirQty: t.qty, ourPrice: p.billRate, theirPrice: p.billRate, ourAmount, theirAmount: atOurPrice, diff: qtyPart });
      items.push({ ...common, split: true, key: itemKey("price", p.id, p.name), kind: "price", ourQty: t.qty, theirQty: t.qty, ourPrice: p.billRate, theirPrice: t.price, ourAmount: atOurPrice, theirAmount: t.amount, diff: pricePart });
    }
  }

  // お支払通知にだけある行（案件に当たらない行。対象外は除く）。名前ごとにまとめる
  const extraGroups = new Map<string, CmpLine[]>();
  let ignoredTotal = 0;
  let unknownLines = 0;
  for (const l of input.lines) {
    if (l.role === "project" && l.projectId && projectById.has(l.projectId)) continue;
    if (l.role === "ignore") {
      ignoredTotal += l.amount;
      continue;
    }
    if (l.role === "unknown" || l.role === "project") unknownLines++;
    const k = lineKey(l.rawProject);
    const arr = extraGroups.get(k) ?? [];
    arr.push(l);
    extraGroups.set(k, arr);
  }
  const extras: CompareItem[] = [];
  for (const group of extraGroups.values()) {
    const t = summarizeLines(group);
    if (t.amount === 0) continue;
    const label = group.map((l) => l.rawProject.trim()).sort()[0];
    const drivers = new Set(group.map((l) => l.driverId));
    extras.push({
      ...base,
      key: itemKey("extra", null, label),
      kind: "extra",
      projectId: null,
      driverId: drivers.size === 1 ? [...drivers][0] : null,
      label,
      unit: null,
      ourQty: null,
      theirQty: t.qty,
      ourPrice: null,
      theirPrice: t.price,
      ourAmount: 0,
      theirAmount: t.amount,
      diff: t.amount,
      mixedPrices: t.mixed,
      confirmedExtra: group.every((l) => l.role === "extra"),
    });
  }
  extras.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  items.push(...extras);

  // ドライバー別の内訳（通知にドライバーの列があるときだけ）
  let drivers: DriverRow[] | null = null;
  if (input.lines.some((l) => l.rawDriver)) {
    drivers = [];
    for (const p of scope) {
      const lines = linesByProject.get(p.id) ?? [];
      const theirs = new Map<string, { id: string | null; name: string; lines: CmpLine[] }>();
      for (const l of lines) {
        const k = l.driverId ?? `raw:${lineKey(l.rawDriver ?? "")}`;
        const name = l.driverId ? (driverName.get(l.driverId) ?? l.rawDriver ?? "") : l.rawDriver?.trim() || "（ドライバーの記載なし）";
        const g = theirs.get(k) ?? { id: l.driverId, name, lines: [] };
        g.lines.push(l);
        theirs.set(k, g);
      }
      const ours = ourQtyByDriver.get(p.id) ?? new Map<string, number>();
      const keys = new Set<string>([...ours.keys(), ...theirs.keys()]);
      const rows: DriverRow[] = [];
      for (const k of keys) {
        const g = theirs.get(k);
        const oq = ours.get(k) ?? 0;
        const tq = g ? summarizeLines(g.lines).qty : 0;
        rows.push({
          projectId: p.id,
          projectName: p.name,
          unit: p.unit,
          driverId: g?.id ?? (ours.has(k) ? k : null),
          driverName: g?.name ?? driverName.get(k) ?? "",
          ourQty: oq,
          theirQty: tq,
          diffAtOurPrice: tq === null ? null : roundYen((tq - oq) * p.billRate, rounding),
        });
      }
      rows.sort((a, b) => a.driverName.localeCompare(b.driverName, "ja"));
      drivers.push(...rows);
    }
  }

  const ourTotal = projects.reduce((a, r) => a + r.ourAmount, 0);
  const theirTotal = input.lines.filter((l) => l.role !== "ignore").reduce((a, l) => a + l.amount, 0);
  return { items, projects, drivers, ourTotal, theirTotal, ignoredTotal, chargeWarnings, unknownLines };
}

/** 差の合計（少ない可能性・多い可能性を分けて） */
export function sumDiffs(items: { diff: number }[]): { short: number; shortCount: number; over: number; overCount: number; net: number } {
  let short = 0;
  let over = 0;
  let shortCount = 0;
  let overCount = 0;
  for (const it of items) {
    if (it.diff < 0) {
      short += -it.diff;
      shortCount++;
    } else if (it.diff > 0) {
      over += it.diff;
      overCount++;
    }
  }
  return { short, shortCount, over, overCount, net: over - short };
}
