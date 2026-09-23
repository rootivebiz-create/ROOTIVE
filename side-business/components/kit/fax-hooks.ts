/**
 * FAX DM（A4 縦・白黒・1 枚）の「きっかけ」ごとの見出し・3 つの要点・QR の行き先。
 * ?hook=70（既定）| freelance | safety。数字は lib/payroll/tax.ts から組み立てる。
 */
import { yenText } from "./format";
import { EXAMPLE_PAID, FREELANCE, SAFETY, SOURCES, burdenExample, type Source } from "./content";

export type FaxHookId = "70" | "freelance" | "safety";

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
  /** QR の行き先（サイトの中のパス） */
  qrPath: string;
  /** QR の横に書く、行き先の名前 */
  qrTitle: string;
  /** QR の横に書く、ひとこと */
  qrBody: string;
  sources: Source[];
};

export const FAX_HOOK_IDS: FaxHookId[] = ["70", "freelance", "safety"];

export function parseFaxHook(raw: string | string[] | undefined): FaxHookId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "freelance" || v === "safety" ? v : "70";
}

export function faxHook(id: FaxHookId): FaxHook {
  if (id === "freelance") {
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
      qrPath: "/tools/torihiki-joken",
      qrTitle: "無料：取引条件の明示書づくりと、支払期日の60日チェック",
      qrBody: "単価・控除・締め日・支払日を入れると、明示書のたたき台ができ、支払日が60日以内かも確かめられます。",
      sources: [SOURCES.jftc],
    };
  }
  if (id === "safety") {
    return {
      id,
      name: "貨物軽自動車安全管理者（2027年3月31日まで）",
      when: "年明け〜2027年3月。期限が近づくほど効きます",
      badge: `${SAFETY.deadline}まで`,
      headline: `貨物軽自動車安全管理者の選任は${SAFETY.deadline}まで`,
      bullets: [
        "2025年3月末までに届出をしていた軽貨物の事業者は、この日までに、営業所ごとに貨物軽自動車安全管理者を選んで届け出る必要があります。",
        "あわせて、業務記録は1年、事故の記録は3年の保存が求められています。選任や届出は、御社で行っていただくものです。",
        "当方は、業務委託ドライバーの支払明細・振込データ・利益の仕組みを作っています。点呼・業務記録・事故記録の仕組みも、オプションで作れます。",
      ],
      qrPath: "/contact",
      qrTitle: "無料の相談（30分・オンライン）",
      qrBody: "今の締め方や記録のしかたをうかがい、仕組みにできるかをお伝えします。",
      sources: [SOURCES.mlit],
    };
  }
  const burden = burdenExample();
  const before = burden.find((b) => !b.current && b.label.endsWith("まで"));
  const after = burden.find((b) => b.current);
  const later = burden.filter((b) => b !== before && b !== after);
  const example =
    before && after
      ? `例：税込${yenText(EXAMPLE_PAID)}を払うと、会社の負担は1人・月${yenText(before.burden)}→${yenText(after.burden)}。` +
        `その後も${later.map((b) => `${b.label}${yenText(b.burden)}`).join("、")}と増えていきます。`
      : `例：税込${yenText(EXAMPLE_PAID)}を払ったときの負担は、計算ツールで期間ごとに分かります。`;
  return {
    id,
    name: "インボイスの経過措置（控除80%→70%）",
    when: "2026年9月〜11月ごろ。年末に向けて効き目が落ちます",
    badge: "2026年10月1日から",
    headline: "10月から、免税ドライバーへの支払で会社の負担が増えます（控除80%→70%）",
    bullets: [
      "インボイス登録をしていない（免税の）ドライバーへの支払は、消費税の一部しか差し引けません。その割合が10月1日から80%→70%に下がります。",
      example,
      "負担が出るのは、消費税を原則課税で計算している会社です（簡易課税・2割特例は出ません）。報酬は一方的に下げず、ドライバーと話し合ってください。",
    ],
    qrPath: "/tools/invoice-cost",
    qrTitle: "無料：御社の負担の計算ツール",
    qrBody: "免税の方への月の支払額を入れると、2031年までの負担が期間ごとに分かります。入れた金額は送信されません。",
    sources: [SOURCES.nta],
  };
}
