import { describe, expect, it } from "vitest";
import {
  changeText,
  deductionText,
  describeVersionChanges,
  paymentWordingProblem,
  readTermsContent,
  termsHash,
  termsSections,
  type StoredTermsContent,
} from "~/server/features/terms/document";
import { termsStatusOf, termsStatusTone } from "~/server/features/terms/status";
import { countTermsRows, filterTermsRows, parseTermsFilter, type TermsListRow } from "~/server/features/terms";

/** 明示書の中身の書き方（純関数）：明示する事項のラベル・文・ハッシュ・版の差・状態 */

function content(patch: Partial<StoredTermsContent> = {}): StoredTermsContent {
  return {
    serviceDescription: "貨物軽自動車を使った荷物の配送業務",
    services: [
      { projectId: "p1", name: "宅配（個建て）", client: "A物流（架空）", unit: "個", payRate: 152.5 },
      { projectId: "p2", name: "企業配（日当）", client: null, unit: "日", payRate: 18000 },
    ],
    taxNote: "報酬（税抜）とは別に、消費税（登録の無い方は消費税相当額）を支払います。",
    payment: { closingDay: 0, payMonthOffset: 1, payDay: 25, text: "毎月末日締め・翌月25日払い（支払日が金融機関の休業日のときは、その前の営業日に支払います）", periodText: "毎月1日から末日まで" },
    feeBearer: "company",
    deductions: [
      { ruleId: "r1", name: "ロイヤリティ", kind: "percent", rate: 0.1, amount: null, onlyWhenWorked: true, how: "委託料（税抜）の 10%（稼働した月だけ）", taxable: true },
      { ruleId: "r2", name: "立替の精算", kind: "fixed", rate: null, amount: 3000, onlyWhenWorked: true, how: "毎月 3,000円（稼働した月だけ）", taxable: false },
    ],
    place: "会社が指定する配送先",
    period: { from: "2026-05-01", to: null },
    receipt: "業務を行った日ごとに受け取ったものとします。",
    deemedClause: null,
    other: "",
    commissionedOn: null,
    ...patch,
  };
}

const base = { subcontract: null, documentName: null, issuedOn: "2026-10-20" };

describe("明示書の事項（フリーランス法 第3条で明示する事項のラベル）", () => {
  it("給付の内容・報酬の額・支払期日・委託した日・給付を受け取る日・場所・控除ごとの式がそろう", () => {
    const secs = termsSections({ ...base, content: content() });
    const by = Object.fromEntries(secs.map((x) => [x.label, x]));
    for (const label of ["給付の内容（業務の内容）", "報酬の額・算定方法", "支払期日", "委託した日", "給付を受け取る日・期間", "給付を受け取る場所", "報酬から差し引くもの（控除）", "業務の期間", "振込手数料"]) {
      expect(by[label], label).toBeDefined();
      expect(by[label].paragraphs.join("")).not.toBe("");
    }
    expect(by["報酬の額・算定方法"].table?.rows).toEqual([
      ["宅配（個建て）", "A物流（架空）", "152.5円", "1個あたり"],
      ["企業配（日当）", "—", "18,000円", "1日あたり"],
    ]);
    expect(by["支払期日"].paragraphs).toEqual([
      "毎月末日締め・翌月25日払い（支払日が金融機関の休業日のときは、その前の営業日に支払います）",
      "締めの期間：毎月1日から末日まで",
      "支払の方法：銀行振込",
    ]);
    expect(by["委託した日"].paragraphs).toEqual(["2026年10月20日"]);
    expect(by["業務の期間"].paragraphs).toEqual(["2026年5月1日から（終わりの日は定めていません）"]);
    expect(by["報酬から差し引くもの（控除）"].paragraphs).toEqual([
      "ロイヤリティ：委託料（税抜）の 10%（稼働した月だけ）（税抜。消費税 10% を加えて差し引きます）",
      "立替の精算：毎月 3,000円（稼働した月だけ）（消費税の対象外として扱います）",
    ]);
    expect(by["振込手数料"].paragraphs).toEqual(["振込手数料は、委託者（会社）が負担します。"]);
    // 入れていない条項は出さない
    expect(secs.map((x) => x.key)).not.toContain("deemed");
    expect(secs.map((x) => x.key)).not.toContain("subcontract");
    expect(secs.map((x) => x.key)).not.toContain("document");
    expect(secs.map((x) => x.key)).not.toContain("other");
  });

  it("みなし確認の条項・再委託の 3 項目・書面の名前・その他・委託した日・ドライバー負担の振込手数料", () => {
    const secs = termsSections({
      content: content({ deemedClause: "記載内容に誤りがある場合は、支払明細の受け取りから7日以内にご連絡ください。", other: "車両は受託者が用意します", commissionedOn: "2026-04-15", feeBearer: "driver", period: { from: "2026-05-01", to: "2027-03-31" } }),
      subcontract: { isSubcontract: true, originalClient: "A物流（架空）", originalPayDate: "毎月末日締め・翌月末日払い" },
      documentName: "業務委託契約書（2026年4月1日）",
      issuedOn: "2026-10-20",
    });
    const by = Object.fromEntries(secs.map((x) => [x.key, x]));
    expect(by.deemed.label).toBe("支払明細の確認のしかた");
    expect(by.subcontract.paragraphs).toEqual(["この業務は、委託者が元委託者から受けた業務の再委託です。", "元委託者：A物流（架空）", "元委託の支払期日：毎月末日締め・翌月末日払い"]);
    expect(by.document.paragraphs[0]).toContain("「業務委託契約書（2026年4月1日）」");
    expect(by.other.paragraphs).toEqual(["車両は受託者が用意します"]);
    expect(by.commissioned.paragraphs).toEqual(["2026年4月15日"]);
    expect(by.period.paragraphs).toEqual(["2026年5月1日から2027年3月31日まで"]);
    expect(by.fee.emphasis).toBe(true);
    // 設定は計算を変えない（明細・振込データで差し引かない）ので、明示書にも「振込額から差し引きます」と書かない
    expect(by.fee.paragraphs).toEqual(["振込手数料は、受託者（ドライバー）の負担とします。"]);
    expect(by.fee.paragraphs.join("")).not.toContain("差し引");
  });

  it("中身の写しが無い記録（手で入れた版）は、そう書く", () => {
    expect(readTermsContent({})).toBeNull();
    expect(readTermsContent(null)).toBeNull();
    const secs = termsSections({ ...base, content: null });
    expect(secs).toHaveLength(1);
    expect(secs[0].paragraphs[0]).toContain("写しがありません");
  });

  it("空の欄は（未記入）と出す", () => {
    const secs = termsSections({ ...base, content: content({ place: "", receipt: "" }) });
    expect(secs.find((x) => x.key === "place")!.paragraphs).toEqual(["（未記入）"]);
    expect(secs.find((x) => x.key === "receipt")!.paragraphs).toEqual(["（未記入）"]);
  });
});

describe("支払期日の文・ハッシュ・版の差", () => {
  it("「まで」「以内」を見つける", () => {
    expect(paymentWordingProblem("翌月末日までに支払う")).toEqual(["まで"]);
    expect(paymentWordingProblem("受け取りから60日以内に支払う")).toEqual(["以内"]);
    expect(paymentWordingProblem(content().payment.text)).toEqual([]);
  });

  it("ハッシュはキーの順に左右されず、中身・書面の名前・明示した日が変わると変わる", () => {
    const a = termsHash({ content: content(), ...base });
    const reordered = Object.fromEntries(Object.entries(content()).reverse());
    expect(termsHash({ content: reordered, ...base })).toBe(a);
    expect(termsHash({ content: content({ place: "別の場所" }), ...base })).not.toBe(a);
    expect(termsHash({ content: content(), ...base, documentName: "契約書" })).not.toBe(a);
    expect(termsHash({ content: content(), ...base, issuedOn: "2026-10-21" })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("版の差：単価・控除・案件の増減・文・条項", () => {
    const before = { content: content(), subcontract: null, documentName: null, issuedOn: "2026-05-01" };
    const after = {
      content: content({
        services: [
          { projectId: "p1", name: "宅配（個建て）", client: "A物流（架空）", unit: "個", payRate: 150 },
          { projectId: "p3", name: "夜間便", client: "A物流（架空）", unit: "便", payRate: 9500 },
        ],
        deductions: [{ ruleId: "r1", name: "ロイヤリティ", kind: "percent", rate: 0.08, amount: null, onlyWhenWorked: true, how: "委託料（税抜）の 8%（稼働した月だけ）", taxable: true }],
        place: "A物流 ○○センター",
        deemedClause: "記載内容に誤りがある場合は…",
      }),
      subcontract: { isSubcontract: true, originalClient: "A物流（架空）", originalPayDate: "翌月末日" },
      documentName: "業務委託契約書",
      issuedOn: "2026-10-20",
    };
    const d = describeVersionChanges(before, after);
    expect(d).toEqual([
      "「宅配（個建て）」の単価：152.5円/個 → 150円/個",
      "控除「ロイヤリティ」：委託料（税抜）の 10%（稼働した月だけ） → 委託料（税抜）の 8%（稼働した月だけ）",
      "控除「立替の精算」がなくなりました（前は 毎月 3,000円（稼働した月だけ））",
      "案件を追加：夜間便（9,500円／便）",
      "案件を外しました：企業配（日当）",
      "場所：「会社が指定する配送先」→「A物流 ○○センター」",
      "明細のみなし確認の条項を入れました",
      "再委託の項目：元委託者「A物流（架空）」・元委託の支払期日「翌月末日」",
      "明示した書面：「業務委託契約書」",
    ]);
    expect(describeVersionChanges(before, before)).toEqual([]);
    expect(changeText({ kind: "fee", label: "振込手数料の負担", before: "company", after: "driver" })).toBe("振込手数料の負担：会社 → ドライバー");
    expect(deductionText({ ruleId: "x", name: "管理費", kind: "fixed", rate: null, amount: 15000, onlyWhenWorked: true, how: "毎月 15,000円（稼働した月だけ）" })).toBe("管理費：毎月 15,000円（稼働した月だけ）");
  });
});

describe("状態と一覧の絞り込み", () => {
  it("未作成・未送付・送付済み・受け取り済み", () => {
    expect(termsStatusOf(null)).toBe("none");
    expect(termsStatusOf({ sentAt: null, receivedAt: null })).toBe("unsent");
    expect(termsStatusOf({ sentAt: new Date(), receivedAt: null })).toBe("sent");
    expect(termsStatusOf({ sentAt: null, receivedAt: new Date() })).toBe("received");
    expect(termsStatusTone("none", true)).toBe("red");
    expect(termsStatusTone("none", false)).toBe("yellow");
    expect(termsStatusTone("received", false)).toBe("green");
  });

  it("絞り込み：未作成・変更あり・未受け取り", () => {
    const row = (id: string, status: TermsListRow["status"], changes: string[] = [], worked = true): TermsListRow => ({
      driverId: id,
      code: null,
      name: id,
      kana: null,
      firstIssuedOn: null,
      startedOn: null,
      lastWorkMonth: null,
      workedRecently: worked,
      latest: null,
      versions: 0,
      status,
      changes,
    });
    const rows = [row("a", "none"), row("b", "unsent", ["x"]), row("c", "sent"), row("d", "received", ["y"]), row("e", "none", [], false)];
    expect(filterTermsRows(rows, "none").map((r) => r.driverId)).toEqual(["a", "e"]);
    expect(filterTermsRows(rows, "changed").map((r) => r.driverId)).toEqual(["b", "d"]);
    expect(filterTermsRows(rows, "unreceived").map((r) => r.driverId)).toEqual(["b", "c"]);
    expect(filterTermsRows(rows, "")).toHaveLength(5);
    expect(countTermsRows(rows)).toEqual({ total: 5, none: 2, noneWorked: 1, unsent: 1, sent: 1, received: 1, changed: 2, unreceived: 2 });
    expect(parseTermsFilter("changed")).toBe("changed");
    expect(parseTermsFilter(["none"])).toBe("none");
    expect(parseTermsFilter("drop table")).toBe("");
  });
});
