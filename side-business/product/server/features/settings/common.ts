import "server-only";
import { count, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "~/db/client";
import { looseKey } from "./schemas";

/** 条件に当たる行の数 */
export async function countWhere(db: Db, table: PgTable, where: SQL | undefined): Promise<number> {
  const rows = await db.select({ n: count() }).from(table).where(where);
  return Number(rows[0]?.n ?? 0);
}

/** 変わったところだけを { 項目: { from, to } } にする（操作の記録に残す） */
export function changes<T extends Record<string, unknown>>(before: T, after: Partial<T>, keys: readonly (keyof T)[]): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    if (!(key in after)) continue;
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[String(key)] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

type Named = { id: string; name: string; aliases: string[]; code?: string | null };

/**
 * 名前・別名・番号が、ほかの登録と重ならないか（取り込みで見分けられなくなるのを防ぐ）。
 * 重なったら、何と重なったかを日本語で返す。
 */
export function findNameConflict(
  input: { name: string; aliases: string[]; code?: string | null },
  others: Named[],
  what: string,
  example = `${input.name} 2`,
): { field: "name" | "aliases" | "code"; message: string } | null {
  const label = (o: Named) => (o.code ? `${o.code} ${o.name}` : o.name);
  if (input.code) {
    const key = looseKey(input.code);
    const hit = others.find((o) => o.code && looseKey(o.code) === key);
    if (hit) return { field: "code", message: `番号「${input.code}」は、${label(hit)}さんが使っています。別の番号にしてください` };
  }
  const nameKey = looseKey(input.name);
  const sameName = others.find((o) => looseKey(o.name) === nameKey);
  if (sameName) {
    return {
      field: "name",
      message: `同じ名前の${what}（${label(sameName)}）がすでにあります。同じなら、そちらを使ってください。別なら、名前に区別を付けてください（例：${example}）`,
    };
  }
  const aliasHit = others.find((o) => o.aliases.some((a) => looseKey(a) === nameKey));
  if (aliasHit) {
    return { field: "name", message: `この名前は、${label(aliasHit)}の別名として登録されています。取り込みで見分けられなくなるので、別の名前にするか、先にそちらの別名を外してください` };
  }
  for (const alias of input.aliases) {
    const key = looseKey(alias);
    const hit = others.find((o) => looseKey(o.name) === key || o.aliases.some((a) => looseKey(a) === key));
    if (hit) {
      return { field: "aliases", message: `別名「${alias}」は、${label(hit)}の名前か別名と同じです。取り込みで見分けられなくなるので、外すか書き方を変えてください` };
    }
  }
  return null;
}
