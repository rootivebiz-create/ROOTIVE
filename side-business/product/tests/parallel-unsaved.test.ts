import { describe, expect, it, vi } from "vitest";
import { draftKey, draftText, guardLinkClick, leavesForAppPage, parseDraft, UNSAVED_MESSAGE } from "~/components/parallel/unsaved";

/**
 * Excel と比べる：保存していない入力を黙って失わない。
 * - アプリの中の別の画面へ移るリンクを押したら確かめる（# の移動・新しいタブ・ダウンロードでは聞かない）
 * - 入力はこのタブに下書きとして残し、保存内容が変わっていなければ戻す
 */

const HERE = "https://example.test/parallel?m=2026-10";
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const link = (href: string, extra: Partial<{ target: string; hasDownload: boolean }> = {}) => ({ href, target: "", hasDownload: false, ...extra });

describe("移る前の確かめ：どのリンクで聞くか", () => {
  it("月の切り替え・メニュー（アプリの別の画面）では聞く", () => {
    expect(leavesForAppPage(plain, link("https://example.test/parallel?m=2026-09"), HERE)).toBe(true);
    expect(leavesForAppPage(plain, link("/statements?m=2026-10"), HERE)).toBe(true);
    expect(leavesForAppPage(plain, link("/"), HERE)).toBe(true);
  });

  it("同じ画面の中（# だけ違う）・新しいタブ・ダウンロード・/api/・別のサイトでは聞かない", () => {
    expect(leavesForAppPage(plain, link("https://example.test/parallel?m=2026-10#row-abc"), HERE)).toBe(false);
    expect(leavesForAppPage({ ...plain, metaKey: true }, link("/"), HERE)).toBe(false);
    expect(leavesForAppPage({ ...plain, ctrlKey: true }, link("/"), HERE)).toBe(false);
    expect(leavesForAppPage({ ...plain, button: 1 }, link("/"), HERE)).toBe(false);
    expect(leavesForAppPage(plain, link("/", { target: "_blank" }), HERE)).toBe(false);
    expect(leavesForAppPage(plain, link("/parallel/report?m=2026-10", { hasDownload: true }), HERE)).toBe(false);
    expect(leavesForAppPage(plain, link("/api/parallel/pdf?m=2026-10"), HERE)).toBe(false);
    // 別のサイトはブラウザの「ページを離れますか」が聞く（二重に聞かない）
    expect(leavesForAppPage(plain, link("https://www.jftc.go.jp/"), HERE)).toBe(false);
    expect(leavesForAppPage({ ...plain, defaultPrevented: true }, link("/"), HERE)).toBe(false);
  });

  it("押したとき：キャンセルなら移動を止める（next/link にも渡さない）。OK なら止めない", () => {
    const anchor = { href: "https://example.test/watch?m=2026-10", target: "", hasAttribute: () => false };
    const event = () => ({ ...plain, target: { closest: (sel: string) => (sel === "a[href]" ? anchor : null) }, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    const confirm = vi.fn(() => false);
    const cancel = event();
    expect(guardLinkClick(cancel, { location: { href: HERE }, confirm })).toBe(true);
    expect(confirm).toHaveBeenCalledWith(UNSAVED_MESSAGE);
    expect(UNSAVED_MESSAGE).toBe("保存していない変更があります。移動しますか？");
    expect(cancel.preventDefault).toHaveBeenCalled();
    expect(cancel.stopPropagation).toHaveBeenCalled();

    const ok = event();
    expect(guardLinkClick(ok, { location: { href: HERE }, confirm: () => true })).toBe(false);
    expect(ok.preventDefault).not.toHaveBeenCalled();

    // リンクでないところ・SVG の a（href が文字でない）は見ない
    const none = { ...plain, target: { closest: () => null }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const never = vi.fn(() => false);
    expect(guardLinkClick(none, { location: { href: HERE }, confirm: never })).toBe(false);
    const svg = { ...plain, target: { closest: () => ({ href: { baseVal: "/" }, hasAttribute: () => false }) }, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(guardLinkClick(svg, { location: { href: HERE }, confirm: never })).toBe(false);
    expect(never).not.toHaveBeenCalled();
  });
});

describe("下書き（このタブの中だけ）", () => {
  const sig = "d1:320105:|d2::";

  it("月ごとの置き場所。変えた人がいなければ消す（null）", () => {
    expect(draftKey("2026-10-01")).toBe("shimebi:parallel-draft:2026-10");
    expect(draftKey("2026-10")).toBe("shimebi:parallel-draft:2026-10");
    expect(draftText(sig, {}, [])).toBeNull();
  });

  it("書いて読み戻せる。保存内容が変わった（ほかの人が保存した・消した）ら使わない。形が違えば使わない", () => {
    const text = draftText(sig, { d2: { excel: "357,555", note: "端数を直した" } }, [{ driverId: "d9", name: "小林 愛", code: null }]);
    expect(parseDraft(text, sig)).toEqual({ v: 1, signature: sig, values: { d2: { excel: "357,555", note: "端数を直した" } }, extra: [{ driverId: "d9", name: "小林 愛", code: null }] });
    expect(parseDraft(text, "d1:320105:|d2:357555:")).toBeNull();
    expect(parseDraft(null, sig)).toBeNull();
    expect(parseDraft("{壊れた", sig)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 2, signature: sig, values: {}, extra: [] }), sig)).toBeNull();
    // 中身の形が違う行は捨てる。残る行が無ければ使わない
    expect(parseDraft(JSON.stringify({ v: 1, signature: sig, values: { d2: { excel: 5 } }, extra: [] }), sig)).toBeNull();
    const mixed = parseDraft(JSON.stringify({ v: 1, signature: sig, values: { d1: { excel: "1", note: "" }, d2: null }, extra: [{ driverId: 3 }] }), sig);
    expect(mixed).toEqual({ v: 1, signature: sig, values: { d1: { excel: "1", note: "" } }, extra: [] });
  });
});
