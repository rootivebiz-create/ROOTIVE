import { describe, expect, it } from "vitest";
import { buildPlan, projectNameFor, summaryLines, validateInput } from "../scripts/provision-plan";

const input = { client: "Sample Unso", databaseUrl: "postgres://u:p@h/db", repo: "me/shimebi", rootDirectory: "product" };

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
    expect(plan.env.map((e) => e.key)).toEqual(["DATABASE_URL", "APP_SECRET", "SETUP_TOKEN"]);
    expect(plan.secrets.appSecret).toBe("r48-0");
    expect(plan.createProjectBody).toMatchObject({ framework: "nextjs", rootDirectory: "product", gitRepository: { type: "github", repo: "me/shimebi" } });
    expect(summaryLines(plan, "https://x.vercel.app", false).join("\n")).toContain("/setup?token=r24-1");

    const demo = buildPlan({ ...input, demo: true, teamId: "team_1" });
    expect(demo.env.map((e) => e.key)).toEqual(["DATABASE_URL", "APP_SECRET", "DEMO_MODE"]);
    expect(demo.query).toBe("?teamId=team_1");
    expect(summaryLines(demo, "https://d.vercel.app", true).join("\n")).toContain("/demo/start");
  });
});
