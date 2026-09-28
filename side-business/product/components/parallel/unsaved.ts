/**
 * 保存していない入力を黙って失わないための部品（Excel と比べる の入力で使う）。
 * - 移る前の確かめ：アプリの中のリンク（月の切り替え・メニュー）を押したときと、タブを閉じる・読み直すとき
 * - 下書き：入力のたびにこのタブの sessionStorage に残し、戻ってきたら入れ直す（スワイプで戻る・iPhone の Safari のように
 *   確かめが出ない移り方でも失わない）。読めない・書けない環境では何もしない
 * 判定と下書きの形は純関数にして、テストで確かめる。
 */
import { useEffect } from "react";

export const UNSAVED_MESSAGE = "保存していない変更があります。移動しますか？";

export type ClickLike = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };
export type AnchorLike = { href: string; target: string; hasDownload: boolean };

/**
 * そのリンクを押すと、この画面を離れてアプリの別の画面へ移るか（確かめを出すか）。
 * 出さないもの：新しいタブで開く押し方（修飾キー・中ボタン・target）・ダウンロード・/api/（ファイル）・
 * 同じ画面の中の移動（# だけ違う）・別のサイト（ブラウザの「ページを離れますか」が聞く）
 */
export function leavesForAppPage(click: ClickLike, anchor: AnchorLike, current: string): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false;
  if (anchor.hasDownload) return false;
  if (anchor.target && anchor.target !== "_self") return false;
  let from: URL;
  let to: URL;
  try {
    from = new URL(current);
    to = new URL(anchor.href, from);
  } catch {
    return false;
  }
  if (to.origin !== from.origin) return false;
  if (to.pathname.startsWith("/api/")) return false;
  if (to.pathname === from.pathname && to.search === from.search) return false;
  return true;
}

type ClickEventLike = ClickLike & { target: unknown; preventDefault(): void; stopPropagation(): void };
type AnchorElementLike = { href: unknown; target?: unknown; hasAttribute(name: string): boolean };
type WindowLike = { location: { href: string }; confirm(message: string): boolean };

/**
 * リンクを押したときの確かめ。アプリの別の画面へ移るリンクなら confirm を出し、「キャンセル」なら止める（止めたら true）。
 * window の capture で呼ぶので、React（next/link）の処理より先に止まる。
 */
export function guardLinkClick(e: ClickEventLike, win: WindowLike, message: string = UNSAVED_MESSAGE): boolean {
  const t = e.target as { closest?: (selector: string) => unknown } | null;
  const el = t && typeof t.closest === "function" ? (t.closest("a[href]") as AnchorElementLike | null) : null;
  // SVG の a は href が文字でないので見ない
  if (!el || typeof el.href !== "string") return false;
  const anchor = { href: el.href, target: typeof el.target === "string" ? el.target : "", hasDownload: el.hasAttribute("download") };
  if (!leavesForAppPage(e, anchor, win.location.href)) return false;
  if (win.confirm(message)) return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}

/** 入力のあいだ（active）だけ、移る前に確かめる */
export function useUnsavedGuard(active: boolean, message: string = UNSAVED_MESSAGE): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 古いブラウザは returnValue に何か入っているときだけ確かめを出す
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      guardLinkClick(e, window, message);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
    };
  }, [active, message]);
}

// ---------------------------------------------------------------- 下書き（このタブの中だけ）

export type DraftValue = { excel: string; note: string };
export type DraftExtra = { driverId: string; name: string; code: string | null };
export type ParallelDraft = {
  v: 1;
  /** 下書きを作ったときの保存内容（一覧の形）。今の保存内容と違えば、下書きは使わない（ほかの人が保存した・消した） */
  signature: string;
  values: Record<string, DraftValue>;
  /** 一覧にいない人を足した分 */
  extra: DraftExtra[];
};

export function draftKey(month: string): string {
  return `shimebi:parallel-draft:${month.slice(0, 7)}`;
}

/** 下書きを文字にする（変えた人がいなければ null ＝ 消す） */
export function draftText(signature: string, values: Record<string, DraftValue>, extra: DraftExtra[]): string | null {
  if (Object.keys(values).length === 0) return null;
  const draft: ParallelDraft = { v: 1, signature, values, extra };
  return JSON.stringify(draft);
}

const isStr = (x: unknown): x is string => typeof x === "string";

/** 残してあった下書きを読む。形が違う・保存内容が変わっていれば null */
export function parseDraft(text: string | null, signature: string): ParallelDraft | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<ParallelDraft>;
  if (d.v !== 1 || d.signature !== signature || !d.values || typeof d.values !== "object" || !Array.isArray(d.extra)) return null;
  const values: Record<string, DraftValue> = {};
  for (const [id, v] of Object.entries(d.values as Record<string, unknown>)) {
    const x = v as Partial<DraftValue> | null;
    if (x && isStr(x.excel) && isStr(x.note)) values[id] = { excel: x.excel.slice(0, 40), note: x.note.slice(0, 200) };
  }
  const extra = (d.extra as unknown[]).flatMap((e) => {
    const x = e as Partial<DraftExtra> | null;
    return x && isStr(x.driverId) && isStr(x.name) ? [{ driverId: x.driverId, name: x.name, code: isStr(x.code) ? x.code : null }] : [];
  });
  if (Object.keys(values).length === 0) return null;
  return { v: 1, signature, values, extra };
}

/** sessionStorage は、読めない・書けない（プライベートブラウズ・容量）ことがある。そのときは何もしない */
export function readDraftStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeDraftStorage(key: string, text: string | null): void {
  try {
    if (text === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, text);
  } catch {
    // 残せなくても入力は続けられる
  }
}
