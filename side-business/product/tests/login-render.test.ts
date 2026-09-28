import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/** ログインの画面・無効な招待リンクの画面：パスワードを忘れたときの道すじと、連絡先 */
Object.assign(globalThis, { React });

vi.mock("~/server/auth", async () => ({
  currentUser: async () => null,
  roleAtLeast: () => true,
}));
vi.mock("~/db/client", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  delete process.env.DEMO_MODE;
});

async function loginHtml(): Promise<string> {
  const { default: Page } = (await import("~/app/login/page")) as unknown as { default: () => Promise<ReactElement> };
  return renderToString(await Page()).replace(/<!-- -->/g, "");
}

describe("ログインの画面", () => {
  it("パスワードを忘れたら「止める」→「招待のリンクを作る」の 2 段。オーナーが 1 人だけなら連絡先へ", async () => {
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = "help@example.com";
    const h = await loginHtml();
    expect(h).toContain("パスワードを忘れたとき");
    expect(h).toContain("「止める」");
    expect(h).toContain("「招待のリンクを作る」");
    expect(h).toContain("オーナーが 1 人だけ");
    expect(h).toContain("mailto:help@example.com");
  });

  it("連絡先が無いときは「導入を担当した者に」", async () => {
    expect(await loginHtml()).toContain("導入を担当した者にご連絡ください");
  });
});

describe("無効な招待リンク", () => {
  it("期限の日数を決めつけず、ログインの画面へのリンクを出す", async () => {
    const { default: Page } = (await import("~/app/invite/[token]/page")) as unknown as {
      default: (p: { params: Promise<{ token: string }> }) => Promise<ReactElement>;
    };
    const h = renderToString(await Page({ params: Promise.resolve({ token: "x" }) })).replace(/<!-- -->/g, "");
    expect(h).toContain("無効か、期限が切れています");
    expect(h).not.toContain("期限（7 日）");
    expect(h).toContain('href="/login"');
  });
});
