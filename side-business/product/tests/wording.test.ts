import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 文面の自動チェック：製品のコード（app・components・server の .ts / .tsx。テストは除く）に、
 * 言ってはいけない言い方が入っていないかを 1 行ずつ見る。画面の文・PDF・問い合わせ文・CSV の見出し・コメントもすべて対象。
 * 当たったら「ファイル:行」で知らせる。
 *
 * - 言ってはいけない言葉の一覧そのもの（正規表現や文字の配列で 2 つ以上を並べた行）は数えない
 * - 否定・注意の文として安全に使っているものだけ、ALLOW に理由つきで入れる（入れすぎない）
 */

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["app", "components", "server"];

/** 言ってはいけない言い方（法令の判定・断定・過大な約束・報酬を下げる話） */
const FORBIDDEN_PHRASES = [
  "違反です",
  "違反はありません",
  "適法です",
  "問題ありません",
  "対応済み",
  "完全対応",
  "防げます",
  "必ず合う",
  "ミスゼロ",
  "完全自動",
  "補助金が使えます",
  "単価を下げ",
  "引き下げ",
] as const;

/**
 * 言葉の一覧で書けないもの（正規表現）。名前はテストの知らせに出す。
 * - SPEC の文面のテストは「適法」そのものを禁じる。ただし「取適法」（法律の略称）は数えない
 * - 労働者に当たるか・偽装請負かの判断、「調査・監査は大丈夫」のような保証も書かない
 */
const FORBIDDEN_PATTERNS: { name: string; re: RegExp; /** 同じ行が一覧のこの言葉で当たっていれば二重に数えない */ sameAs?: string }[] = [
  { name: "適法（取適法は除く）", re: /(?<!取)適法/, sameAs: "適法です" },
  { name: "偽装請負", re: /偽装請負/ },
  { name: "労働者に当たる（判断）", re: /労働者に(当た|あた|該当)/ },
  { name: "調査・監査は大丈夫（保証）", re: /(調査|監査|検査)[^。]{0,12}大丈夫/ },
];

/** 安全な使い方として認めるもの（ファイル・言葉・その行に含まれる文・理由） */
const ALLOW: { file: string; phrase: string; contains: string; reason: string }[] = [
  {
    file: "server/features/watch-types.ts",
    phrase: "適法（取適法は除く）",
    contains: "適法・違反の判定はしない",
    reason: "見張り番の型のコメントで「適法・違反の判定はしない」と、判断しないことを書いた否定の文。画面には出ない",
  },
  {
    file: "server/features/reconcile/facts.ts",
    phrase: "適法（取適法は除く）",
    contains: "適法・違反などの判断はしない",
    reason: "突合の純関数のコメントで「適法・違反などの判断はしない」と、判断しないことを書いた否定の文。画面には出ない",
  },
];

type Hit = { file: string; line: number; phrase: string; text: string };

/** 言葉の一覧を定義している行か（正規表現の | や、文字の配列で、一覧の言葉を 2 つ以上並べている） */
function isListDefinition(line: string, phrases: readonly string[]): boolean {
  const found = phrases.filter((p) => line.includes(p)).length + FORBIDDEN_PATTERNS.filter((p) => p.re.test(line)).length;
  if (found < 2) return false;
  return /\/[^/]*\|[^/]*\//.test(line) || /["'`][^"'`]*["'`]\s*,\s*["'`]/.test(line);
}

/** 文字列の中から、言ってはいけない言い方を探す（ファイル名は表示用） */
function scanText(file: string, text: string, phrases: readonly string[] = FORBIDDEN_PHRASES): Hit[] {
  const hits: Hit[] = [];
  const allowed = (phrase: string, line: string) => ALLOW.some((a) => a.file === file && a.phrase === phrase && line.includes(a.contains));
  text.split(/\r?\n/).forEach((line, index) => {
    if (isListDefinition(line, phrases)) return;
    const at = { file, line: index + 1, text: line.trim().slice(0, 120) };
    for (const phrase of phrases) {
      if (line.includes(phrase) && !allowed(phrase, line)) hits.push({ ...at, phrase });
    }
    for (const p of FORBIDDEN_PATTERNS) {
      // 「適法です」は上の一覧でも当たるので、同じ行を二重に数えない
      const counted = p.sameAs !== undefined && hits.some((h) => h.line === at.line && h.phrase === p.sameAs);
      if (p.re.test(line) && !counted && !allowed(p.name, line)) hits.push({ ...at, phrase: p.name });
    }
  });
  return hits;
}

/** 製品のコードのファイル（テスト・node_modules・.next を除く） */
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

describe("文面の自動チェック（言ってはいけない言い方）", () => {
  it("app・components・server のどのファイルにも、言ってはいけない言い方が無い", () => {
    const files = productFiles();
    // 画面・機能のファイルをきちんと読めているか（読めていないのに通らないように）
    expect(files.length).toBeGreaterThan(50);
    expect(files.map(rel)).toEqual(expect.arrayContaining(["server/features/watch/rules.ts", "app/(app)/watch/page.tsx", "components/watch/issue-card.tsx"]));
    const hits = files.flatMap((f) => scanText(rel(f), readFileSync(f, "utf8")));
    const report = hits.map((h) => `${h.file}:${h.line}  「${h.phrase}」  ${h.text}`).join("\n");
    expect(hits, `言ってはいけない言い方が見つかりました：\n${report}`).toEqual([]);
  });

  it("見つけ方の確認：文の中なら当たる。一覧の定義・認めた文は当たらない", () => {
    expect(scanText("x.ts", 'const a = "この控除は適法です";\nconst b = 1;')).toEqual([{ file: "x.ts", line: 1, phrase: "適法です", text: 'const a = "この控除は適法です";' }]);
    expect(scanText("x.tsx", "<p>単価を下げると利益が増えます</p>")).toHaveLength(1);
    expect(scanText("x.tsx", "<p>免税の方は単価の引き下げを</p>")).toHaveLength(1);
    // 同じ行に 2 つ並んでいても、文なら当たる
    expect(scanText("x.ts", "`違反はありません。問題ありません。`")).toHaveLength(2);
    // 一覧の定義（正規表現・配列）は数えない
    expect(scanText("x.ts", "const NG = /違反です|適法です|問題ありません/;")).toHaveLength(0);
    expect(scanText("x.ts", 'const NG = ["違反です", "適法です"];')).toHaveLength(0);
    // 認めた文は、そのファイルのその文だけ
    const allowed = " * 突合の純関数は…適法・違反などの判断はしない。";
    expect(scanText("server/features/reconcile/facts.ts", allowed)).toHaveLength(0);
    expect(scanText("components/other.tsx", allowed)).toHaveLength(1);
    // 否定の言い方（「〜のおそれがあります」「確認をおすすめします」）は当たらない
    expect(scanText("x.ts", "報酬の減額にあたるおそれがあります。確認をおすすめします。")).toHaveLength(0);
  });

  it("見つけ方の確認（正規表現）：「適法」は当たり「取適法」は当たらない。労働者・偽装請負の判断、調査の保証も当たる", () => {
    expect(scanText("x.tsx", "<p>この控除は適法かどうか…</p>").map((h) => h.phrase)).toEqual(["適法（取適法は除く）"]);
    // 「適法です」は 1 回だけ数える
    expect(scanText("x.tsx", "<p>この控除は適法です</p>")).toHaveLength(1);
    expect(scanText("x.ts", "取適法の対象になる可能性があります。取適法（中小受託取引適正化法）")).toHaveLength(0);
    expect(scanText("x.ts", "`この方は労働者に当たります`").map((h) => h.phrase)).toEqual(["労働者に当たる（判断）"]);
    expect(scanText("x.ts", "`偽装請負のおそれ`").map((h) => h.phrase)).toEqual(["偽装請負"]);
    expect(scanText("x.ts", "`これで税務調査も大丈夫です`").map((h) => h.phrase)).toEqual(["調査・監査は大丈夫（保証）"]);
    expect(scanText("x.ts", "`スマホでも大丈夫です`")).toHaveLength(0);
    // 正規表現で並べた一覧の定義は数えない
    expect(scanText("x.ts", "const NG = /(?<!取)適法|偽装請負|違反です/;")).toHaveLength(0);
    // 認めた否定のコメントは、そのファイルのその文だけ
    expect(scanText("server/features/watch-types.ts", " * 見張り番は…適法・違反の判定はしない。")).toHaveLength(0);
    expect(scanText("server/features/other.ts", " * 見張り番は…適法・違反の判定はしない。")).toHaveLength(1);
  });

  it("認めた文は、どれも理由が書いてあり、一覧の言葉に対するもの（ファイルから消えたら知らせる）", () => {
    for (const a of ALLOW) {
      expect(a.reason.length, a.file).toBeGreaterThan(20);
      expect([...FORBIDDEN_PHRASES, ...FORBIDDEN_PATTERNS.map((p) => p.name)]).toContain(a.phrase);
      const full = path.join(ROOT, a.file);
      let text = "";
      try {
        text = readFileSync(full, "utf8");
      } catch {
        text = "";
      }
      // ファイルが直されて文が消えたら、この許可も消してよい（そのときはここで知らせる）
      if (text && !text.includes(a.contains)) console.warn(`wording.test: 許可の文が見つかりません（消してよい）：${a.file}「${a.contains}」`);
    }
  });
});
