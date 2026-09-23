import { describe, expect, it } from "vitest";
import { comparisonChoices } from "@/components/kit/content";
import { makerCopy } from "@/components/kit/maker";
import { confidentialityFaq, landingFaq } from "@/components/landing/faq";
import { trialOffer } from "@/lib/plans";
import { PLANS, SHARE_IMAGE, SITE, siteUrlFrom, type Plan } from "@/site.config";

describe("siteUrlFrom（本番の URL）", () => {
  it("NEXT_PUBLIC_SITE_URL がいちばん先。末尾の / は外す", () => {
    expect(siteUrlFrom({ NEXT_PUBLIC_SITE_URL: "https://example.jp/", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" })).toBe(
      "https://example.jp",
    );
  });

  it("無ければ Vercel の本番ドメインに https:// を付ける", () => {
    expect(siteUrlFrom({ VERCEL_PROJECT_PRODUCTION_URL: "shimebi.vercel.app" })).toBe("https://shimebi.vercel.app");
    expect(siteUrlFrom({ NEXT_PUBLIC_SITE_URL: "  ", VERCEL_PROJECT_PRODUCTION_URL: "shimebi.vercel.app" })).toBe(
      "https://shimebi.vercel.app",
    );
    expect(siteUrlFrom({ NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL: "https://shimebi.vercel.app" })).toBe(
      "https://shimebi.vercel.app",
    );
  });

  it("どちらも無ければ手元の開発用", () => {
    expect(siteUrlFrom({})).toBe("http://localhost:3200");
  });
});

describe("作り手の書き方（SITE.makerIsOperator）", () => {
  const OPERATOR_WORDS = /代表|経営|軽貨物会社|運送会社を|自分の会社/;

  it("既定は true", () => {
    expect(SITE.makerIsOperator).toBe(true);
  });

  it("false のときは、運送会社を営んでいるとどこにも書かない", () => {
    const copy = makerCopy(false);
    for (const [key, text] of Object.entries(copy)) {
      expect(text, key).not.toMatch(OPERATOR_WORDS);
      expect(text, key).not.toBe("");
    }
    expect(copy.paragraph).toContain("運送業の支払の仕組みに詳しい作り手が、AIを使って作ります");
  });

  it("true のときは、経営している本人と書く", () => {
    const copy = makerCopy(true);
    expect(copy.paragraph).toContain("経営している本人");
    expect(copy.pointTitle).toContain("代表");
  });
});

describe("よくある質問：単価や元請を預けて大丈夫か", () => {
  it("作り手が運送会社のとき：秘密保持・30日以内に消す・取引先が重なる会社とは取引しない・御社のアカウント", () => {
    const f = confidentialityFaq(true);
    expect(f.q).toBe("同業の運送会社の代表に、うちの単価や元請を知られて大丈夫？");
    expect(f.a).toContain("秘密保持契約");
    expect(f.a).toContain("その仕事だけに使い、終わったら30日以内に消します");
    expect(f.a).toContain("元請・荷主が重なる会社とは、取引しません");
    expect(f.a).toContain("あらかじめ確認します");
    expect(f.a).toContain("御社のアカウント");
  });

  it("中立の書き方のときは、同業の話をしない", () => {
    const f = confidentialityFaq(false);
    expect(`${f.q}${f.a}`).not.toMatch(/同業|代表|当方の会社/);
    expect(f.a).toContain("秘密保持契約");
    expect(f.a).toContain("30日以内に消します");
  });

  it("トップの質問（構造化データと同じ一覧）に入っている", () => {
    expect(landingFaq(true).map((f) => f.q)).toContain(confidentialityFaq(true).q);
    expect(landingFaq(false).map((f) => f.q)).toContain(confidentialityFaq(false).q);
    expect(landingFaq(false).some((f) => /同業の運送会社の代表/.test(f.q))).toBe(false);
  });
});

describe("trialOffer（提案書の次の一歩）", () => {
  it("お試しの費用・期間・本契約で差し引くことを PLANS から組み立てる", () => {
    const offer = trialOffer();
    const trial = PLANS.find((p) => p.monthlyYen === 0);
    expect(trial).toBeDefined();
    expect(offer?.name).toBe(trial?.name);
    expect(offer?.weeks).toBe(trial?.weeks);
    expect(offer?.price).toBe("50,000円（税抜）");
    expect(offer?.credit).toBe("本契約になったら、この5万円は初期費用から全額差し引きます");
  });

  it("お試しが無ければ null", () => {
    const packs: Plan[] = PLANS.filter((p) => p.monthlyYen > 0);
    expect(trialOffer(packs)).toBeNull();
  });
});

describe("比較表", () => {
  it("出典の無い kintone の金額は書かない", () => {
    const nocode = comparisonChoices().find((c) => c.name.includes("kintone"));
    expect(nocode?.name).toContain("ノーコードの業務アプリ（kintone など）");
    expect(nocode?.values.monthly).toContain("利用料＋作り込みの外注費");
    for (const v of Object.values(nocode?.values ?? {})) expect(v).not.toMatch(/\d/);
  });
});

describe("共有の画像", () => {
  it("public/og.png（1200×630）を指す", () => {
    expect(SHARE_IMAGE).toMatchObject({ url: "/og.png", width: 1200, height: 630 });
    expect(SHARE_IMAGE.alt).toContain(SITE.name);
  });
});
