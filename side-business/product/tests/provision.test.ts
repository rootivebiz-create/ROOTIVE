import { describe, expect, it } from "vitest";
import { migrationDecision } from "../scripts/migrate-guard";
import { buildPlan, projectNameFor, summaryLines, validateInput, type ProvisionPlan } from "../scripts/provision-plan";

const input = { client: "Sample Unso", databaseUrl: "postgres://u:p@h/db", repo: "me/shimebi", rootDirectory: "product" };

function keysFor(plan: ProvisionPlan, target: "production" | "preview"): string[] {
  return plan.env.filter((e) => e.target.includes(target)).map((e) => e.key);
}

describe("お客様の置き場所の手順", () => {
  it("プロジェクト名は英小文字とハイフン。日本語だけの名前でも作れる", () => {
    expect(projectNameFor("Sample Unso")).toBe("shimebi-sample-unso");
    expect(projectNameFor("〇〇運送")).toMatch(/^shimebi-client-[0-9a-z]+$/);
    expect(projectNameFor("x", true)).toBe("shimebi-demo");
  });

  it("入力の誤りを日本語で返す", () => {
    expect(validateInput(input)).toEqual([]);
    expect(validateInput({ ...input, databaseUrl: "mysql://x", repo: "bad", rootDirectory: "/abs", client: "" })).toHaveLength(4);
  });

  it("本番は SETUP_TOKEN、デモは DEMO_MODE を入れる。秘密の値は毎回ちがう", () => {
    let n = 0;
    const plan = buildPlan(input, (len) => `r${len}-${n++}`);
    expect(keysFor(plan, "production")).toEqual(["DATABASE_URL", "APP_SECRET", "SETUP_TOKEN"]);
    expect(plan.secrets.appSecret).toBe("r48-0");
    expect(plan.createProjectBody).toMatchObject({ framework: "nextjs", rootDirectory: "product", gitRepository: { type: "github", repo: "me/shimebi" } });
    expect(summaryLines(plan, "https://x.vercel.app", false).join("\n")).toContain("/setup?token=r24-1");

    const demo = buildPlan({ ...input, demo: true, teamId: "team_1" });
    expect(keysFor(demo, "production")).toEqual(["DATABASE_URL", "APP_SECRET", "DEMO_MODE"]);
    expect(demo.query).toBe("?teamId=team_1");
    expect(summaryLines(demo, "https://d.vercel.app", true).join("\n")).toContain("/demo/start");
  });

  it("問い合わせ先（メール・LINE）を渡すと NEXT_PUBLIC_SUPPORT_* を入れる。無ければ最後の案内で知らせる。形が違えば止める", () => {
    const plan = buildPlan({ ...input, supportEmail: " help@example.com ", supportLineUrl: "https://lin.ee/abc" });
    expect(plan.env.filter((e) => e.key.startsWith("NEXT_PUBLIC_SUPPORT_"))).toEqual([
      { key: "NEXT_PUBLIC_SUPPORT_EMAIL", value: "help@example.com", type: "plain", target: ["production", "preview"] },
      { key: "NEXT_PUBLIC_SUPPORT_LINE_URL", value: "https://lin.ee/abc", type: "plain", target: ["production", "preview"] },
    ]);
    expect(summaryLines(plan, "https://x.vercel.app", false).join("\n")).not.toContain("問い合わせ先");
    expect(summaryLines(buildPlan(input), "https://x.vercel.app", false).join("\n")).toContain("問い合わせ先（--support-email・--support-line）が入っていません");
    expect(validateInput({ ...input, supportEmail: "no-at-mark", supportLineUrl: "http://insecure" })).toHaveLength(2);
  });

  it("プレビューには、お客様の DB・本番の鍵・登録の合言葉を入れない（揮発する PGlite のデモと、別の APP_SECRET だけ）", () => {
    for (const demo of [false, true]) {
      let n = 0;
      const plan = buildPlan({ ...input, demo }, (len) => `r${len}-${n++}`);
      const previewVars = plan.env.filter((e) => e.target.includes("preview"));
      expect(previewVars.map((e) => e.key)).toEqual(["APP_SECRET", "PGLITE_DIR", "DEMO_MODE"]);
      expect(previewVars.find((e) => e.key === "PGLITE_DIR")?.value).toBe("memory");
      expect(previewVars.find((e) => e.key === "DEMO_MODE")?.value).toBe("1");
      // 本番の鍵とは別の値
      const prodSecret = plan.env.find((e) => e.key === "APP_SECRET" && e.target.includes("production"))!;
      const previewSecret = previewVars.find((e) => e.key === "APP_SECRET")!;
      expect(previewSecret.value).not.toBe(prodSecret.value);
      expect(prodSecret.target).toEqual(["production"]);
      // 秘密の値・お客様の DB は、どれも本番だけ
      for (const e of plan.env) {
        if (["DATABASE_URL", "SETUP_TOKEN"].includes(e.key)) expect(e.target).toEqual(["production"]);
        expect(e.target).not.toContain("development");
      }
      expect(plan.env.some((e) => e.value === input.databaseUrl && e.target.includes("preview"))).toBe(false);
    }
  });

  it("ビルドの前のマイグレーションは、Vercel の本番のビルドのときだけ当てる（プレビューでは本番の DB に触れない）", () => {
    const url = "postgres://u:p@h/db";
    expect(migrationDecision({ ifConfigured: true, databaseUrl: url, vercelEnv: "production" })).toEqual({ run: true, url });
    expect(migrationDecision({ ifConfigured: true, databaseUrl: url, vercelEnv: "preview" })).toMatchObject({ run: false });
    expect(migrationDecision({ ifConfigured: true, databaseUrl: url, vercelEnv: "development" })).toMatchObject({ run: false });
    // Vercel の外（手元・provision.ts）では今までどおり
    expect(migrationDecision({ ifConfigured: true, databaseUrl: url })).toEqual({ run: true, url });
    expect(migrationDecision({ ifConfigured: false, databaseUrl: url, vercelEnv: "preview" })).toEqual({ run: true, url });
    // DATABASE_URL が無い：--if-configured なら飛ばす、手で動かしたなら止める
    expect(migrationDecision({ ifConfigured: true, databaseUrl: "" })).toMatchObject({ run: false });
    expect(migrationDecision({ ifConfigured: false })).toMatchObject({ run: false, fail: true });
  });
});
