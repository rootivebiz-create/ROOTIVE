/**
 * 元請と案件の「まとめて入れる」（純関数）。1 行 = 元請名・案件名・単位・受注単価・支払単価。
 * 画面の入力でも、Excel から貼り付けた 5 列でも、同じ確かめ方をする。DB に触らない。
 *
 * - 元請は名前の表記ゆれ（株式会社・全角半角・括弧書き）を吸収して、すでにあるものに当てる。無ければ新しく作る
 * - 同じ元請に同じ名前の案件があれば、登録しない（何度送っても増えない）
 * 画面（ブラウザ）からも読むので、サーバー専用の部品（Excel の読み取りなど）を使わない。
 */
import { parseAmount } from "@/lib/payroll/money";
import { matchName, normalizeName, type Candidate } from "~/server/names";
import { cleanName, nfkc } from "./normalize";

export type ProjectRowInput = { client: string; project: string; unit: string; billRate: string; payRate: string };

export type ProjectDraft = {
  clientName: string | null;
  /** すでにある元請に当たったとき */
  clientId: string | null;
  name: string;
  unit: string;
  billRate: number;
  payRate: number;
};

export type ProjectPreviewRow = {
  /** 入力の何行目か（1 始まり） */
  rowNo: number;
  status: "new" | "duplicate" | "error";
  draft: ProjectDraft | null;
  errors: string[];
  warnings: string[];
};

export type ProjectPreview = {
  rows: ProjectPreviewRow[];
  counts: { new: number; duplicate: number; error: number };
  /** 新しく作る元請の名前 */
  newClients: string[];
};

export type ExistingClient = Candidate;
export type ExistingProject = { id: string; name: string; clientId: string | null; aliases?: string[] | null };

export const UNIT_CHOICES = ["個", "件", "日", "時間", "便", "台", "km", "月"];

const MAX_RATE = 10_000_000;

function rateOf(raw: string, label: string, errors: string[]): number | null {
  const v = nfkc(raw);
  if (!v) {
    errors.push(`${label}を入れてください（無ければ 0）`);
    return null;
  }
  const n = parseAmount(v);
  if (n === null || n < 0) {
    errors.push(`${label}「${v}」は 0 以上の数で入れてください`);
    return null;
  }
  if (n > MAX_RATE) {
    errors.push(`${label}が大きすぎます。桁を確かめてください`);
    return null;
  }
  if (Math.abs(n * 1e4 - Math.round(n * 1e4)) > 1e-6) {
    errors.push(`${label}の小数は 4 桁までにしてください`);
    return null;
  }
  return n;
}

function isEmptyRow(r: ProjectRowInput): boolean {
  return [r.client, r.project, r.unit, r.billRate, r.payRate].every((v) => !nfkc(v));
}

/** 元請の名前を、すでにある元請に当てる（当たらなければ null） */
export function matchClient(name: string, clients: ExistingClient[]): Candidate | null {
  if (!name) return null;
  const hit = matchName(name, clients);
  // 「一部が同じ」だけの当たりは別の会社のことがあるので使わない
  if (!hit || hit.how === "partial") return null;
  return clients.find((c) => c.id === hit.id) ?? null;
}

export function parseProjectRows(input: ProjectRowInput[], clients: ExistingClient[], projects: ExistingProject[]): ProjectPreview {
  const rows: ProjectPreviewRow[] = [];
  const seen = new Set<string>();
  const newClients = new Map<string, string>();
  input.forEach((r, i) => {
    if (isEmptyRow(r)) return;
    const rowNo = i + 1;
    const errors: string[] = [];
    const warnings: string[] = [];
    const clientName = cleanName(r.client) || null;
    const name = cleanName(r.project);
    const unit = nfkc(r.unit).replace(/\s/g, "");
    if (!name) errors.push("案件の名前を入れてください（例：宅配（個建て））");
    else if (name.length > 60) errors.push("案件の名前は 60 文字までにしてください");
    if (!unit) errors.push("単位を入れてください（例：個・日・時間）");
    else if (unit.length > 10) errors.push("単位は 10 文字までにしてください");
    if (clientName && clientName.length > 60) errors.push("元請の名前は 60 文字までにしてください");
    const billRate = rateOf(r.billRate, "受注単価", errors);
    const payRate = rateOf(r.payRate, "支払単価", errors);
    if (errors.length) {
      rows.push({ rowNo, status: "error", draft: null, errors, warnings });
      return;
    }
    const client = clientName ? matchClient(clientName, clients) : null;
    if (!clientName) warnings.push("元請が空です。元請ごとの利益や、支払通知との突合に使うので、分かれば入れてください");
    else if (!client && !newClients.has(normalizeName(clientName))) newClients.set(normalizeName(clientName), clientName);
    if (billRate === 0) warnings.push("受注単価が 0 円です。利益の計算に使うので、分かれば入れてください");
    if (billRate !== null && payRate !== null && payRate > billRate && billRate > 0) {
      warnings.push("支払単価が受注単価より高くなっています。入れ違いでないか確かめてください");
    }
    const draft: ProjectDraft = { clientName: client?.name ?? clientName, clientId: client?.id ?? null, name, unit, billRate: billRate!, payRate: payRate! };
    // 同じ元請（新しい元請は名前で見る）の同じ名前の案件は登録しない
    const clientKey = client ? `id:${client.id}` : clientName ? `new:${normalizeName(clientName)}` : "none";
    const key = `${clientKey}|${normalizeName(name)}`;
    const existing = client || !clientName
      ? projects.find((p) => (p.clientId ?? null) === (client?.id ?? null) && [p.name, ...(p.aliases ?? [])].some((n) => normalizeName(n) === normalizeName(name)))
      : undefined;
    if (existing) {
      rows.push({ rowNo, status: "duplicate", draft, errors: [], warnings: [`すでに登録されています（${existing.name}）`] });
      return;
    }
    if (seen.has(key)) {
      rows.push({ rowNo, status: "duplicate", draft, errors: [], warnings: ["この表の中に、同じ元請の同じ案件がもう 1 行あります"] });
      return;
    }
    seen.add(key);
    rows.push({ rowNo, status: "new", draft, errors: [], warnings });
  });
  const counts = { new: 0, duplicate: 0, error: 0 };
  for (const r of rows) counts[r.status]++;
  // 登録しない行だけにある元請は、作らない
  const used = new Set(rows.filter((r) => r.status === "new" && r.draft && !r.draft.clientId && r.draft.clientName).map((r) => normalizeName(r.draft!.clientName!)));
  return { rows, counts, newClients: [...newClients.entries()].filter(([k]) => used.has(k)).map(([, v]) => v) };
}

/** Excel から貼り付けた 5 列（元請名・案件名・単位・受注単価・支払単価）を行にする。1 行目が見出しなら飛ばす */
export function projectRowsFromPaste(text: string): ProjectRowInput[] {
  const rows = splitPaste(text);
  const out: ProjectRowInput[] = [];
  rows.forEach((cells, i) => {
    if (cells.every((c) => !c.trim())) return;
    const [client = "", project = "", unit = "", billRate = "", payRate = ""] = cells;
    // 見出し：単価の列が数でない最初の行
    if (i === 0 && parseAmount(nfkc(billRate)) === null && parseAmount(nfkc(payRate)) === null) return;
    out.push({ client, project, unit, billRate, payRate });
  });
  return out;
}

/** 貼り付けた文字を表にする（タブ区切り。タブが無ければカンマ区切り。" で囲んだセルの " を外す） */
export function splitPaste(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const delimiter = t.includes("\t") ? "\t" : ",";
  return t
    .split("\n")
    .map((line) => line.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/s, "$1").replace(/""/g, '"').trim()))
    .filter((cells) => cells.some((c) => c !== ""));
}
