import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { columnsProblem, detectColumns, EMPTY_COLUMNS, parseNoticeRows } from "~/server/features/reconcile/columns";
import { compareNotice, sumDiffs, type CmpLine, type CompareInput } from "~/server/features/reconcile/compare";
import { daysAfter, receivingFacts } from "~/server/features/reconcile/facts";
import { formulaText, isChargeName, lineKey, waitingDays } from "~/server/features/reconcile/labels";
import { buildLetter, mailtoHref, type LetterItem } from "~/server/features/reconcile/letter";
import { detectHeaderRow, parseCsv } from "~/server/tabular";

describe("お支払通知の列を当てる", () => {
  it("よくある見出し：日付・ドライバー・業務内容・件数・単価・金額（税抜と税込があれば税抜）", () => {
    const rows = parseCsv(
      [
        "No,配達日,ドライバー名,業務内容,件数,単価（円）,金額（税抜）,金額（税込）",
        "1,2026/10/01,青木 翔太,宅配,120,190,22800,25080",
        "2,2026/10/01,上田 健,宅配,80,190,15200,16720",
      ].join("\n"),
    );
    const h = detectHeaderRow(rows);
    expect(h).toBe(0);
    const { columns, notes } = detectColumns(rows, h);
    expect(columns).toEqual({ date: 1, driver: 2, item: 3, qty: 4, unitPrice: 5, amount: 6 });
    expect(notes).toEqual([]);
    expect(columnsProblem(columns)).toBeNull();
  });

  it("金額が税込だけで、数量と単価があるときは 数量 × 単価 で出す", () => {
    const rows = parseCsv("コース,日数,単価,税込金額\n企業配,20,22000,484000\n");
    const { columns, notes } = detectColumns(rows, 0);
    expect(columns).toMatchObject({ item: 0, qty: 1, unitPrice: 2, amount: null });
    expect(notes[0]).toContain("税込");
    const parsed = parseNoticeRows(rows, 0, columns, { rounding: "round", month: "2026-10-01" });
    expect(parsed.lines).toEqual([{ rowNo: 2, rawProject: "企業配", rawDriver: null, qty: 20, unitPrice: 22000, amount: 440000, date: null }]);
  });

  it("覚えた対応があればそれを使い、見出しが合わなければ当て直す", () => {
    const rows = parseCsv("摘要,数,支払額\n宅配,10,1900\n");
    // 「数」は数量の言葉に当たらない。前回、利用者が選んだ対応を使う
    const saved = { item: "摘要", qty: "数", amount: "支払額" };
    expect(detectColumns(rows, 0, saved)).toMatchObject({ fromSaved: true, columns: { ...EMPTY_COLUMNS, item: 0, qty: 1, amount: 2 } });
    const other = parseCsv("品目,数量,金額\n宅配,10,1900\n");
    expect(detectColumns(other, 0, saved)).toMatchObject({ fromSaved: false, columns: { ...EMPTY_COLUMNS, item: 0, qty: 1, amount: 2 } });
  });

  it("合計・消費税・振込手数料の行は突合に使わない。金額の無い行は 数量 × 単価（会社の端数処理）", () => {
    const rows = parseCsv(
      [
        "品目,数量,単価,金額",
        "ルート配送,7.5,2601,",
        "スポット便,3,9000,27000",
        ",,,",
        "小計,,,46507",
        "消費税,,,4650",
        "振込手数料,,,-660",
        "合計,,,50497",
      ].join("\n"),
    );
    const cols = { ...EMPTY_COLUMNS, item: 0, qty: 1, unitPrice: 2, amount: 3 };
    const floor = parseNoticeRows(rows, 0, cols, { rounding: "floor", month: "2026-10-01" });
    expect(floor.lines.map((l) => [l.rawProject, l.amount])).toEqual([
      ["ルート配送", 19507],
      ["スポット便", 27000],
    ]);
    expect(floor).toMatchObject({ total: 46507, fileTotal: 50497, taxTotal: 4650, feeTotal: 660 });
    // 合計 = 行 ＋ 消費税 − 手数料 なので、合わないという注意は出さない
    expect(floor.warnings).toEqual([]);
    expect(floor.skipped.map((x) => x.reason)).toEqual(["合計の行", "消費税の行（単価・金額は税抜で比べます）", "振込手数料の行（「差し引かれた手数料」として扱います）", "合計の行"]);
    const round = parseNoticeRows(rows, 0, cols, { rounding: "round", month: "2026-10-01" });
    expect(round.lines[0].amount).toBe(19508);
    expect(round.warnings[0]).toContain("合いません");
  });

  it("日付の列があれば、その月の外の行を数える", () => {
    const rows = parseCsv("日付,品目,金額\n2026/10/31,宅配,1900\n2026/11/01,宅配,190\n");
    const { columns } = detectColumns(rows, 0);
    const parsed = parseNoticeRows(rows, 0, columns, { rounding: "round", month: "2026-10-01" });
    expect(parsed.dates).toEqual({ from: "2026-10-31", to: "2026-11-01", outside: 1 });
    expect(parsed.warnings[0]).toContain("2026年10月の外の日付の行が 1 行");
  });
});

describe("突き合わせの計算", () => {
  const projects = [
    { id: "p1", name: "宅配（個建て）", clientId: "c1", unit: "個", billRate: 190 },
    { id: "p2", name: "夜間便", clientId: "c1", unit: "便", billRate: 12000 },
    { id: "p3", name: "待機料", clientId: "c1", unit: "時間", billRate: 1500 },
    { id: "p4", name: "スポット便", clientId: "c2", unit: "件", billRate: 9000 },
  ];
  const line = (over: Partial<CmpLine>): CmpLine => ({ id: Math.random().toString(36), rawProject: "", rawDriver: null, projectId: null, driverId: null, qty: null, unitPrice: null, amount: 0, role: "project", ...over });
  const base = (lines: CmpLine[], work: CompareInput["work"]): CompareInput => ({ clientId: "c1", projects, drivers: [{ id: "d1", name: "青木" }], work, lines, rounding: "round" });

  it("数量と単価の両方が違うときは 2 つに分け、足すと差の全体になる（端数も含めて）", () => {
    // 当社 101.5 個 × 190 = 19,285、通知 97 個 × 185.5 = 17,993.5 → 通知の金額 17,994
    const r = compareNotice(base([line({ rawProject: "宅配", projectId: "p1", qty: 97, unitPrice: 185.5, amount: 17994 })], [{ projectId: "p1", driverId: "d1", qty: 101.5 }]));
    expect(r.items.map((i) => [i.kind, i.ourQty, i.theirQty, i.ourPrice, i.theirPrice, i.ourAmount, i.theirAmount, i.diff, i.split])).toEqual([
      ["qty", 101.5, 97, 190, 190, 19285, 18430, -855, true],
      ["price", 97, 97, 190, 185.5, 18430, 17994, -436, true],
    ]);
    expect(r.items.reduce((a, i) => a + i.diff, 0)).toBe(17994 - 19285);
    expect(r.ourTotal - r.theirTotal).toBe(19285 - 17994);
  });

  it("通知に無い（missing）・金額だけの行（amount）・当社に無い行（extra）・料金の記録があるのに通知に無い", () => {
    const r = compareNotice(
      base(
        [
          line({ rawProject: "夜間", projectId: "p2", amount: 235000 }),
          line({ rawProject: "高速代", role: "unknown", amount: 2400 }),
          line({ rawProject: "高速代", role: "unknown", amount: 1600 }),
          line({ rawProject: "協力会費", role: "ignore", amount: -1000 }),
          line({ rawProject: "スポット", projectId: "p4", qty: 1, unitPrice: 9000, amount: 9000 }),
        ],
        [
          { projectId: "p1", driverId: "d1", qty: 100 },
          { projectId: "p2", driverId: "d1", qty: 20 },
          { projectId: "p3", driverId: "d1", qty: 4 },
          { projectId: "p4", driverId: "d1", qty: 1 },
        ],
      ),
    );
    const got = r.items.map((i) => [i.kind, i.label, i.diff]);
    expect(got).toHaveLength(4);
    expect(got).toEqual(
      expect.arrayContaining([
        ["missing", "宅配（個建て）", -19000],
        ["missing", "待機料", -6000],
        ["amount", "夜間便", -5000],
        ["extra", "高速代", 4000],
      ]),
    );
    // 当社に無い行は最後に並べる
    expect(got.at(-1)).toEqual(["extra", "高速代", 4000]);
    // 別の元請の案件（スポット便）でも、通知の行が当たれば突き合わせる（一致なので差は無い）
    expect(r.projects.find((p) => p.projectId === "p4")).toMatchObject({ diff: 0, lineCount: 1 });
    expect(r.chargeWarnings).toEqual([{ projectId: "p3", name: "待機料", unit: "時間", qty: 4, amount: 6000 }]);
    expect(r).toMatchObject({ ignoredTotal: -1000, unknownLines: 2, drivers: null });
    expect(sumDiffs(r.items)).toEqual({ short: 30000, shortCount: 3, over: 4000, overCount: 1, net: -26000 });
  });

  it("同じ案件に単価の違う行が混ざる（月の途中で単価が変わった）と、平均の単価で比べる", () => {
    const r = compareNotice(
      base(
        [line({ rawProject: "宅配", projectId: "p1", qty: 50, unitPrice: 190, amount: 9500 }), line({ rawProject: "宅配", projectId: "p1", qty: 50, unitPrice: 180, amount: 9000 })],
        [{ projectId: "p1", driverId: "d1", qty: 100 }],
      ),
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ kind: "price", theirPrice: 185, mixedPrices: true, diff: -500 });
  });

  it("数量も単価も同じで、端数の扱いだけで 1〜2 円違うときは差に数えない（元請に 1 円を問い合わせない）", () => {
    const hours = [{ id: "p5", name: "ルート配送（時給）", clientId: "c1", unit: "時間", billRate: 2601 }];
    // 当社 7.5 時間 × 2,601円 = 19,507.5 → 19,508円。通知は 3.75 時間 × 2 行、行ごとに切り捨て 9,753円 × 2 = 19,506円
    const r = compareNotice({
      ...base(
        [
          line({ rawProject: "ルート", projectId: "p5", qty: 3.75, unitPrice: 2601, amount: 9753 }),
          line({ rawProject: "ルート", projectId: "p5", qty: 3.75, unitPrice: 2601, amount: 9753 }),
        ],
        [{ projectId: "p5", driverId: "d1", qty: 7.5 }],
      ),
      projects: hours,
    });
    expect(r.items).toEqual([]);
    expect(r.projects[0]).toMatchObject({ ourAmount: 19508, theirAmount: 19506, diff: -2, roundingOnly: true });
    // 数量と単価が同じでも、金額が大きく違えば「金額の違い」として出す
    const big = compareNotice({ ...base([line({ rawProject: "ルート", projectId: "p5", qty: 7.5, unitPrice: 2601, amount: 19000 })], [{ projectId: "p5", driverId: "d1", qty: 7.5 }]), projects: hours });
    expect(big.items.map((i) => [i.kind, i.diff])).toEqual([["amount", -508]]);
    expect(big.projects[0].roundingOnly).toBe(false);
  });

  it("受注単価が 0 円の案件は知らせる（当社の記録が 0 円になり、差が正しく出ないため）", () => {
    const r = compareNotice({
      ...base([line({ rawProject: "宅配", projectId: "p1", qty: 100, unitPrice: 190, amount: 19000 })], [{ projectId: "p1", driverId: "d1", qty: 100 }]),
      projects: [{ id: "p1", name: "宅配（個建て）", clientId: "c1", unit: "個", billRate: 0 }],
    });
    expect(r.zeroRateProjects).toEqual([{ projectId: "p1", name: "宅配（個建て）" }]);
    expect(compareNotice(base([], [{ projectId: "p1", driverId: "d1", qty: 1 }])).zeroRateProjects).toEqual([]);
  });

  it("返事待ちの日数：問い合わせ済みのときだけ数える", () => {
    const now = new Date("2026-11-20T09:00:00+09:00");
    expect(waitingDays("asked", new Date("2026-11-05T10:00:00+09:00"), now)).toBe(14);
    expect(waitingDays("asked", new Date("2026-11-19T10:00:00+09:00"), now)).toBe(0);
    expect(waitingDays("open", new Date("2026-11-01T10:00:00+09:00"), now)).toBeNull();
    expect(waitingDays("asked", null, now)).toBeNull();
  });

  it("名前をまとめる鍵は括弧の中を残す", () => {
    expect(lineKey("宅配（再配達）")).not.toBe(lineKey("宅配"));
    expect(lineKey(" ﾀｸﾊｲ ")).toBe(lineKey("タクハイ"));
    expect(isChargeName("燃料サーチャージ")).toBe(true);
    expect(isChargeName("企業配")).toBe(false);
    expect(formulaText(4950, 190, 940500, "個")).toBe("4,950個 × 190円 = 940,500円");
  });
});

describe("問い合わせ文", () => {
  const item = (over: Partial<LetterItem>): LetterItem => ({
    id: "x",
    kind: "qty",
    label: "宅配（個建て）",
    unit: "個",
    ourQty: 4950,
    theirQty: 4520,
    ourPrice: 190,
    theirPrice: 190,
    ourAmount: 940500,
    theirAmount: 858800,
    diff: -81700,
    split: false,
    ...over,
  });
  const all: LetterItem[] = [
    item({}),
    item({ kind: "price", label: "夜間便", unit: "便", ourQty: 20, theirQty: 20, ourPrice: 12000, theirPrice: 11500, ourAmount: 240000, theirAmount: 230000, diff: -10000 }),
    item({ kind: "missing", label: "スポット便", unit: "件", ourQty: 4, theirQty: null, ourPrice: 9000, theirPrice: null, ourAmount: 36000, theirAmount: 0, diff: -36000 }),
    item({ kind: "amount", label: "企業配（日当）", unit: "日", ourQty: 61, theirQty: null, ourPrice: 22000, theirPrice: null, ourAmount: 1342000, theirAmount: 1341000, diff: -1000 }),
    item({ kind: "extra", label: "待機料", unit: null, ourQty: null, theirQty: 3, ourPrice: null, theirPrice: 1000, ourAmount: 0, theirAmount: 3000, diff: 3000 }),
    item({ kind: "qty", label: "ルート配送", unit: "時間", split: true, ourQty: 170, theirQty: 168, ourPrice: 2600, theirPrice: 2600, ourAmount: 442000, theirAmount: 436800, diff: -5200 }),
    item({ kind: "price", label: "ルート配送", unit: "時間", split: true, ourQty: 168, theirQty: 168, ourPrice: 2600, theirPrice: 2500, ourAmount: 436800, theirAmount: 420000, diff: -16800 }),
  ];

  it("1 件ずつ、当社の記録とお支払通知の数字を並べ、確かめてもらうお願いだけを書く", () => {
    const { subject, body } = buildLetter({ clientName: "A物流（架空）", contactName: "", companyName: "サンプル運送株式会社（架空）", senderName: "デモ 事務", month: "2026-10-01", items: all, offerRecords: true });
    expect(subject).toBe("2026年10月分 お支払通知書の内容のご確認のお願い（サンプル運送株式会社（架空））");
    expect(body.startsWith("A物流（架空）\nご担当者様\n")).toBe(true);
    expect(body).toContain("1. 宅配（個建て）の数量\n   当社の記録では 宅配（個建て） 4,950個 × 190円 = 940,500円、お支払通知では 4,520個 = 858,800円（差 81,700円）となっております。");
    expect(body).toContain("お支払通知では 20便 × 11,500円 = 230,000円（差 10,000円）");
    expect(body).toContain("当社の記録では スポット便 4件 × 9,000円 = 36,000円 ですが、お支払通知に該当する行が見当たりませんでした。");
    expect(body).toContain("お支払通知では 1,341,000円（差 1,000円）");
    expect(body).toContain("お支払通知に「待機料」（3 × 1,000円 = 3,000円）の行がございますが");
    expect(body).toContain("ルート配送の数量（単価の違いとは分けて計算しています）");
    expect(body).toContain("当社の単価は 2,600円、お支払通知の単価は 2,500円 です。お支払通知の数量 168時間 で計算すると 436,800円 と 420,000円 になります（差 16,800円）。");
    // 合わせた差：−81,700 −10,000 −36,000 −1,000 ＋3,000 −5,200 −16,800 ＝ −147,700
    expect(body).toContain("お支払通知の金額は当社の記録に比べて 147,700円 少ない金額となっております。");
    expect(body).toContain("日ごとの稼働の記録（ドライバー別）が必要でしたら");
    expect(body.trimEnd().endsWith("サンプル運送株式会社（架空）\nデモ 事務")).toBe(true);
    // 責める言い方・法律の話をしない
    expect(body).not.toMatch(/違反|違法|法律|法令|取適法|下請法|フリーランス法|未払|不払|支払え|請求します|法的/);
  });

  it("差が無ければ、その旨だけを書く。mailto は件名と本文を入れる", () => {
    const { subject, body } = buildLetter({ clientName: "B商事", contactName: "経理部 山田様", companyName: "サンプル運送", senderName: "", month: "2026-10-01", items: [], offerRecords: false });
    expect(body).toContain("確認をお願いしたい点はございませんでした");
    expect(body).toContain("経理部 山田様");
    const href = mailtoHref("tanto@example.com", subject, body);
    expect(href.startsWith("mailto:tanto@example.com?subject=")).toBe(true);
    expect(decodeURIComponent(href.split("&body=")[1])).toContain("\r\n");
  });
});

describe("受け取る側の事実", () => {
  it("手数料が差し引かれた・入金が月末から 60 日を超えた（60 日ちょうどは出さない）", () => {
    expect(daysAfter("2026-10-31", "2026-12-30")).toBe(60);
    expect(receivingFacts({ month: "2026-10-01", paidOn: "2026-12-30", feeDeducted: 0 })).toEqual([]);
    const facts = receivingFacts({ month: "2026-10-01", paidOn: "2026-12-31", feeDeducted: 440 });
    expect(facts.map((f) => f.code)).toEqual(["fee_deducted", "paid_after_60_days"]);
    expect(facts[1].detail).toContain("61日後");
    for (const f of facts) {
      expect(f.sources.every((s) => s.url.startsWith("https://www.jftc.go.jp/"))).toBe(true);
      expect(`${f.title}${f.detail}${f.note}`).not.toMatch(/違反です|違反はありません|適法です|問題ありません|支払遅延です/);
    }
  });
});

describe("言ってはいけないこと（突合の画面・文面のすべて）", () => {
  it("決めつけ・保証・法令の結論を書いていない", () => {
    const root = path.join(__dirname, "..");
    const dirs = ["server/features/reconcile", "app/(app)/reconcile", "app/api/reconcile", "components/reconcile"];
    const files = [path.join(root, "server/features/reconcile.ts")];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    dirs.forEach((d) => walk(path.join(root, d)));
    expect(files.length).toBeGreaterThan(5);
    const banned = ["適法です", "違反はありません", "問題ありません", "法令に完全対応", "監査は大丈夫", "調査は大丈夫", "必ず合う", "ミスゼロ", "完全自動", "補助金", "未払いです", "偽装請負", "労働者に当たり"];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      for (const b of banned) expect(text.includes(b), `${path.relative(root, f)} に「${b}」`).toBe(false);
      // 出典の URL は確かめたものだけ
      for (const url of text.match(/https?:\/\/[^\s"'`)）]+/g) ?? []) {
        expect(
          [
            "https://www.jftc.go.jp/toriteki/toritekigaiyo/gaiyo.html",
            "https://www.jftc.go.jp/file/toriteki_leaflet.pdf",
            "https://www.jftc.go.jp/dk/guideline/tokuteiunsou.html",
          ].includes(url),
          `${path.relative(root, f)} の ${url}`,
        ).toBe(true);
      }
    }
  });
});

describe("ブラウザで動く部品が、サーバーの重いモジュールを読み込まない", () => {
  it("\"use client\" の部品と、そこから読む純関数のモジュールは Excel・DB・ファイルを読み込まない", () => {
    const root = path.join(__dirname, "..");
    const importsOf = (file: string) =>
      [...fs.readFileSync(file, "utf8").matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)].filter((m) => !m[1]).map((m) => m[2]);
    const resolve = (spec: string, from: string): string | null => {
      const base = spec.startsWith("~/") ? path.join(root, spec.slice(2)) : spec.startsWith("./") ? path.join(path.dirname(from), spec) : null;
      if (!base) return null;
      for (const ext of [".ts", ".tsx"]) if (fs.existsSync(base + ext)) return base + ext;
      return null;
    };
    const banned = /^(exceljs|iconv-lite|drizzle-orm|@electric-sql|postgres|node:|fs$|path$|server-only)|~\/db\/|~\/server\/(tabular|repo|audit|auth|features\/reconcile$)/;
    const clientFiles = fs
      .readdirSync(path.join(root, "components/reconcile"))
      .map((f) => path.join(root, "components/reconcile", f))
      .filter((f) => fs.readFileSync(f, "utf8").startsWith('"use client"'));
    expect(clientFiles.length).toBeGreaterThanOrEqual(3);
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const spec of importsOf(file)) {
        // Server Action は参照だけがブラウザへ送られる
        if (spec.endsWith("/reconcile/actions")) continue;
        expect(banned.test(spec), `${path.relative(root, file)} が ${spec} を読み込んでいる`).toBe(false);
        const next = resolve(spec, file);
        if (next && !next.includes(`${path.sep}components${path.sep}page`)) visit(next);
      }
    };
    clientFiles.forEach(visit);
  });
});
