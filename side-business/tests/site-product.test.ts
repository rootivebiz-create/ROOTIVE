import { describe, expect, it } from "vitest";
import { landingFaq } from "@/components/landing/faq";
import { flowSteps } from "@/components/landing/flow";
import {
  ENOUGH,
  HERO,
  MONTH_STEPS,
  NEVER,
  PAINS,
  PROMISES,
  REQUIREMENTS,
  SCREENS,
} from "@/components/landing/product-content";
import { MAINTENANCE_INCLUDES, OPTIONS, PLANS, SITE, productDemoStartUrl } from "@/site.config";

describe("productDemoStartUrl（製品のデモの入口）", () => {
  it("未設定・空なら null（画面にリンクを出さない）", () => {
    expect(productDemoStartUrl(undefined)).toBeNull();
    expect(productDemoStartUrl(null)).toBeNull();
    expect(productDemoStartUrl("")).toBeNull();
    expect(productDemoStartUrl("   ")).toBeNull();
  });

  it("URL の後ろに /demo/start を付ける。末尾の / や /demo/start が付いていても二重にしない", () => {
    expect(productDemoStartUrl("https://shimebi-demo.vercel.app")).toBe("https://shimebi-demo.vercel.app/demo/start");
    expect(productDemoStartUrl("https://shimebi-demo.vercel.app/")).toBe("https://shimebi-demo.vercel.app/demo/start");
    expect(productDemoStartUrl(" https://shimebi-demo.vercel.app/demo/start ")).toBe("https://shimebi-demo.vercel.app/demo/start");
    expect(productDemoStartUrl("https://example.jp/shimebi/")).toBe("https://example.jp/shimebi/demo/start");
    expect(productDemoStartUrl("http://localhost:3300")).toBe("http://localhost:3300/demo/start");
  });

  it("https:// が無ければ付ける", () => {
    expect(productDemoStartUrl("shimebi-demo.vercel.app")).toBe("https://shimebi-demo.vercel.app/demo/start");
  });

  it("http(s) 以外は受け付けない", () => {
    expect(productDemoStartUrl("javascript:alert(1)")).toBeNull();
    expect(productDemoStartUrl("ftp://example.jp")).toBeNull();
    expect(productDemoStartUrl("mailto:a@example.jp")).toBeNull();
  });
});

describe("料金は変えていない", () => {
  it("パックの id と金額（税抜）", () => {
    expect(PLANS.map((p) => [p.id, p.initialYen, p.monthlyYen])).toEqual([
      ["trial", 50_000, 0],
      ["payroll", 250_000, 18_000],
      ["profit", 480_000, 35_000],
    ]);
  });

  it("運行記録オプションの金額と、製品の標準には無いという正直な注記", () => {
    expect(OPTIONS.map((o) => [o.id, o.initialYen, o.monthlyYen])).toEqual([["records", 150_000, 10_000]]);
    expect(OPTIONS[0].note).toContain("ご相談のうえ、御社向けに作ります（製品の標準には入っていません）");
  });
});

describe("パックの中身は、製品が今できることだけ", () => {
  const plan = (id: string) => PLANS.find((p) => p.id === id)!;
  const text = (id: string) => plan(id).includes.join("\n");

  it("お試し：名前は番号に・口座と住所は消して。1 円単位の並行運用レポート・支払通知の突き合わせ・見張り番", () => {
    const t = text("trial");
    expect(t).toContain("名前は番号に置きかえ");
    expect(t).toContain("口座・住所の列は消して");
    expect(t).toMatch(/1 円単位で比べる並行運用レポート/);
    expect(t).toMatch(/元請の支払通知（CSV・Excel）があれば/);
    expect(t).toContain("見張り番");
  });

  it("支払明細パック：取り込み・控除と合意・明細 PDF・リンクと確認と質問・明示書と受け取り・見張り番・全銀・締めと記録・並行運用", () => {
    const t = text("payroll");
    for (const word of [
      "そのまま取り込み",
      "合意したか",
      "支払明細 PDF",
      "リンク",
      "「確認しました」",
      "質問",
      "取引条件の明示書",
      "「受け取りました」",
      "見張り番",
      "全銀",
      "締め",
      "誰がいつ何をしたか",
      "並行運用",
    ]) {
      expect(t, word).toContain(word);
    }
  });

  it("利益まるごとパック：突き合わせと問い合わせ文・利益・社長の1枚・会計 CSV（税理士さんと確認）", () => {
    const t = text("profit");
    expect(t).toContain("支払明細パックのすべて");
    expect(t).toContain("元請の支払通知");
    expect(t).toContain("問い合わせ文の下書き");
    expect(t).toMatch(/案件別・元請別・ドライバー別の利益/);
    expect(t).toContain("社長の1枚");
    expect(t).toContain("弥生会計のインポート形式 ほか");
    expect(t).toContain("税理士さんと確かめて");
  });

  it("製品に無いものは約束しない（請求書の作成・経費と営業利益・月の目標・社長向けのスマホ画面）", () => {
    const all = PLANS.flatMap((p) => p.includes).join("\n");
    expect(all).not.toMatch(/請求書の作成|経費の登録|営業利益|月の目標|スマホ画面/);
  });
});

describe("トップの流れ", () => {
  it("大見出しは、元請の支払通知の突き合わせと月末の締めを 1 文で", () => {
    expect(HERO.title).toContain("元請の支払通知");
    expect(HERO.title).toContain("月末の締め");
    expect(HERO.title.match(/。/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("できることは、ひと月の順（取り込み→見張り番→明細と確認→振込→締め→突合→利益）で、どれも製品の画面にある", () => {
    expect(MONTH_STEPS.map((s) => s.screenId)).toEqual(["import", "watch", "statements", "transfer", "close", "reconcile", "profit"]);
    for (const s of MONTH_STEPS) expect(SCREENS.some((x) => x.id === s.screenId), s.screenId).toBe(true);
  });

  it("導入の流れは、お試し（先月分）→ 立ち上げ → 並行運用 → 本番。お試しの費用は PLANS から", () => {
    const steps = flowSteps();
    expect(steps.map((s) => s.title)).toEqual(["お試し（先月分）", "立ち上げ", "並行運用", "本番"]);
    expect(steps[0].time).toContain("5万円");
    expect(steps[1].body).toContain("最初の午後");
    expect(steps[1].body).toContain("並行運用レポート");
    expect(steps[2].time).toBe("1〜2か月");
  });

  it("よくある質問に、データの置き場所・やめたら・アプリ不要・会計ソフト・インボイス・PDF の通知・人数がある", () => {
    const qs = landingFaq(true).map((f) => f.q).join("\n");
    for (const word of ["データはどこ", "やめたら", "アプリ", "会計ソフト", "インボイス", "PDF", "何人から"]) {
      expect(qs, word).toContain(word);
    }
    const pdf = landingFaq(true).find((f) => f.q.includes("PDF"));
    expect(pdf?.a).toMatch(/CSVかExcel/);
  });

  it("「今お使いのツールで十分では？」は 6 つ（突合・確認の記録・見張り番・並行運用・立ち上げ・データ）", () => {
    expect(ENOUGH.items.map((i) => i.title)).toEqual([
      "元請の支払通知との突き合わせ",
      "ドライバーの「確認しました」の記録",
      "締め前の見張り番",
      "1 円まで確かめてから切り替え",
      "立ち上げまで当方が",
      "データは御社のもの",
    ]);
  });
});

/** お客様に見せる文（サイトと /product）をすべて集める */
function customerTexts(): string[] {
  return [
    SITE.tagline,
    SITE.description,
    ...PLANS.flatMap((p) => [p.name, p.forWhom, p.weeks, p.note ?? "", ...p.includes]),
    ...OPTIONS.flatMap((o) => [o.name, o.note]),
    ...MAINTENANCE_INCLUDES,
    ...[true, false].flatMap((op) => landingFaq(op).flatMap((f) => [f.q, f.a])),
    HERO.eyebrow,
    HERO.title,
    HERO.body,
    ...SCREENS.flatMap((s) => [s.name, s.summary, s.why, ...s.shows]),
    ...MONTH_STEPS.flatMap((s) => [s.label, s.body]),
    ENOUGH.title,
    ENOUGH.lead,
    ...ENOUGH.items.flatMap((i) => [i.title, i.body]),
    ...PAINS.flatMap((p) => [p.title, p.body]),
    ...PROMISES.flatMap((p) => [p.who, ...p.items]),
    ...NEVER.flatMap((n) => [n.title, n.body]),
    ...REQUIREMENTS.flatMap((r) => [r.title, r.body]),
    ...flowSteps().flatMap((s) => [s.title, s.time ?? "", s.body]),
  ];
}

describe("言ってはいけないことを書いていない", () => {
  const texts = customerTexts();
  /** 「〜」とは言いません、の形の否定は外してから調べる */
  const stripDenials = (t: string) => t.replace(/「[^」]*」とは言いません/g, "");

  const FORBIDDEN: [string, RegExp][] = [
    ["補助金", /補助金が使えます|補助金を使えます|補助金の対象です/],
    ["効果の約束", /完全自動|ミスゼロ|必ず合う|必ず合います|必ず元が取れ|削減でき|時間が減ります|離職が減/],
    ["判定", /(?<!不)適法(?!かどうか)|違反はありません|違反です|問題ありません|対応済み|完全対応|監査は大丈夫|調査に対応|防げます/],
    ["税務の断定", /仕入税額控除(が|を)?できます|控除できます|税務上問題/],
    ["回収の約束", /取り戻せます|取り戻します|回収できます|回収します|未払いです/],
    ["比べ方", /他社には(無|な)い|どこにも(無|な)い|ほかには(無|な)い|業界初|唯一/],
    ["ほかの会社の名前", /K-LINK|K-LEDGE|コムトラック|IXOL|楽楽明細|ラクス|freee業務委託|kintone|コムデック|トドク|軽貨物Pro|CarryNote|一番星|ATRAS|TOKIUM|Bill One|invox/i],
    ["報酬を下げる助言", /単価を下げ|報酬を下げるべき|引き下げ|単価を見直しましょう/],
    ["実績のふり", /導入社数|導入実績|お客様の声|社が導入/],
  ];

  for (const [label, re] of FORBIDDEN) {
    it(label, () => {
      for (const t of texts) expect(stripDenials(t), t).not.toMatch(re);
    });
  }

  it("製品に無い機能を書かない（控除を Excel の計算から読み取る・明細に合意の日を出す・差は 5 種類）", () => {
    for (const t of texts) expect(t, t).not.toMatch(/計算から読み取|読み取って提案|合意した日を表示|いつ合意したか|差を 4 つ/);
  });

  it("会計ソフトに「対応」と書かない（取り込めたことを確かめるまで）", () => {
    for (const t of texts) expect(t, t).not.toMatch(/会計[^。]*対応|対応[^。]*会計/);
  });

  it("判断は税理士・弁護士に残すと書いている", () => {
    const all = texts.join("\n");
    expect(all).toMatch(/税理士/);
    expect(all).toMatch(/弁護士/);
  });
});
