/**
 * 使い方ガイドの形（純データ。React・DB に依存しない）。
 * 文章は日本語のみ。画面の名前・ボタンの名前は、実際の画面の表記と同じにする。
 */
import type { Role } from "@/lib/db/types";
import type { RoleVisibility } from "@/lib/nav/visibility";

export interface GuideLink {
  href: string;
  label: string;
}

/** 1 つの画面の使い方 */
export interface PageGuide extends RoleVisibility {
  /** 画面のパス（前方一致で当てる。"/payouts" は "/payouts/xxx/statement" にも当たるが、より長いものが優先） */
  href: string;
  /** ページ内の目次に使う名前（英数字とハイフン） */
  slug: string;
  title: string;
  /** この画面で何をするか（1〜2 文） */
  purpose: string;
  /** 使い方（上から順に） */
  steps: string[];
  /** 知っておくと楽になること・気をつけること */
  tips?: string[];
  /** ロールごとの注意（その人にだけ出す） */
  roleNotes?: Partial<Record<Role, string>>;
  /** あわせて使う画面 */
  related?: GuideLink[];
  /** ドライバーポータルの画面 */
  driver?: boolean;
}

/** 全体ガイドの 1 節 */
export interface OverviewSection {
  slug: string;
  title: string;
  /** 段落 */
  body?: string[];
  /** 箇条書き */
  items?: string[];
  /** 手順（番号つき） */
  steps?: string[];
  /** この節を出すロール（省くと全員） */
  roles?: Role[];
}

export interface FaqItem {
  q: string;
  a: string;
  roles?: Role[];
}
