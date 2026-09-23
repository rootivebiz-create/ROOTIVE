import * as React from "react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "~/server/auth";
import { FAQS, MONTH_END_STEPS, SUPPORT_FALLBACK, supportContact, WATCH_DOES, WATCH_DOES_NOT } from "~/components/help/content";
import { LINK_DAYS } from "~/server/features/statements/view";

/**
 * ヘルプ：月末の流れ（6 つ）・よくある質問・見張り番のすること／しないこと・データの置き場所・連絡先。
 * 役割で開けない画面にはリンクを付けない。連絡先は環境変数から（無ければ「導入を担当した者に」）。
 */
const state: { user?: SessionUser } = {};

Object.assign(globalThis, { React });

vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  const roleAtLeast = (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need];
  return {
    roleAtLeast,
    requirePageUser: async (need: keyof typeof RANK = "viewer") => {
      if (!roleAtLeast(state.user!.role, need)) throw new Error("FORBIDDEN");
      return state.user;
    },
    AuthError: class AuthError extends Error {},
  };
});

const FORBIDDEN = ["適法です", "違反はありません", "問題ありません", "法令に完全対応", "監査は大丈夫", "必ず合う", "ミスゼロ", "完全自動", "補助金が使えます", "偽装請負", "労働者にあたります"];

async function render(role: SessionUser["role"]): Promise<string> {
  state.user = { id: "00000000-0000-4000-8000-000000000001", tenantId: "00000000-0000-4000-8000-000000000002", email: "x@example.com", name: "テスト", role };
  const { default: Page } = (await import("~/app/(app)/help/page")) as unknown as { default: () => Promise<ReactElement> };
  return renderToString(await Page()).replace(/<!-- -->/g, "");
}

/** 画面の場所（/statements/inbox など）に、ページのファイルがあるか */
function pageExists(href: string): boolean {
  const root = path.resolve(__dirname, "..", "app", "(app)");
  return existsSync(path.join(root, href === "/" ? "" : href, "page.tsx"));
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  delete process.env.NEXT_PUBLIC_SUPPORT_LINE_URL;
});

describe("ヘルプの中身", () => {
  it("月末の流れは 6 つ。取り込み → 見張り番 → 明細 → 振込 → 締め → 突合・利益・会計の順", () => {
    expect(MONTH_END_STEPS).toHaveLength(6);
    expect(MONTH_END_STEPS.map((s) => s.links[0].href)).toEqual(["/import", "/watch", "/statements", "/transfer", "/close", "/reconcile"]);
  });

  it("よくある質問に、事務の困りごと 6 つがそろっている", () => {
    const qs = FAQS.map((f) => f.q).join("\n");
    for (const topic of ["名前が合わない", "明細を直したい", "締めを外したい", "振込データを銀行に取り込む", "ドライバーが明細を開けない", "会計ソフトに取り込みたい"]) {
      expect(qs).toContain(topic);
    }
  });

  it("リンク先の画面はすべてある", () => {
    const hrefs = [...MONTH_END_STEPS.flatMap((s) => s.links), ...FAQS.flatMap((f) => f.links)].map((l) => l.href);
    for (const href of [...hrefs, "/data", "/settings/account", "/settings/ai", "/watch"]) expect(pageExists(href), href).toBe(true);
  });

  it("ヘルプに書いたボタン・見出しの名前と日数は、実際の画面・決まりと同じ（言葉がずれて迷わせない）", () => {
    const text = [...MONTH_END_STEPS.map((x) => x.body), ...FAQS.flatMap((f) => f.a)].join("\n");
    const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");
    const labels: [label: string, file: string][] = [
      ["名前の確認", "app/(app)/import/[id]/page.tsx"],
      ["覚えている読み方", "app/(app)/import/page.tsx"],
      ["明細を作り直す", "app/(app)/statements/page.tsx"],
      ["リンクを作り直す", "components/statements/link-panel.tsx"],
      ["締めを外す", "components/close/close-forms.tsx"],
      ["実際に振り込んだ日", "app/(app)/transfer/page.tsx"],
      ["招待のリンクを作る", "components/settings/user-forms.tsx"],
    ];
    for (const [label, file] of labels) {
      expect(text, label).toContain(`「${label}」`);
      expect(read(file), `${label} は ${file} にある`).toContain(label);
    }
    // ドライバーのリンクの期限（明細の画面の決まりと同じ日数）
    expect(text).toContain(`作った日から ${LINK_DAYS} 日`);
  });

  it("見張り番は判定をしない、と書く（判定・保証の言葉は使わない）", () => {
    const text = [...WATCH_DOES, ...WATCH_DOES_NOT, ...FAQS.flatMap((f) => [f.q, ...f.a]), ...MONTH_END_STEPS.map((s) => s.body)].join("\n");
    expect(WATCH_DOES_NOT.join("")).toContain("判断はしません");
    expect(WATCH_DOES_NOT.join("")).toContain("税理士・弁護士・社労士");
    for (const word of FORBIDDEN) expect(text).not.toContain(word);
  });

  it("連絡先：環境変数があればそれを、無ければ「導入を担当した者に」。形のおかしいものは使わない", () => {
    expect(supportContact({})).toEqual({ email: null, lineUrl: null, fallback: SUPPORT_FALLBACK });
    expect(SUPPORT_FALLBACK).toContain("導入を担当した者にご連絡ください");
    expect(supportContact({ NEXT_PUBLIC_SUPPORT_EMAIL: " help@example.jp ", NEXT_PUBLIC_SUPPORT_LINE_URL: "https://lin.ee/abc" })).toMatchObject({
      email: "help@example.jp",
      lineUrl: "https://lin.ee/abc",
    });
    expect(supportContact({ NEXT_PUBLIC_SUPPORT_EMAIL: "help", NEXT_PUBLIC_SUPPORT_LINE_URL: "http://lin.ee/abc" })).toMatchObject({ email: null, lineUrl: null });
    expect(supportContact({ NEXT_PUBLIC_SUPPORT_LINE_URL: "javascript:alert(1)" }).lineUrl).toBeNull();
    expect(supportContact({ NEXT_PUBLIC_SUPPORT_EMAIL: 'a@b.jp"><script>' }).email).toBeNull();
  });
});

describe("ヘルプの画面", () => {
  it("見るだけの人：6 つの流れ・質問・見張り番・データの置き場所。事務の画面とオーナーの画面にはリンクを付けない", async () => {
    const h = await render("viewer");
    for (const s of MONTH_END_STEPS) expect(h).toContain(s.title);
    for (const f of FAQS) expect(h).toContain(f.q);
    expect(h).toContain("見張り番がすること・しないこと");
    expect(h).toContain("お客様のサーバー");
    expect(h).toContain("全データの書き出し");
    expect(h).not.toContain('href="/export"');
    expect(h).toContain("会計ソフトへ（事務・オーナーが使います）");
    expect(h).not.toContain('href="/data"');
    expect(h).not.toContain('href="/settings/users"');
    expect(h).toContain('href="/import"');
    expect(h).toContain('href="/settings/account"');
    // 連絡先が無ければ「導入を担当した者に」
    expect(h).toContain(SUPPORT_FALLBACK);
    for (const word of FORBIDDEN) expect(h).not.toContain(word);
  });

  it("事務：会計ソフトへのリンクがある。オーナー：全データの書き出し・利用者へのリンクもある", async () => {
    const staff = await render("staff");
    expect(staff).toContain('href="/export"');
    expect(staff).not.toContain('href="/data"');
    const owner = await render("owner");
    expect(owner).toContain('href="/data"');
    expect(owner).toContain('href="/settings/users"');
  });

  it("連絡先の環境変数があれば、メールと LINE のリンクを出す", async () => {
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL = "support@example.jp";
    process.env.NEXT_PUBLIC_SUPPORT_LINE_URL = "https://lin.ee/example";
    const h = await render("staff");
    expect(h).toContain('href="mailto:support@example.jp"');
    expect(h).toContain('href="https://lin.ee/example"');
    expect(h).toContain('rel="noopener noreferrer"');
    expect(h).not.toContain(SUPPORT_FALLBACK);
  });
});
