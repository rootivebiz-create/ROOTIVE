import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deductibleRateForExempt, TRANSITIONAL_STEPS } from "@/lib/payroll/tax";

/**
 * 経過措置の割合（80%・70%・50%・30%）を、製品のコードに直接書いていないかを確かめる。
 * 割合は日付で変わる（令和8年度の改正でも段が変わった）ので、必ず @/lib/payroll/tax の日付つきの表
 * （TRANSITIONAL_STEPS・deductibleRateForExempt・nonDeductibleTax）から引く。直書きすると、表を直しても画面や計算が古いまま残る。
 *
 * 見るもの：app・components・server の .ts / .tsx（テストは除く）の各行で、
 *   ① 0.8・0.7・0.5・0.3 や 80%・70%・50%・30% の数字がコードの部分にあり、
 *   ② 同じ行に税の話（経過措置・控除できる・deductible・invoice・インボイス・免税・exempt・仕入税額・burden・transitional）がある
 * もの。当たったら「ファイル:行」で知らせる。
 *
 * 認めるもの：
 * - 表そのものを置いている side-business/lib/payroll/tax.ts（製品の外。ここでは読まない）
 * - コメントだけの行（// … や JSDoc の * …）。計算にも画面にも出ず、「0.7 など」と例を書いた説明だから
 * - ALLOW に理由つきで入れた説明の文（いまは無い）
 */

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["app", "components", "server"];

/** 経過措置の割合に見える数字（1.05 や 0.75、300% などは除く） */
const RATE_LITERAL = /(?<![\d.])0\.[3578](?![\d])|(?<![\d.])[3578]0\s*[%％]/;
/** 税の話をしている行 */
const TAX_CONTEXT = /経過措置|控除でき|deductible|invoice|インボイス|免税|exempt|仕入税額|burden|transitional/i;

const ALLOW: { file: string; contains: string; reason: string }[] = [];

type Hit = { file: string; line: number; text: string };

/** コメントだけの行か */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("{/*");
}

/** 行の中のコードの部分（行末の // コメントを外す。文字列の中の // ＝ URL などは外さない） */
function codePart(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

function scanText(file: string, text: string): Hit[] {
  const hits: Hit[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (isCommentLine(line) || !TAX_CONTEXT.test(line)) return;
    if (!RATE_LITERAL.test(codePart(line))) return;
    if (ALLOW.some((a) => a.file === file && line.includes(a.contains))) return;
    hits.push({ file, line: index + 1, text: line.trim().slice(0, 120) });
  });
  return hits;
}

function productFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
  };
  for (const d of DIRS) walk(path.join(ROOT, d));
  return out.sort();
}

const rel = (full: string) => path.relative(ROOT, full).split(path.sep).join("/");

describe("経過措置の割合を直書きしない", () => {
  it("app・components・server に、税の話と一緒に 0.8・0.7・0.5・0.3・80%・70%・50%・30% を書いた行が無い", () => {
    const files = productFiles();
    expect(files.length).toBeGreaterThan(50);
    const hits = files.flatMap((f) => scanText(rel(f), readFileSync(f, "utf8")));
    const report = hits.map((h) => `${h.file}:${h.line}  ${h.text}`).join("\n");
    expect(hits, `経過措置の割合を直書きしている行があります。@/lib/payroll/tax の表から引いてください：\n${report}`).toEqual([]);
  });

  it("見つけ方の確認：コードや画面の文なら当たる。コメント・税と関係ない数字・URL は当たらない", () => {
    expect(scanText("x.ts", "const burden = invoiceBase * 0.3;")).toHaveLength(1);
    expect(scanText("x.ts", "const rate = 0.7; // 経過措置")).toHaveLength(1);
    expect(scanText("x.tsx", "<p>経過措置で控除できる割合は 80% です</p>")).toHaveLength(1);
    expect(scanText("x.tsx", "<p>免税の方は70％</p>")).toHaveLength(1);
    expect(scanText("x.ts", "const EXEMPT_RATE = 0.8;")).toHaveLength(1);
    expect(scanText("x.ts", "const burden = base * 0.3 / 1.1;")).toHaveLength(1);
    // コメントだけの行は説明（例）なので数えない
    expect(scanText("x.ts", "/** 控除できる割合（0.7 = 70%） */")).toHaveLength(0);
    expect(scanText("x.ts", "  // 経過措置が 70% になる最初の月")).toHaveLength(0);
    // 税と関係ない数字（数量の急な変化 ±50%・文字の割合 0.8）は数えない
    expect(scanText("x.ts", "export const QTY_JUMP_RATIO = 0.5;")).toHaveLength(0);
    expect(scanText("x.ts", "if (textShare(values) >= 0.8) {")).toHaveLength(0);
    // 表から引いた値を文にするのは良い
    expect(scanText("x.ts", "`控除できる割合 ${pct(deductibleRateForExempt(date))}`")).toHaveLength(0);
    // 1.08・0.75・300% のような別の数は当たらない
    expect(scanText("x.ts", "const invoiceX = 1.08 + 0.75; // 300%")).toHaveLength(0);
    // URL の中の // で行を切らない
    expect(scanText("x.ts", 'const url = "https://example.invalid/invoice"; const r = 0.8;')).toHaveLength(1);
  });

  it("割合の表は @/lib/payroll/tax にあり、段ごとの割合はそこから引ける（見張り番もこの表を使う）", () => {
    expect(TRANSITIONAL_STEPS.length).toBeGreaterThanOrEqual(4);
    for (const step of TRANSITIONAL_STEPS) expect(deductibleRateForExempt(step.from)).toBe(step.rate);
    // 見張り番のルールのファイルは表を import している（直書きしない）
    const rules = readFileSync(path.join(ROOT, "server/features/watch/rules.ts"), "utf8");
    expect(rules).toMatch(/from "@\/lib\/payroll\/tax"/);
    expect(rules).toContain("TRANSITIONAL_STEPS");
  });
});
