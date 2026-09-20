import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { extractFindings, extractInsight, normalizeActions, normalizeFindings, normalizeInsight, normalizeInsightFindings } from "@/lib/ai/findings";
import { addDays, describeAiContext, limitRows, round2, round4, summarizeCash, todayJst, trimHistory, type AiContext } from "@/lib/ai/context";
import { conversationTitleFrom, draftKindSchema, draftParamsSchema, DRAFT_KINDS, generateDraftSchema, startAiChatSchema } from "@/lib/schemas/ai";

describe("AI の応答の取り出し（findings.ts）", () => {
  it("normalizeInsight：総括・所見・改善策を正規化し、件数と重さを揃える", () => {
    const payload = normalizeInsight({
      summary: " 今月は目標を下回っています。 ",
      findings: [
        { title: "売上が未達", detail: "目標 100 万円に対し 80 万円です。", severity: "HIGH" },
        { title: "重さ無し", detail: "既定は medium" },
        { detail: "見出しが無い所見" },
        "文字列の所見",
        { foo: 1 },
        { title: "6 件目", severity: "low" },
        { title: "7 件目" },
      ],
      actions: [
        { title: "単価交渉", detail: "A 社に 500 円/件の値上げを相談する。", effect: "月 +12 万円程度" },
        { title: "効果額なし", detail: "経費の見直し" },
        { title: "3 件目", detail: "", effect: "" },
        { title: "4 件目（捨てられる）", detail: "" },
      ],
    });
    assert.equal(payload.summary, "今月は目標を下回っています。");
    assert.equal(payload.findings.length, 5);
    assert.deepEqual(payload.findings[0], { title: "売上が未達", detail: "目標 100 万円に対し 80 万円です。", severity: "high" });
    assert.equal(payload.findings[1].severity, "medium");
    assert.deepEqual(payload.findings[2], { title: "見出しが無い所見", detail: "", severity: "medium" });
    assert.deepEqual(payload.findings[3], { title: "文字列の所見", detail: "", severity: "medium" });
    assert.equal(payload.findings[4].title, "6 件目");
    assert.equal(payload.findings[4].severity, "low");
    assert.equal(payload.actions.length, 3);
    assert.deepEqual(payload.actions[0], { title: "単価交渉", detail: "A 社に 500 円/件の値上げを相談する。", effect: "月 +12 万円程度" });
    assert.equal(payload.actions[1].effect, "");

    // 配列だけ・文字列だけでも壊れない
    assert.deepEqual(normalizeInsight(["所見"]), { summary: "", findings: [{ title: "所見", detail: "", severity: "medium" }], actions: [] });
    assert.deepEqual(normalizeInsight("ただの文字列"), { summary: "ただの文字列", findings: [], actions: [] });
    assert.deepEqual(normalizeInsight(null), { summary: "", findings: [], actions: [] });
    assert.deepEqual(normalizeInsightFindings({ findings: ["x"] }), [{ title: "x", detail: "", severity: "medium" }]);
    assert.deepEqual(normalizeActions({ actions: [{ heading: "見出し", impact: "月 +5 万円" }] }), [{ title: "見出し", detail: "", effect: "月 +5 万円" }]);
  });

  it("extractInsight：コードフェンス・前置き・壊れた JSON に強い", () => {
    const json = '{"summary":"総括","findings":[{"title":"A","detail":"B","severity":"low"}],"actions":[{"title":"C","detail":"D","effect":"月 +1 万円"}]}';

    const fenced = extractInsight("```json\n" + json + "\n```");
    assert.equal(fenced.summary, "総括");
    assert.deepEqual(fenced.findings, [{ title: "A", detail: "B", severity: "low" }]);
    assert.deepEqual(fenced.actions, [{ title: "C", detail: "D", effect: "月 +1 万円" }]);

    const withPreamble = extractInsight(`分析結果は以下のとおりです。\n${json}\n以上です。`);
    assert.equal(withPreamble.summary, "総括");
    assert.equal(withPreamble.findings.length, 1);

    // 壊れた JSON は本文をそのまま総括と 1 件の所見にする
    const broken = extractInsight('{"summary":"総括","findings":[{"title":');
    assert.equal(broken.findings.length, 1);
    assert.equal(broken.findings[0].title, "分析結果");
    assert.equal(broken.findings[0].severity, "medium");

    const plain = extractInsight("ただの文章です。");
    assert.equal(plain.summary, "ただの文章です。");
    assert.deepEqual(plain.actions, []);

    assert.deepEqual(extractInsight(""), { summary: "", findings: [], actions: [] });
    assert.deepEqual(extractInsight("   "), { summary: "", findings: [], actions: [] });
  });

  it("既存の normalizeFindings / extractFindings は今までどおり動く", () => {
    assert.deepEqual(normalizeFindings(["a", " b ", ""]), [
      { title: "a", detail: "" },
      { title: "b", detail: "" },
    ]);
    assert.deepEqual(extractFindings('```json\n[{"title":"A","detail":"B"}]\n```'), [{ title: "A", detail: "B" }]);
    assert.deepEqual(extractFindings("ただの文章"), [{ title: "分析結果", detail: "ただの文章" }]);
  });
});

describe("データパックのヘルパー（context.ts）", () => {
  it("金額は小数 2 桁・率は小数 4 桁に丸め、件数の上限を守る", () => {
    assert.equal(round2(1234.5678), 1234.57);
    assert.equal(round2(-1234.5678), -1234.57);
    assert.equal(round2(null), 0);
    assert.equal(round2(Number.NaN), 0);
    assert.equal(round4(0.123456), 0.1235);
    assert.equal(round4(undefined), 0);

    const rows = Array.from({ length: 80 }, (_, i) => i);
    assert.equal(limitRows(rows, 50).length, 50);
    assert.deepEqual(limitRows(rows, 50)[49], 49);
    assert.deepEqual(limitRows([1, 2], 50), [1, 2]);
    assert.deepEqual(limitRows(null, 50), []);
    assert.deepEqual(limitRows([1, 2], 0), []);
  });

  it("日付ユーティリティは日本時間で動く", () => {
    // 2026-09-19 22:00 UTC ＝ 日本時間の 2026-09-20
    assert.equal(todayJst(new Date("2026-09-19T22:00:00Z")), "2026-09-20");
    assert.equal(todayJst(new Date("2026-09-19T10:00:00Z")), "2026-09-19");
    assert.equal(addDays("2026-09-19", 60), "2026-11-18");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  });

  it("資金繰りは入金（＋）と支払（−）を分けて集計する", () => {
    const events = [{ amount: 1000.005 }, { amount: -300 }, { amount: 2000 }, { amount: -0.5 }];
    const cash = summarizeCash(events, { as_of: "2026-09-01", balance: 500 }, "2026-09-19", "2026-11-18");
    assert.equal(cash.inflow, 3000.01);
    assert.equal(cash.outflow, 300.5);
    assert.equal(cash.balance, 500);
    assert.equal(cash.ending_balance, 3199.51);
    assert.equal(cash.event_count, 4);

    const noSnapshot = summarizeCash(events, null, "2026-09-19", "2026-11-18");
    assert.equal(noSnapshot.balance, null);
    assert.equal(noSnapshot.ending_balance, null);
  });

  it("describeAiContext：何月のデータを何件渡したかを 1 行で返す", () => {
    const ctx = {
      month: "2026-09",
      month_label: "2026年9月",
      is_closed: false,
      months: [{}, {}],
      drivers: [{}],
      projects: [{}, {}, {}],
      expenses: [],
      invoices: [{}],
      cash: { event_count: 7 },
      alerts: [{}, {}],
      kpi: { break_even_bill: 1000000 },
      loans: [{}],
      tax_tasks: [{}, {}, {}],
      labor: { driver_count: 4, over_duty_days: 2 },
    } as unknown as AiContext;
    const text = describeAiContext(ctx);
    assert.match(text, /2026年9月/);
    assert.match(text, /未締め/);
    assert.match(text, /直近 2 か月の損益/);
    assert.match(text, /ドライバー 1 名/);
    assert.match(text, /案件 3 件/);
    assert.match(text, /資金繰り 7 件/);
    assert.match(text, /経営指標/);
    assert.match(text, /借入 1 件/);
    assert.match(text, /労務（対象 4 名）/);
    assert.match(text, /近い税務の期限 3 件/);
    assert.match(text, /未対応のアラート 2 件/);
  });

  it("describeAiContext：0014 の項目が無い古いデータでも落ちない", () => {
    const ctx = {
      month: "2026-09",
      month_label: "2026年9月",
      is_closed: true,
      months: [{}],
      drivers: [],
      projects: [],
      expenses: [],
      invoices: [],
      cash: null,
      alerts: [],
    } as unknown as AiContext;
    const text = describeAiContext(ctx);
    assert.match(text, /締め済み/);
    assert.doesNotMatch(text, /借入/);
    assert.doesNotMatch(text, /経営指標/);
    assert.doesNotMatch(text, /労務/);
  });
});

describe("会話の履歴の切り詰め（context.ts）", () => {
  it("直近 10 往復まで・user と assistant が交互・末尾は assistant", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `発言 ${i}` }));
    const trimmed = trimHistory(history);
    assert.equal(trimmed.length, 20);
    assert.equal(trimmed[0].role, "user");
    assert.equal(trimmed[0].content, "発言 10");
    assert.equal(trimmed[19].role, "assistant");

    // 空の発言は捨てる
    assert.deepEqual(
      trimHistory([
        { role: "user", content: " 質問 " },
        { role: "assistant", content: "   " },
        { role: "assistant", content: "回答" },
      ]),
      [
        { role: "user", content: "質問" },
        { role: "assistant", content: "回答" },
      ],
    );

    // 先頭の assistant は捨て、同じ role が続く場合は先の発言だけを残す
    assert.deepEqual(
      trimHistory([
        { role: "assistant", content: "こんにちは" },
        { role: "user", content: "質問 1" },
        { role: "user", content: "質問 2" },
        { role: "assistant", content: "回答 1" },
      ]),
      [
        { role: "user", content: "質問 1" },
        { role: "assistant", content: "回答 1" },
      ],
    );

    // 回答が保存されていない末尾の質問は落とす
    assert.deepEqual(
      trimHistory([
        { role: "user", content: "質問" },
        { role: "assistant", content: "回答" },
        { role: "user", content: "まだ回答が無い質問" },
      ]),
      [
        { role: "user", content: "質問" },
        { role: "assistant", content: "回答" },
      ],
    );

    // 往復数を指定できる。0 や不正な入力でも壊れない
    assert.equal(trimHistory(history, 2).length, 4);
    assert.deepEqual(trimHistory(history, 0), []);
    assert.deepEqual(trimHistory(null), []);
    assert.deepEqual(trimHistory(undefined), []);
  });
});

describe("AI のスキーマ（schemas/ai.ts）", () => {
  it("文章の種類は 5 つだけ受け付ける", () => {
    assert.deepEqual([...DRAFT_KINDS], ["monthly_report", "driver_notice", "payment_reminder", "statement_notice", "recruit"]);
    for (const kind of DRAFT_KINDS) assert.equal(draftKindSchema.parse(kind), kind);
    assert.equal(draftKindSchema.safeParse("unknown_kind").success, false);
    assert.equal(draftKindSchema.safeParse("").success, false);

    // 補足は省略でき、既定は丁寧
    assert.deepEqual(draftParamsSchema.parse({}), { to: "", tone: "polite", note: "" });
    assert.deepEqual(draftParamsSchema.parse({ to: " 〇〇運輸 ", tone: "friendly", note: " 連絡 " }), { to: "〇〇運輸", tone: "friendly", note: "連絡" });
    assert.equal(draftParamsSchema.safeParse({ tone: "rude" }).success, false);
    assert.equal(draftParamsSchema.safeParse({ to: "あ".repeat(101) }).success, false);

    const ok = generateDraftSchema.safeParse({ kind: "recruit", params: {}, month: "2026-09" });
    assert.equal(ok.success, true);
    assert.equal(generateDraftSchema.safeParse({ kind: "recruit", params: {}, month: "2026-9" }).success, false);
  });

  it("質問のタイトルは先頭 30 文字", () => {
    assert.equal(conversationTitleFrom("今月の着地はどう？"), "今月の着地はどう？");
    assert.equal(conversationTitleFrom("  今月の\n着地は  どう？ "), "今月の 着地は どう？");
    assert.equal(conversationTitleFrom("あ".repeat(40)), `${"あ".repeat(30)}…`);
    assert.equal(conversationTitleFrom("   "), "新しい相談");

    assert.equal(startAiChatSchema.safeParse({ month: "2026-09", question: "  " }).success, false);
    assert.equal(startAiChatSchema.safeParse({ month: "2026-09", question: "あ".repeat(2001) }).success, false);
    assert.equal(startAiChatSchema.parse({ month: "2026-09", question: " 質問 " }).question, "質問");
  });
});
