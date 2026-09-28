import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Vercel は product/ だけに npm install する（side-business/node_modules は無い）。
 * 共有の部品（../lib・../components/ui.tsx）が npm のパッケージを読むと、next build の型の確かめで止まる。
 * - react は product/node_modules の型を使う（tsconfig の paths）
 * - それ以外のパッケージを共有の部品から読まない
 */
const root = path.resolve(__dirname, "..");
const shared = path.resolve(root, "..");

function importsOf(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s[^"';]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/gm)) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

function resolveShared(spec: string, from: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/lib/")) base = path.join(shared, "lib", spec.slice("@/lib/".length));
  else if (spec === "@/components/ui") base = path.join(shared, "components", "ui");
  else if (spec.startsWith(".") && from.startsWith(shared) && !from.startsWith(root)) base = path.resolve(path.dirname(from), spec);
  if (!base) return null;
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function productFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".data", "tests", "e2e", "test-results", "playwright-report"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) productFiles(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("product だけを入れた置き場所でも型の確かめが通る", () => {
  it("tsconfig の paths で react の型を product/node_modules から読む", () => {
    const tsconfig = JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"));
    expect(tsconfig.compilerOptions.paths.react).toEqual(["./node_modules/@types/react"]);
    expect(tsconfig.compilerOptions.paths["react/*"]).toEqual(["./node_modules/@types/react/*"]);
  });

  it("product が使う共有の部品（../lib・../components/ui.tsx）は、react のほかに npm のパッケージを読まない", () => {
    const queue: string[] = [];
    for (const f of productFiles(root)) {
      for (const spec of importsOf(f)) {
        const hit = resolveShared(spec, f);
        if (hit) queue.push(hit);
      }
    }
    const seen = new Set<string>();
    const bad: string[] = [];
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const spec of importsOf(f)) {
        const hit = resolveShared(spec, f);
        if (hit) {
          queue.push(hit);
          continue;
        }
        if (spec.startsWith(".") || spec.startsWith("@/lib/") || spec === "@/components/ui") continue;
        if (spec === "react" || spec.startsWith("node:")) continue;
        bad.push(`${path.relative(shared, f)} → ${spec}`);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(bad).toEqual([]);
  });
});
