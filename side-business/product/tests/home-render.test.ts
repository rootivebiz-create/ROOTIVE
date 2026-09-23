import * as React from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import type { Db } from "~/db/client";
import * as s from "~/db/schema";
import type { SessionUser } from "~/server/auth";
import { saveParallelChecks } from "~/server/features/parallel";
import { seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

/**
 * ホーム・最初の設定・Excel と比べる の画面を HTML にしてみる（ログインと DB だけ差し替える）。
 * 役割ごとに、出してよいもの・隠すものが正しいかを文字で確かめる。
 */
const state: { db?: Db; user?: SessionUser } = {};

// テストの変換は JSX を React.createElement にするので、React を見えるところに置く
Object.assign(globalThis, { React });

vi.mock("~/db/client", () => ({ getDb: async () => state.db }));
vi.mock("~/server/auth", async () => {
  const RANK = { viewer: 1, staff: 2, owner: 3 } as const;
  return {
    roleAtLeast: (role: keyof typeof RANK, need: keyof typeof RANK) => RANK[role] >= RANK[need],
    requirePageUser: async () => state.user,
    requireUser: async () => state.user,
    AuthError: class AuthError extends Error {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// 見張り番は別の機能（ルールは別に試す）。ここでは指摘なしにして、画面の流れだけを見る
vi.mock("~/server/features/watch", () => ({ runWatch: async () => [] }));

type Page = (props: { searchParams: Promise<{ m?: string }> }) => Promise<ReactElement>;

async function render(page: Page | (() => Promise<ReactElement>), m = "2026-10"): Promise<string> {
  const el = await (page as Page)({ searchParams: Promise.resolve({ m }) });
  return renderToString(el).replace(/<!-- -->/g, "");
}

describe("ホーム・最初の設定・Excel と比べる の画面", () => {
  let client: PGlite;
  let tenantId: string;
  let users: SessionUser[];

  beforeAll(async () => {
    const t = await createTestDb();
    state.db = t.db;
    client = t.client;
    ({ tenantId } = await seedDemo(t.db));
    const rows = await t.db.select().from(s.users).where(eq(s.users.tenantId, tenantId));
    users = rows.map((u) => ({ id: u.id, tenantId: u.tenantId, email: u.email, name: u.name, role: u.role as SessionUser["role"] }));
    users.push({ id: rows[0].id, tenantId, email: "viewer@demo.example", name: "閲覧の人", role: "viewer" });
  });
  afterAll(async () => client.close());

  const as = (role: SessionUser["role"]) => {
    state.user = users.find((u) => u.role === role)!;
  };

  it("ホーム（事務）：次にやることは明細を作る。最初の設定の案内・利益・突合・質問のカード", async () => {
    as("staff");
    const { default: HomePage } = await import("~/app/(app)/page");
    const html = await render(HomePage);
    expect(html).toContain("2026年10月分の締め");
    expect(html).toContain("次にやること（3. 支払明細）");
    expect(html).toContain("明細を作る（8人）");
    expect(html).toContain('href="/statements?m=2026-10"');
    expect(html).toContain("ドライバーへの支払日は 11月25日（水）");
    expect(html).toContain("最初の設定：7 つのうち 5 つ済み");
    expect(html).toContain("次は「取引条件の明示」です");
    expect(html).toContain("稼働 11 件（8人）・調整 2 件");
    expect(html).toContain("¥980,270");
    // 突合：まだ「突き合わせる」を押していなくても、突合の画面・利益の画面と同じ見込みの額が出る
    expect(html).toContain("見つけたお金（2026年10月分・元請との突合）");
    expect(html).toContain("¥91,700");
    expect(html).not.toContain("突き合わせると、請求との差が分かります");
    expect(html).toContain("まだ解決していない質問はありません");
  });

  it("ホーム（閲覧）：案内は出さず、見るボタンとだれが進めるか", async () => {
    as("viewer");
    const { default: HomePage } = await import("~/app/(app)/page");
    const html = await render(HomePage);
    expect(html).not.toContain("最初の設定：");
    expect(html).toContain("明細の様子を見る");
    expect(html).toContain("事務・オーナーの方が進めます");
  });

  it("ホーム（9 月・締め済み）：締めは終わりました", async () => {
    as("staff");
    const { default: HomePage } = await import("~/app/(app)/page");
    const html = await render(HomePage, "2026-09");
    expect(html).toContain("2026年9月分の締めは終わりました");
    expect(html).toContain("締め済み");
    expect(html).toContain("明細なし");
  });

  it("最初の設定：7 つの手順・時間の目安・とばすボタン", async () => {
    as("staff");
    const { default: OnboardingPage } = await import("~/app/(app)/onboarding/page");
    const html = await render(OnboardingPage);
    expect(html).toContain("7 つのうち 5 つ済み");
    expect(html).toContain("5. 取引条件の明示をはじめる（約10分）");
    expect(html).toContain('href="/terms"');
    expect(html).toContain("記録（明示書か、明示した日）が見つからない人が 1人います（有効な 8人のうち）：遠藤 大輔さん");
    expect(html).toContain("7. Excel と比べる");
    expect(html).toContain("控除のルール 4 件");
    expect(html).toContain("あとでやる");
    // 取り込み・比べ合わせは先月（今日から見て）の分を開く
    expect(html).toMatch(/href="\/parallel\?m=\d{4}-\d{2}"/);
    expect(html).toMatch(/href="\/import\?m=\d{4}-\d{2}"/);
  });

  it("会社の基本：事務には中身とオーナーの名前、オーナーには入力の画面", async () => {
    const { default: CompanyPage } = await import("~/app/(app)/onboarding/company/page");
    as("staff");
    let html = await render(CompanyPage);
    expect(html).toContain("会社の基本を保存できるのはオーナーの方です（デモ 社長さん）");
    expect(html).toContain("資本金と従業員の数は、取適法の対象かの目安に使います。");
    expect(html).toContain("毎月末日締め・翌月25日払い");
    expect(html).not.toContain("保存する");
    as("owner");
    html = await render(CompanyPage);
    expect(html).toContain("保存する");
    expect(html).toContain("振込手数料はどちらが持ちますか");
    expect(html).toContain("60日・2か月の中に入ります");
    // 設定の画面と同じ 3 つ（免税の会社がここで保存しても、原則課税に変わらない）
    expect(html).toContain("免税（会社が消費税を納めていない）");
    // 会社の大きさ（任意）と、聞く理由の 1 行
    expect(html).toContain("会社の大きさ（任意）");
    expect(html).toContain("取適法の対象かの目安に使います");
    expect(html).toContain('name="capitalYen"');
    expect(html).toContain('name="employees"');
    // 済んだ手順には「あとでやる」を出さない
    expect(html).toContain("この手順：済み");
    expect(html).not.toContain("この手順はあとでやる");
  });

  it("ドライバー・元請と案件・控除・おわりの画面", async () => {
    as("staff");
    const drivers = await render((await import("~/app/(app)/onboarding/drivers/page")).default);
    expect(drivers).toContain("いま登録されているドライバー：");
    expect(drivers).toContain("8人");
    expect(drivers).toContain("読み込んで確かめる（まだ登録しません）");
    // 見本は見せるだけ（枠に入れて、架空の人を本当に登録してしまわないように）
    expect(drivers).toContain("見本（この形でなくても読めます）");
    expect(drivers).not.toContain("見本を入れてみる");
    const projects = await render((await import("~/app/(app)/onboarding/projects/page")).default);
    expect(projects).toContain("登録済みの案件（5 件）");
    expect(projects).toContain("A物流（架空）");
    const rules = await render((await import("~/app/(app)/onboarding/rules/page")).default);
    expect(rules).toContain("登録済みの控除（4 件）");
    expect(rules).toContain("合意の印なし");
    expect(rules).toContain("システム利用料");
    expect(rules).not.toContain(">ロイヤリティ<span");
    const done = await render((await import("~/app/(app)/onboarding/done/page")).default);
    expect(done).toContain("準備ができました");
    expect(done).toContain("2〜3 か月は Excel と並べて締めてください");
    expect(done).toContain("口座が入っていない人が 1人います");
    expect(done).toContain("取引条件の記録あり 7人");
    expect(done).toContain("取引条件を明示した記録（明示書か、明示した日）が見つからない人が 1人います。");
  });

  it("Excel と比べる：事務は入力、閲覧は結果だけ。報告は印刷用", async () => {
    const [aoki] = await state.db!.select().from(s.drivers).where(eq(s.drivers.code, "D01"));
    await saveParallelChecks(state.db!, tenantId, "2026-10-01", [{ driverId: aoki.id, excelTotal: 320_105 }]);
    const { default: ParallelPage } = await import("~/app/(app)/parallel/page");
    as("staff");
    let html = await render(ParallelPage);
    expect(html).toContain("1人中 0人が一致");
    expect(html).toContain("8人のうち、Excel の額をまだ入れていない人が 7人います");
    expect(html).toContain("Excel から貼り付ける・ファイルを置く");
    expect(html).toContain("2〜3 か月、しめ日ラボと Excel の両方で締めて、差が 0 になったら Excel をやめてください");
    expect(html).toContain("消費税の扱いが違う可能性");
    expect(html).toContain("Excel をやめる目安");
    expect(html).toContain("Excel をやめるかは、オーナーの方が決めます");
    // 切り替えの条件：だれの差にメモが無いかを名前つきで出し、その人の行へ移れる。PDF と印刷用の報告
    expect(html).toContain("切り替える前に、次のことが残っています");
    expect(html).toContain("差があって、理由のメモがまだ無い人が 1人います（青木 翔太さん 37,450円）");
    expect(html).toContain(`href="#row-${aoki.id}"`);
    expect(html).toContain(`id="row-${aoki.id}"`);
    expect(html).toContain("原因の候補：消費税の扱いが違う可能性");
    expect(html).toContain('href="/api/parallel/pdf?m=2026-10"');
    expect(html).toContain("払い不足の可能性（Excel の方が少ない）");
    as("owner");
    html = await render(ParallelPage);
    expect(html).toContain("本番に切り替える（Excel をやめる）…");
    expect(html).toContain("（あと 1人のメモ）");
    as("viewer");
    html = await render(ParallelPage);
    expect(html).toContain("Excel の額を入れるのは、事務・オーナーの方です。");
    expect(html).not.toContain("Excel から貼り付ける・ファイルを置く");
    expect(html).toContain("消費税の扱いが違う可能性");
    const { default: ReportPage } = await import("~/app/(app)/parallel/report/page");
    html = await render(ReportPage);
    expect(html).toContain("並行運用の比べ合わせ（2026年10月分）");
    expect(html).toContain("サンプル運送株式会社（架空）");
    expect(html).toContain("¥37,450");
    expect(html).toContain("Excel の額が入っていない人：");
    expect(html).toContain('href="/api/parallel/pdf?m=2026-10"');
    expect(html).toContain("本番に切り替える前に、次のことが残っています。");
  });
});
