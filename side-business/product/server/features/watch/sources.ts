/**
 * 見張り番が出す「根拠」と「出典」と「直す画面」。
 * 出典は、確かめ済みの公的なページだけを使う（ここ以外の URL を書かない）。
 */

/** ルールのもとにした情報の時点 */
export const WATCH_RULES_AS_OF = "2026年9月";

export const SOURCES = {
  /** 公正取引委員会 フリーランス法 Q&A */
  flQa: "https://www.jftc.go.jp/fllaw_limited/fllaw_qa.html",
  /** フリーランス法 パンフレット */
  flPamphlet: "https://www.jftc.go.jp/file/flpamph.pdf",
  /** フリーランス法 解釈ガイドライン */
  flGuidelines: "https://www.jftc.go.jp/file/fl_jftcmhlwguidelines.pdf",
  /** フリーランス法 勧告の一覧 */
  flRecommendations: "https://www.jftc.go.jp/FL/FLkankoku/index.html",
  /** フリーランス法 条文（e-Gov） */
  flLaw: "https://laws.e-gov.go.jp/law/505AC0000000025",
  /** 厚生労働省 フリーランス法（就業環境の整備） */
  mhlwFl: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/keiyaku/index02.html",
  /** 取適法の概要 */
  toritekiOverview: "https://www.jftc.go.jp/toriteki/toritekigaiyo/gaiyo.html",
  /** 取適法 リーフレット */
  toritekiLeaflet: "https://www.jftc.go.jp/file/toriteki_leaflet.pdf",
  /** 物流特殊指定 */
  logisticsDesignation: "https://www.jftc.go.jp/dk/guideline/tokuteiunsou.html",
  /** 免税事業者との取引 Q&A */
  exemptQa: "https://www.jftc.go.jp/dk/guideline/unyoukijun/invoice_qanda.html",
  /** インボイス 経過措置・2割特例 */
  invoiceTransitional: "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice_2tokurei.htm",
  /** インボイスの記載事項 */
  invoiceItems: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6496.htm",
  /** 仕入明細書 */
  purchaseStatement: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6498.htm",
  /** 適格請求書発行事業者 公表サイト */
  invoiceRegistry: "https://www.invoice-kohyo.nta.go.jp/",
} as const;

/** 根拠の書き方（法律の名前と条） */
export const BASIS = {
  terms: "フリーランス法 第3条（取引条件の明示）",
  payDate: "フリーランス法 第4条（報酬の支払期日）",
  reduction: "フリーランス法 第5条（報酬の減額の禁止）",
  rateDown: "フリーランス法 第5条（報酬の減額・買いたたきの禁止）",
  fee: "フリーランス法 第5条（報酬の減額の禁止）・取適法",
  toriteki: "取適法（中小受託取引適正化法）",
  endNotice: "フリーランス法 第16条（解除等の予告）",
  invoiceNumber: "インボイス制度（登録番号の記載・仕入明細書）",
  invoiceRegistry: "インボイス制度（登録の確認）",
  transitional: "インボイス制度の経過措置（免税事業者などからの仕入れ）",
} as const;

/** 直す画面（設定の画面の場所は、ここだけで決める） */
export const FIX = {
  company: "/settings/company",
  drivers: "/settings/drivers",
  rules: "/settings/rules",
  projects: "/settings/projects",
  work: (m: string) => `/work?m=${m}`,
  statements: (m: string) => `/statements?m=${m}`,
  transfer: (m: string) => `/transfer?m=${m}`,
} as const;

/** 閲覧の人（viewer）でも開ける画面か（設定・振込は事務・オーナーだけ） */
export function viewerCanOpen(href: string): boolean {
  return /^\/(work|statements|watch|close|reconcile|profit|parallel)(\?|$|\/)/.test(href);
}

/** 直す画面の名前（ボタンに「直す（ドライバーの設定）」と出す） */
export function fixLabel(href: string): string {
  const names: [RegExp, string][] = [
    [/^\/settings\/company/, "会社の設定"],
    [/^\/settings\/drivers/, "ドライバーの設定"],
    [/^\/settings\/rules/, "控除のルール"],
    [/^\/settings\/projects/, "案件の設定"],
    [/^\/work/, "稼働と調整"],
    [/^\/statements/, "支払明細"],
    [/^\/transfer/, "振込データ"],
  ];
  return names.find(([re]) => re.test(href))?.[1] ?? "直す画面";
}
