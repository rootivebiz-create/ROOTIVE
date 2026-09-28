import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { F, fieldMessages, focusFirstError, ResultLine } from "~/components/form-field";
import { MoneyExtrasSection } from "~/components/import/extras";
import { AdjustmentPasteForm } from "~/components/work/adjustment-paste-form";
import type { MoneyExtras } from "~/server/features/import/proposals";

// テストの変換は JSX を React.createElement にするので、React を見えるところに置く
Object.assign(globalThis, { React });

const h = React.createElement;
const noop = async () => undefined;

describe("入力欄の誤り（UX-08）", () => {
  it("誤りは赤で入力欄の下に出し、入力欄に aria-invalid と aria-describedby を付ける（ヒントの灰色にしない）", () => {
    const html = renderToStaticMarkup(h(F, { label: "金額（円）", error: "金額は数で入れてください（例：3,300）", hint: "1 円単位", children: h("input", { name: "amount" }) }));
    expect(html).toContain('aria-invalid="true"');
    const described = html.match(/aria-describedby="([^"]+)"/)![1];
    expect(html).toMatch(new RegExp(`<p id="${described}" class="[^"]*text-danger[^"]*">金額は数で入れてください`));
    expect(html).not.toContain("1 円単位");
    // 誤りが無ければ、ヒントを灰色で（aria-invalid は付けない）
    const ok = renderToStaticMarkup(h(F, { label: "金額（円）", hint: "1 円単位", children: h("input", { name: "amount" }) }));
    expect(ok).not.toContain('aria-invalid="true"');
    expect(ok).toContain("text-muted-foreground");
  });

  it("送った結果の帯に、入力欄ごとの誤りを箇条書きで並べる（長いフォームの下の帯でも中身が分かる）", () => {
    const state = { ok: false as const, error: "入力を確かめてください", fieldErrors: { name: "会社名を入れてください", payDay: "支払日は 1〜31 にしてください", other: "会社名を入れてください" } };
    expect(fieldMessages(state)).toEqual(["会社名を入れてください", "支払日は 1〜31 にしてください"]);
    const html = renderToStaticMarkup(h(ResultLine, { state }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("<li>会社名を入れてください</li>");
    expect(html).toContain("<li>支払日は 1〜31 にしてください</li>");
    expect(renderToStaticMarkup(h(ResultLine, { state: { ok: true, message: "保存しました" } }))).toContain("保存しました");
  });

  it("送ったあと、誤りのある最初の入力欄（フォームの並び順。隠した値は除く）へ移る", () => {
    const el = (name: string, type = "text") => ({ getAttribute: (k: string) => (k === "name" ? name : k === "type" ? type : null), disabled: false, focus: vi.fn(), scrollIntoView: vi.fn() });
    const hidden = el("month", "hidden");
    const label = el("label");
    const amount = el("amount");
    const form = { querySelectorAll: () => [hidden, label, amount] } as unknown as HTMLFormElement;
    expect(focusFirstError(form, ["amount", "month", "label"])).toBe(label);
    expect(label.focus).toHaveBeenCalled();
    expect(label.scrollIntoView).toHaveBeenCalled();
    expect(focusFirstError(form, ["month"])).toBeNull();
    expect(focusFirstError(null, ["amount"])).toBeNull();
  });
});

describe("取り込みの確認：調整として入れる列・人ごとの単価（表示）", () => {
  const extras: MoneyExtras = {
    payout: null,
    fees: [],
    proposals: [],
    adjust: [
      {
        col: 3,
        header: "燃料代",
        kindLabel: "燃料",
        setting: null,
        draft: { label: "燃料代", sign: "minus", taxable: true },
        entries: [{ driverId: "d1", name: "青木 翔太", value: 12400 }],
        mixedSigns: false,
        unreadable: [],
        sameNameRule: null,
      },
      {
        col: 4,
        header: "立替金",
        kindLabel: "立替の精算",
        setting: { col: 4, label: "高速代の立替", sign: "plus", taxable: false, agreedInWriting: true, basis: null },
        draft: { label: "立替金", sign: "plus", taxable: false },
        entries: [{ driverId: "d3", name: "上田 健", value: 3280 }],
        mixedSigns: false,
        unreadable: [],
        sameNameRule: "高速代の立替",
      },
    ],
    rates: [
      {
        col: 5,
        header: "単価",
        kind: "rate",
        proposals: [{ driverId: "d3", driverName: "上田 健", projectId: "p1", projectName: "宅配（個建て）", unit: "個", rate: 160, current: 150, hasOverride: false, rows: 1 }],
        matched: 2,
        varying: [{ driverName: "遠藤 大輔", projectName: "宅配（個建て）", rates: [150, 170] }],
        billLike: false,
        unreadable: [],
      },
    ],
    base: { from: "calc", header: null },
    rounding: "floor",
  };

  it("事務には「その月の調整として入れる」と単価の登録を出し、閲覧の人には出さない。二重に引くおそれ・段階制は知らせる", () => {
    const props = { extras, batchId: "b", month: "2026-11", adopt: noop, adjustAction: noop, ratesAction: noop };
    const staff = renderToStaticMarkup(h(MoneyExtrasSection, { ...props, canEdit: true }));
    expect(staff).toContain("その月の調整として入れる");
    expect(staff).toContain("反映するとき、人ごとに「<b>高速代の立替</b>」の調整を入れます");
    expect(staff).toContain("同じ名前の控除のルール「高速代の立替」があります");
    expect(staff).toContain("選んだ人の単価を登録する");
    expect(staff).toContain("上田 健・宅配（個建て）");
    expect(staff).toContain("段階制・最低保証");
    const viewer = renderToStaticMarkup(h(MoneyExtrasSection, { ...props, canEdit: false }));
    expect(viewer).not.toContain("選んだ人の単価を登録する");
    expect(viewer).not.toContain("調整として入れるのをやめる");
    expect(viewer).toContain("上田 健・宅配（個建て）");
  });

  it("稼働と調整：貼り付けの入力欄（名前・内容・金額）", () => {
    const html = renderToStaticMarkup(h(AdjustmentPasteForm, { action: noop, month: "2026-10-01" }));
    expect(html).toContain("Excel から貼り付け（名前・内容・金額）");
    expect(html).toContain('name="text"');
    expect(html).toContain('name="sign"');
  });
});

describe("入力欄の誤り：包んだ入力欄", () => {
  it("div で包んだときは、包みには誤りの印を付けない（誤りの文は出す）", () => {
    const html = renderToStaticMarkup(h(F, { label: "日付", error: "日付の形が正しくありません", children: h("div", null, h("input", { name: "d" })) }));
    expect(html).not.toContain('<div aria-invalid');
    expect(html).toContain("日付の形が正しくありません");
  });
});
