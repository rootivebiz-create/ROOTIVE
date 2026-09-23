/**
 * 見張り番が出す「根拠」と「出典」と「直す画面」。
 * 出典は、確かめ済みの公的なページだけを使う（ここ以外の URL を書かない）。
 */

/** ルールのもとにした情報の時点 */
export const WATCH_RULES_AS_OF = "2026年9月";
/** 同じ時点（YYYY-MM。ルールごとの asOf の既定） */
export const WATCH_RULES_AS_OF_MONTH = "2026-09";

/** 法律が始まった日（これより前の月には、その法律のルールを当てない） */
export const EFFECTIVE = {
  /** フリーランス法（特定受託事業者に係る取引の適正化等に関する法律） */
  freelance: "2024-11-01",
  /** 取適法（中小受託取引適正化法） */
  toriteki: "2026-01-01",
  /** インボイス制度 */
  invoice: "2023-10-01",
} as const;

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
  /** インボイス Q&A 問86（仕入明細書の相手方の確認。送付後一定期間内に連絡が無ければ確認があったものとする方法など） */
  purchaseStatementQa: "https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/86.pdf",
  /** 適格請求書発行事業者 公表サイト */
  invoiceRegistry: "https://www.invoice-kohyo.nta.go.jp/",
} as const;

/** 根拠の書き方（法律の名前と条） */
export const BASIS = {
  terms: "フリーランス法 第3条（取引条件の明示）",
  payDate: "フリーランス法 第4条（報酬の支払期日）",
  reduction: "フリーランス法 第5条（報酬の減額の禁止）",
  rateDown: "フリーランス法 第5条（報酬の減額・買いたたきの禁止）",
  penalty: "フリーランス法 第5条（報酬の減額の禁止）・違約金などの差し引き",
  exemptCut: "免税事業者との取引（公正取引委員会などのインボイス Q&A）",
  subcontract: "フリーランス法 第4条第3項（再委託の支払期日）",
  fee: "フリーランス法 第5条（報酬の減額の禁止）・取適法",
  toriteki: "取適法（中小受託取引適正化法）",
  endNotice: "フリーランス法 第16条（解除等の予告）",
  invoiceNumber: "インボイス制度（登録番号の記載・仕入明細書）",
  invoiceRegistry: "インボイス制度（登録の確認）",
  transitional: "インボイス制度の経過措置（免税事業者などからの仕入れ）",
} as const;

/**
 * 直す画面（設定の画面の場所は、ここだけで決める）。
 * できるだけ「その人・その控除・その調整」を開いた状態で飛べるようにする（m は YYYY-MM）。
 */
export const FIX = {
  company: (m: string) => `/settings/company?m=${m}`,
  /** ドライバーの一覧（何人かまとめての指摘） */
  drivers: "/settings/drivers",
  /** そのドライバーの設定（取引条件の日付・口座・登録番号・終了日） */
  driver: (driverId: string) => `/settings/drivers/${encodeURIComponent(driverId)}`,
  /** 取引条件の記録の一覧 */
  termsList: "/terms",
  /** そのドライバーの取引条件の記録（明示書） */
  terms: (driverId: string) => `/terms/${encodeURIComponent(driverId)}`,
  /** 1 人の明細（質問への返事もここ） */
  statement: (statementId: string) => `/statements/${encodeURIComponent(statementId)}`,
  /** 人ごとの単価（合意した日もここで入れる） */
  rates: (driverId: string, projectId: string) => `/settings/rates?driver=${encodeURIComponent(driverId)}&project=${encodeURIComponent(projectId)}`,
  /** 控除のルール（その月の金額つき。1 人だけの控除ならその人で絞る） */
  rules: (m: string, driverId?: string | null) => `/settings/rules?m=${m}${driverId ? `&driver=${encodeURIComponent(driverId)}` : ""}`,
  /** 案件の標準の単価（名前で絞る） */
  projects: (name?: string) => `/settings/projects${name ? `?q=${encodeURIComponent(name.slice(0, 50))}` : ""}`,
  work: (m: string) => `/work?m=${m}`,
  /** その調整を直す欄を開いた稼働の画面 */
  adjustment: (m: string, adjustmentId: string) => `/work?m=${m}&adj=${encodeURIComponent(adjustmentId)}#adjustments`,
  statements: (m: string) => `/statements?m=${m}`,
  transfer: (m: string) => `/transfer?m=${m}`,
} as const;

/** 直す画面の名前（ボタンに「直す（ドライバーの設定）」と出す） */
export function fixLabel(href: string): string {
  const names: [RegExp, string][] = [
    [/^\/settings\/company/, "会社の設定"],
    [/^\/settings\/drivers/, "ドライバーの設定"],
    [/^\/settings\/rates/, "人ごとの単価"],
    [/^\/settings\/rules/, "控除のルール"],
    [/^\/settings\/projects/, "案件の設定"],
    [/^\/terms/, "取引条件の記録"],
    [/^\/work/, "稼働と調整"],
    [/^\/statements\/[^?#/]+/, "明細のやりとり"],
    [/^\/statements/, "支払明細"],
    [/^\/transfer/, "振込データ"],
  ];
  return names.find(([re]) => re.test(href))?.[1] ?? "記録の画面";
}

export type FixLink = {
  href: string;
  /** 「直す（ドライバーの設定）」または「見る（会社の設定）」 */
  text: string;
  /** 直せない人へのひとこと（無ければ null） */
  note: string | null;
  /** その人がその画面で直せるか */
  canFix: boolean;
};

/**
 * 直す画面へのリンクを、見る人の役割と月の状態に合わせる。
 * どの画面も閲覧の人は開けるので、隠さずに「見る」にする（直せない人に「直す」と書かない）。
 */
export function fixLink(href: string, who: { role: "owner" | "staff" | "viewer"; closed: boolean }): FixLink {
  const name = fixLabel(href);
  const view = (note: string | null): FixLink => ({ href, text: `見る（${name}）`, note, canFix: false });
  if (who.role === "viewer") return view("直すのは事務・オーナーの方です。");
  if (/^\/settings\/company/.test(href) && who.role !== "owner") return view("会社の設定を変えられるのはオーナーです。オーナーに頼んでください。");
  // 質問への返事は、明細を変えないので締めたあとでもできる
  if (/^\/statements\/[^?#/]+/.test(href)) return { href, text: `返事をする（${name}）`, note: null, canFix: true };
  if (who.closed && /^\/(work|statements)(\?|$|\/)/.test(href)) {
    return view("締めた月の稼働と明細は変えられません。直すときは、オーナーが締めを外してからにします。");
  }
  return { href, text: `直す（${name}）`, note: null, canFix: true };
}
