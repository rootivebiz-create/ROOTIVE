#!/usr/bin/env node
/**
 * ローカル PostgreSQL の public スキーマから supabase-js 用の Database 型を生成する
 * 使い方: node scripts/gen-db-types.mjs postgresql://postgres@127.0.0.1:54329/rootive_test > lib/db/database.types.ts
 */
import pg from "pg";

const url = process.argv[2] ?? process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:54329/rootive_test";
const client = new pg.Client({ connectionString: url });
await client.connect();

const enums = (
  await client.query(`
    select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' group by t.typname order by t.typname`)
).rows;
const enumNames = new Set(enums.map((e) => e.name));

function tsType(udt, dataType) {
  if (enumNames.has(udt)) return `Database["public"]["Enums"]["${udt}"]`;
  switch (udt) {
    case "uuid":
    case "text":
    case "varchar":
    case "bpchar":
    case "date":
    case "timestamptz":
    case "timestamp":
    case "time":
    case "citext":
      return "string";
    case "int2":
    case "int4":
    case "int8":
    case "float4":
    case "float8":
    case "numeric":
      return "number";
    case "bool":
      return "boolean";
    case "json":
    case "jsonb":
      return "Json";
    default:
      if (udt.startsWith("_")) return `${tsType(udt.slice(1), dataType)}[]`;
      return "unknown";
  }
}

const rels = (
  await client.query(`
    select c.relname as name, c.relkind as kind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v') order by c.relname`)
).rows;

const cols = (
  await client.query(`
    select table_name, column_name, udt_name, data_type, is_nullable, column_default, is_identity
    from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`)
).rows;

function rowType(name, isView) {
  const cs = cols.filter((c) => c.table_name === name);
  const row = cs.map((c) => `          ${c.column_name}: ${tsType(c.udt_name, c.data_type)}${c.is_nullable === "YES" || isView ? " | null" : ""}`).join("\n");
  if (isView) return `        Row: {\n${row}\n        }`;
  const insert = cs
    .map((c) => {
      const optional = c.is_nullable === "YES" || c.column_default != null || c.is_identity === "YES";
      return `          ${c.column_name}${optional ? "?" : ""}: ${tsType(c.udt_name, c.data_type)}${c.is_nullable === "YES" ? " | null" : ""}`;
    })
    .join("\n");
  const update = cs.map((c) => `          ${c.column_name}?: ${tsType(c.udt_name, c.data_type)}${c.is_nullable === "YES" ? " | null" : ""}`).join("\n");
  return `        Row: {\n${row}\n        }\n        Insert: {\n${insert}\n        }\n        Update: {\n${update}\n        }`;
}

const fns = (
  await client.query(`
    select p.proname as name, p.oid,
           pg_get_function_result(p.oid) as result,
           p.proretset as retset,
           p.prorettype::regtype::text as rettype,
           (select array_agg(a.n order by a.i) from unnest(p.proargnames) with ordinality a(n, i)) as argnames,
           (select array_agg(t::regtype::text order by i) from unnest(p.proargtypes) with ordinality t(t, i)) as argtypes,
           p.pronargdefaults as ndefaults,
           t.typtype as rettyptype, t.typrelid as retrelid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
    where n.nspname = 'public' and p.prokind = 'f' and p.proname not like 'test\\_%'
      and p.prorettype <> 'trigger'::regtype
    order by p.proname`)
).rows;

function sqlTypeToTs(t) {
  const base = t.replace(/\[\]$/, "");
  const map = { uuid: "string", text: "string", date: "string", "timestamp with time zone": "string", numeric: "number", integer: "number", bigint: "number", boolean: "boolean", jsonb: "Json", json: "Json", void: "undefined" };
  const name = base.replace(/^public\./, "");
  let ts = map[base] ?? (enumNames.has(name) ? `Database["public"]["Enums"]["${name}"]` : rels.some((r) => r.name === name) ? `Database["public"]["Tables"]["${name}"]["Row"]` : "unknown");
  if (t.endsWith("[]")) ts = `${ts}[]`;
  return ts;
}

function fnType(f) {
  const argnames = f.argnames ?? [];
  const argtypes = f.argtypes ?? [];
  const nreq = argtypes.length - (f.ndefaults ?? 0);
  const args = argtypes.length
    ? `{\n${argtypes.map((t, i) => `          ${argnames[i]}${i >= nreq ? "?" : ""}: ${sqlTypeToTs(t)}`).join("\n")}\n        }`
    : "Record<PropertyKey, never>";
  let ret;
  if (f.result.startsWith("TABLE(")) {
    const inner = f.result.slice(6, -1);
    const parts = inner.split(/,\s*(?=[a-z_]+\s)/).map((s) => s.trim());
    ret = `{\n${parts.map((p) => { const [n, ...rest] = p.split(/\s+/); return `          ${n}: ${sqlTypeToTs(rest.join(" "))}`; }).join("\n")}\n        }[]`;
  } else if (f.rettyptype === "c" && f.retrelid) {
    ret = `Database["public"]["Tables"]["${f.rettype.replace(/^public\./, "")}"]["Row"]`;
    if (f.retset) ret += "[]";
  } else {
    ret = sqlTypeToTs(f.rettype);
    if (f.retset) ret += "[]";
  }
  return `      ${f.name}: {\n        Args: ${args}\n        Returns: ${ret}\n      }`;
}

const tables = rels.filter((r) => r.kind === "r");
const views = rels.filter((r) => r.kind === "v");

const out = `// このファイルは scripts/gen-db-types.mjs により自動生成されています。手で編集しないでください。
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
${tables.map((t) => `      ${t.name}: {\n${rowType(t.name, false)}\n        Relationships: []\n      }`).join("\n")}
    }
    Views: {
${views.map((v) => `      ${v.name}: {\n${rowType(v.name, true)}\n        Relationships: []\n      }`).join("\n")}
    }
    Functions: {
${fns.map(fnType).join("\n")}
    }
    Enums: {
${enums.map((e) => `      ${e.name}: ${e.labels.map((l) => JSON.stringify(l)).join(" | ")}`).join("\n")}
    }
    CompositeTypes: Record<string, never>
  }
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Update"];
export type Views<T extends keyof Database["public"]["Views"]> = Database["public"]["Views"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
`;
process.stdout.write(out);
await client.end();
