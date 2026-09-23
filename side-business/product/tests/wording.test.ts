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

/** 安全な使い方として認めるもの（ファイル・言葉・その行に含まれる文・理由） */
const ALLOW: { file: string; phrase: string; contains: string; reason: string }[] = [
  {
    file: "components/settings/project-form.tsx",
    phrase: "単価を下げ",
    contains: "支払単価を下げようとしています",
    reason:
      "単価を下げる操作をしようとしている人への注意（減額のおそれ・合意と明示のすすめ）で、下げることを勧める文ではない。言い換え（「支払単価が今より低くなります」など）を設定の担当に依頼済み",
  },
];

type Hit = { file: string; line: number; phrase: string; text: string };

/** 言葉の一覧を定義している行か（正規表現の | や、文字の配列で 2 つ以上を並べている） */
function isListDefinition(line: string, phrases: readonly string[]): boolean {
  const found = phrases.filter((p) => line.includes(p));
  if (found.length < 2) return false;
  return /\/[^/]*\|[^/]*\//.test(line) || /["'`][^"'`]*["'`]\s*,\s*["'`]/.test(line);
}

/** 文字列の中から、言ってはいけない言い方を探す（ファイル名は表示用） */
function scanText(file: string, text: string, phrases: readonly string[] = FORBIDDEN_PHRASES): Hit[] {
  const hits: Hit[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (isListDefinition(line, phrases)) return;
    for (const phrase of phrases) {
      if (!line.includes(phrase)) continue;
      const allowed = ALLOW.some((a) => a.file === file && a.phrase === phrase && line.includes(a.contains));
      if (!allowed) hits.push({ file, line: index + 1, phrase, text: line.trim().slice(0, 120) });
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
    const allowed = "支払単価を下げようとしています。すでに仕事をした分に…";
    expect(scanText("components/settings/project-form.tsx", allowed)).toHaveLength(0);
    expect(scanText("components/other.tsx", allowed)).toHaveLength(1);
    // 否定の言い方（「〜のおそれがあります」「確認をおすすめします」）は当たらない
    expect(scanText("x.ts", "報酬の減額にあたるおそれがあります。確認をおすすめします。")).toHaveLength(0);
  });

  it("認めた文は、どれも理由が書いてあり、一覧の言葉に対するもの（ファイルから消えたら知らせる）", () => {
    for (const a of ALLOW) {
      expect(a.reason.length, a.file).toBeGreaterThan(20);
      expect(FORBIDDEN_PHRASES as readonly string[]).toContain(a.phrase);
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
