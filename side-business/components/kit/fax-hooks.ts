/**
 * FAX DM（A4 縦・白黒・1 枚）の「きっかけ」ごとの見出し・3 つの要点・申し出・QR の行き先。
 * ?hook=notice（既定・元請の支払通知との突合）| 70 | freelance | safety。数字は lib/payroll/tax.ts と site.config.ts から組み立てる。
 * QR には utm_campaign=<きっかけ> を付ける（相談フォームの「流入元」で見出しを見分ける → sales-kit/06・13）。
 */
import { yenText } from "@/lib/format";
import { SITE } from "@/site.config";
import {
  EXAMPLE_PAID,
  FREE_CHECK,
  FREELANCE,
  SAFETY,
  SOURCES,
  STEP_70_CHANGE,
  STEP_70_DATE,
  burdenExample,
  burdenSentence,
  trialLine,
  type Source,
} from "./content";

export type FaxHookId = "notice" | "70" | "freelance" | "safety";

export type FaxOffer = { title: string; body: string };

export type FaxHook = {
  id: FaxHookId;
  /** 一覧で見せる名前 */
  name: string;
  /** いつ送るとよいか（一覧で見せる） */
  when: string;
  /** 見出しの上の日付の札 */
  badge: string;
  headline: string;
  bullets: [string, string, string];
  /** 枠の見出し（「まずは先月分で」「無料でどうぞ」） */
  offerHeading: string;
  /** 枠の中身（1〜2 個） */
  offers: FaxOffer[];
  /** QR の行き先（サイトの中のパス） */
  qrPath: string;
  /** QR の横に書く、行き先の名前 */
  qrTitle: string;
  sources: Source[];
};

/** 既定（/kit/fax）のきっかけ */
export const DEFAULT_FAX_HOOK: FaxHookId = "notice";

export const FAX_HOOK_IDS: FaxHookId[] = ["notice", "70", "freelance", "safety"];

export function parseFaxHook(raw: string | string[] | undefined): FaxHookId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "70" || v === "freelance" || v === "safety" ? v : DEFAULT_FAX_HOOK;
}

/** 原稿の URL（既定のきっかけは ?hook を付けない） */
export function faxHookHref(id: FaxHookId): string {
  return id === DEFAULT_FAX_HOOK ? "/kit/fax" : `/kit/fax?hook=${id}`;
}

export function faxHook(id: FaxHookId): FaxHook {
  if (id === "freelance") {
    const qrTitle = "無料：取引条件の明示書づくりと、支払期日の60日チェック";
    return {
      id,
      name: "フリーランス法（日本郵便への勧告）",
      when: "いつでも。勧告の話題が新しいうちがおすすめ",
      badge: `${FREELANCE.recommendedOn} 公正取引委員会`,
      headline: "9月2日、日本郵便がフリーランス法で勧告。業務委託ドライバーへの条件の明示と60日以内の支払、できていますか",
      bullets: [
        "公正取引委員会が、取引条件を明示していなかったことや支払の遅れについて、日本郵便に勧告しました。",
        `フリーランス法（${FREELANCE.enforcedOn}施行）では、個人の業務委託ドライバーに仕事を頼んだら、単価や支払期日などの条件を、すぐに書面かメールなどで示す必要があります。`,
        "支払期日は、役務の提供を受けた日から60日以内の、できるだけ短い期間で決めます。今の締め日・支払日で足りているか、確かめてみてください。",
      ],
      offerHeading: "無料でどうぞ",
      offers: [
        { title: qrTitle, body: "単価・控除・締め日・支払日を入れると、明示書のたたき台ができ、支払日が60日以内かも確かめられます。" },
        FREE_CHECK,
      ],
      qrPath: "/tools/torihiki-joken",
      qrTitle,
      sources: [SOURCES.jftc],
    };
  }
  if (id === "safety") {
    const qrTitle = "無料の相談（30分・オンライン）";
    return {
      id,
      name: "貨物軽自動車安全管理者（2027年3月31日まで）",
      when: "年明け〜2027年3月。期限が近づくほど効きます",
      badge: `${SAFETY.deadline}まで`,
      headline: `貨物軽自動車安全管理者の選任は${SAFETY.deadline}まで`,
      bullets: [
        "2025年3月末までに届出をしていた軽貨物の事業者は、この日までに、営業所ごとに貨物軽自動車安全管理者を選んで届け出る必要があります。",
        "あわせて、業務記録は1年、事故の記録は3年の保存が求められています。選任や届出は、御社で行っていただくものです。",
        "当方は、業務委託ドライバーの月末の締め（明細・振込データ・元請との突合）の仕組みを作っています。点呼・業務記録・事故記録の仕組みも、オプションで作れます。",
      ],
      offerHeading: "無料でどうぞ",
      offers: [{ title: qrTitle, body: "今の締め方や記録のしかたをうかがい、仕組みにできるかをお伝えします。" }, FREE_CHECK],
      qrPath: "/contact",
      qrTitle,
      sources: [SOURCES.mlit],
    };
  }
  if (id === "70") {
    const burden = burdenExample();
    const before = burden.find((b) => !b.current && b.label.endsWith("まで"));
    const after = burden.find((b) => b.current);
    const later = burden.filter((b) => b !== before && b !== after);
    const example =
      before && after
        ? `例：税込${yenText(EXAMPLE_PAID)}を払うと、会社の負担は1人・月${yenText(before.burden)}→${yenText(after.burden)}。` +
          `その後も${later.map((b) => `${b.label}${yenText(b.burden)}`).join("、")}と増えていきます。`
        : `例：税込${yenText(EXAMPLE_PAID)}を払ったときの負担は、計算ツールで期間ごとに分かります。`;
    const qrTitle = "無料：御社の負担の計算ツール";
    return {
      id,
      name: `インボイスの経過措置（${STEP_70_CHANGE}）`,
      when: "2026年9月〜11月ごろ。年末に向けて効き目が落ちます",
      badge: `${STEP_70_DATE}から`,
      headline: `10月から、免税ドライバーへの支払で会社の負担が増えます（${STEP_70_CHANGE}）`,
      bullets: [
        "インボイス登録をしていない（免税の）ドライバーへの支払は、消費税の一部しか差し引けません。その割合が10月1日から80%→70%に下がります。",
        example,
        "負担が出るのは、消費税を原則課税で計算している会社です（簡易課税・2割特例は出ません）。報酬は一方的に下げず、ドライバーと話し合ってください。",
      ],
      offerHeading: "無料でどうぞ",
      offers: [
        { title: qrTitle, body: "免税の方への月の支払額を入れると、2031年までの負担が期間ごとに分かります。入れた金額は送信されません。" },
        FREE_CHECK,
      ],
      qrPath: "/tools/invoice-cost",
      qrTitle,
      sources: [SOURCES.nta],
    };
  }
  // 既定：元請の支払通知との突合（10月からの 70% を 1 行添える）
  const trial = trialLine();
  const qrTitle = `${SITE.name}の製品の紹介・料金・デモ`;
  return {
    id,
    name: "元請の支払通知との突合（10月からの70%つき）",
    when: "いつでも。2026年12月ごろまでは70%の1行が効きます",
    badge: `${STEP_70_DATE}から ${STEP_70_CHANGE}`,
    headline: "元請の支払通知と、自社の記録は合っていますか。先月分で、差を金額でお見せします",
    bullets: [
      "元請の支払通知を置くと、自社の記録と案件ごとに比べ、少ない可能性がある差を金額で出します。確認をお願いする文の下書きも作ります。",
      "今のExcelは形を変えずに置くだけ。先月分を今の計算と1人ずつ比べ、差と原因の候補もお出しします。",
      burdenSentence(),
    ],
    offerHeading: "まずは先月分で",
    offers: [
      trial ?? { title: "先月分でお試し", body: "先月の稼働のExcel・今の振込額・元請の支払通知をお預かりし、差を金額でお見せします。" },
      { title: qrTitle, body: "何ができるか・料金・架空の会社で動くデモを、スマホで見られます。" },
    ],
    qrPath: "/product",
    qrTitle,
    sources: [SOURCES.nta],
  };
}
