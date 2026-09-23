import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "~/db/schema";
import {
  createDrivers,
  createProjects,
  createRules,
  finishOnboarding,
  loadCompanyForm,
  loadOnboarding,
  previewDriverFile,
  previewDriverPaste,
  reopenOnboarding,
  saveCompanyBasics,
  setOnboardingStep,
} from "~/server/features/onboarding";
import { checkCompanyBasics, deadlineHint, payRuleText } from "~/server/features/onboarding/company";
import { fieldOfHeader, parseDriverRows, rowsFromPaste } from "~/server/features/onboarding/drivers-parse";
import { normalizeRegistrationNo } from "~/server/features/onboarding/normalize";
import { parseProjectRows, projectRowsFromPaste } from "~/server/features/onboarding/projects-parse";
import { checkRule } from "~/server/features/onboarding/rules";
import { onboardingProgress } from "~/server/features/onboarding/steps";
import { seedDemo } from "~/server/seed-demo";
import { createTestDb } from "./helpers/db";

const T = "\t";
const line = (...cells: string[]) => cells.join(T);

describe("ドライバーの名簿を読む（純関数）", () => {
  it("見出しの言葉から列を当てる（「口座番号」は「番号」より強い）", () => {
    expect(fieldOfHeader("氏名")).toBe("name");
    expect(fieldOfHeader("フリガナ")).toBe("kana");
    expect(fieldOfHeader("氏名（カナ）")).toBe("kana");
    expect(fieldOfHeader("ドライバー番号")).toBe("code");
    expect(fieldOfHeader("口座番号")).toBe("accountNumber");
    expect(fieldOfHeader("口座名義（カナ）")).toBe("holderKana");
    expect(fieldOfHeader("インボイス登録番号")).toBe("registrationNo");
    expect(fieldOfHeader("金融機関コード")).toBe("bankCode");
    expect(fieldOfHeader("店番")).toBe("branchCode");
    expect(fieldOfHeader("電話番号")).toBe("phone");
    expect(fieldOfHeader("備考")).toBeNull();
    // 「No.」だけの列は行の通し番号（1・2・3）なので、照合に使う番号とは見ない
    expect(fieldOfHeader("No.")).toBeNull();
    expect(fieldOfHeader("ドライバーNo")).toBe("code");
    expect(fieldOfHeader("社員番号")).toBe("code");
  });

  it("表の上の題（「ドライバー名簿」）を見出しと取り違えない。通し番号の列は番号にしない", () => {
    const rows = rowsFromPaste(
      [
        "2026年10月 ドライバー名簿",
        "",
        line("No.", "氏名", "フリガナ", "口座番号"),
        line("1", "山田 太郎", "ヤマダ タロウ", ""),
        line("2", "佐藤 一郎", "サトウ イチロウ", ""),
      ].join("\n"),
    );
    const p = parseDriverRows(rows, [{ id: "a", name: "青木 翔太", code: "1", aliases: [] }]);
    expect(p.problem).toBeNull();
    expect(p.headerRow).toBe(3);
    expect(p.counts).toEqual({ new: 2, duplicate: 0, error: 0 });
    // 通し番号「1」は、番号「1」のすでにいる人と重ねない
    expect(p.rows.map((r) => [r.name, r.draft?.code])).toEqual([
      ["山田 太郎", null],
      ["佐藤 一郎", null],
    ]);
    // 氏名の 1 列だけの名簿は、その行を見出しにする
    const single = parseDriverRows(rowsFromPaste(["氏名", "木下 実", "小林 愛"].join("\n")), []);
    expect(single).toMatchObject({ headerRow: 1, counts: { new: 2, duplicate: 0, error: 0 } });
  });

  it("登録番号の形：T＋13 桁。全角・ハイフン・T なしも読む。桁が違えば直してもらう", () => {
    expect(normalizeRegistrationNo("Ｔ１２３４５６７８９０１２３")).toEqual({ value: "T1234567890123", error: null });
    expect(normalizeRegistrationNo("1234-5678-90123")).toEqual({ value: "T1234567890123", error: null });
    expect(normalizeRegistrationNo("t 1234567890123")).toEqual({ value: "T1234567890123", error: null });
    expect(normalizeRegistrationNo("なし")).toEqual({ value: null, error: null });
    expect(normalizeRegistrationNo("T123456789012").error).toContain("いまは数字が 12 桁です");
  });

  it("タブ区切り・全角の数字・先頭の 0 が落ちたコード・重なり・形の違いを 1 行ずつ見分ける", () => {
    const text = [
      line("番号", "氏名", "フリガナ", "インボイス登録番号", "銀行コード", "支店コード", "預金種目", "口座番号", "口座名義", "備考"),
      line("101", "山田　太郎", "やまだ たろう", "Ｔ１２３４５６７８９０１２３", "１", "１", "普通", "１２３４５６７", "ヤマダ タロウ", ""),
      line("102", "佐々木 花子", "ササキ ハナコ", "", "0005", "123", "当座", "7654321", "ササキ ハナコ", ""),
      line("103", "鈴木 一郎", "スズキ イチロウ", "T123456789012", "0001", "001", "普通", "1111111", "スズキ イチロウ", ""),
      line("104", "田中 次郎", "", "", "0001", "001", "普通", "12345678", "田中次郎", ""),
      line("105", "青木 翔太", "アオキ ショウタ", "T9876543210987", "", "", "", "", "", "すでにいる人"),
      line("106", "山田 太郎", "", "", "", "", "", "", "", "同じ表に 2 回"),
      line("D02", "井上 みさき", "", "", "", "", "", "", "", "番号がすでにいる人と同じ"),
      line("", "", "", "", "", "", "", "", "", ""),
      line("", "合計", "", "", "", "", "", "", "", ""),
    ].join("\n");
    const existing = [
      { id: "a", name: "青木 翔太", code: "D01", aliases: [] },
      { id: "b", name: "井上 美咲", code: "D02", aliases: [] },
    ];
    const p = parseDriverRows(rowsFromPaste(text), existing);
    expect(p.problem).toBeNull();
    expect(p.headerRow).toBe(1);
    expect(p.counts).toEqual({ new: 3, duplicate: 3, error: 1 });
    const [yamada, sasaki, suzuki, tanaka, aoki, yamada2, inoue] = p.rows;

    expect(yamada).toMatchObject({ rowNo: 2, status: "new" });
    expect(yamada.draft).toEqual({
      name: "山田 太郎",
      kana: "ヤマダ タロウ",
      code: "101",
      registrationNo: "T1234567890123",
      invoiceRegistered: true,
      bank: { bankCode: "0001", bankNameKana: null, branchCode: "001", branchNameKana: null, accountType: "ordinary", accountNumber: "1234567", holderKana: "ヤマダ タロウ" },
      email: null,
      phone: null,
      startedOn: null,
    });
    expect(yamada.warnings.join()).toContain("先頭の 0 を補いました");

    expect(sasaki.draft).toMatchObject({ invoiceRegistered: false, registrationNo: null, bank: { accountType: "checking" } });

    // 登録番号の桁が違う人は登録しない
    expect(suzuki.status).toBe("error");
    expect(suzuki.errors[0]).toContain("登録番号「T123456789012」の形が違います");

    // 口座の形が違う人は、口座を入れずに登録する（口座番号 8 桁・名義が漢字）
    expect(tanaka.status).toBe("new");
    expect(tanaka.draft?.bank).toBeNull();
    expect(tanaka.warnings[0]).toContain("口座は入れません");
    expect(tanaka.warnings[0]).toContain("口座番号は 7 桁までの数字です");
    expect(tanaka.warnings[0]).toContain("口座名義はカナで入れてください");

    expect(aoki).toMatchObject({ status: "duplicate", duplicateOf: "青木 翔太" });
    expect(yamada2.status).toBe("duplicate");
    expect(yamada2.warnings[0]).toContain("この表の中に");
    expect(inoue).toMatchObject({ status: "duplicate", duplicateOf: "井上 美咲" });
  });

  it("見出しが無ければ案内の順（氏名・フリガナ・番号・登録番号・銀行・支店・口座番号・名義）で読む", () => {
    const p = parseDriverRows(rowsFromPaste(line("木下 実", "キノシタ ミノル", "201", "", "0009", "303", "3456789", "キノシタ ミノル")), []);
    expect(p.headerRow).toBeNull();
    expect(p.counts.new).toBe(1);
    expect(p.rows[0].draft).toMatchObject({ name: "木下 実", code: "201", bank: { bankCode: "0009", branchCode: "303", accountNumber: "3456789" } });
    // 見出しはあるのに氏名の列が無い表
    expect(parseDriverRows([["フリガナ", "番号"], ["ヤマダ", "1"]], []).problem).toContain("氏名の列が見つかりません");
    expect(parseDriverRows([[""]], []).problem).toBe("読み込める行がありません。見出しの下に 1 人 1 行で入れてください");
  });
});

describe("最初の設定（DB）", () => {
  it("名簿の貼り付け → 登録。もう一度読み込んでも増えない。ほかの会社には入らない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const paste = [
      line("氏名", "フリガナ", "番号", "登録番号", "銀行コード", "支店コード", "口座番号", "口座名義"),
      line("山田 太郎", "ヤマダ タロウ", "101", "T1234567890123", "0001", "001", "1234567", "ヤマダ タロウ"),
      line("佐々木 花子", "ササキ ハナコ", "102", "", "", "", "", ""),
      line("青木 翔太", "", "D01", "", "", "", "", ""),
    ].join("\n");
    const preview = await previewDriverPaste(db, tenantId, paste);
    expect(preview.counts).toEqual({ new: 2, duplicate: 1, error: 0 });
    const drafts = preview.rows.filter((r) => r.status === "new").map((r) => r.draft);

    const res = await createDrivers(db, tenantId, drafts, null);
    expect(res).toEqual({ created: 2, skipped: [], rejected: [] });
    const [yamada] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.name, "山田 太郎")));
    expect(yamada).toMatchObject({ code: "101", invoiceRegistered: true, registrationNo: "T1234567890123", bankCode: "0001", branchCode: "001", accountNumber: "1234567", holderKana: "ヤマダ タロウ" });
    const [sasaki] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.name, "佐々木 花子")));
    expect(sasaki).toMatchObject({ invoiceRegistered: false, registrationNo: null, bankCode: null, accountNumber: null });

    // 同じものをもう一度：登録しない
    expect(await createDrivers(db, tenantId, drafts, null)).toEqual({ created: 0, skipped: ["山田 太郎", "佐々木 花子"], rejected: [] });
    // 画面の値を書き換えても、サーバーで確かめ直す（登録番号の形が違う・口座番号が長い）
    const tampered = await createDrivers(db, tenantId, [
      { name: "偽 登録", registrationNo: "T12" },
      { name: "長い 口座", bank: { bankCode: "0001", branchCode: "001", accountNumber: "123456789", holderKana: "ナガイ" } },
      "壊れた値",
    ], null);
    expect(tampered.created).toBe(1);
    expect(tampered.rejected).toHaveLength(2);
    expect(tampered.rejected[0]).toContain("偽 登録");
    const [long] = await db.select().from(s.drivers).where(and(eq(s.drivers.tenantId, tenantId), eq(s.drivers.name, "長い 口座")));
    expect(long.accountNumber).toBeNull();

    // ほかの会社：増えていない。同じ名前でも、その会社では新しい人として読む
    const others = await db.select().from(s.drivers).where(eq(s.drivers.tenantId, otherId));
    expect(others).toHaveLength(8);
    expect((await previewDriverPaste(db, otherId, paste)).counts).toEqual({ new: 2, duplicate: 1, error: 0 });

    const log = await db.select().from(s.auditLog).where(and(eq(s.auditLog.tenantId, tenantId), eq(s.auditLog.action, "driver.bulk_create")));
    expect(log.length).toBe(3);
    // 登録すると、案内の「ドライバー」は済み
    const t = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    expect(t[0].onboarding.drivers).toBe("done");
    await client.close();
  });

  it("CSV のファイルからも読める。PDF は読めないと伝える", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const csv = "氏名,フリガナ,番号\r\n小林 愛,コバヤシ アイ,301\r\n";
    const p = await previewDriverFile(db, tenantId, "名簿.csv", new TextEncoder().encode(csv));
    expect(p.counts.new).toBe(1);
    expect(p.rows[0].draft?.code).toBe("301");
    await expect(previewDriverFile(db, tenantId, "名簿.pdf", new Uint8Array([1, 2, 3]))).rejects.toThrow("PDF は読めません");
    // 書式だけの空の行が何千行あっても、人数の上限（500人）には数えない
    const padded = [line("氏名", "番号"), line("小林 愛", "301"), ...Array.from({ length: 3000 }, () => line("", ""))].join("\n");
    expect((await previewDriverPaste(db, tenantId, padded)).counts.new).toBe(1);
    const tooMany = [line("氏名", "番号"), ...Array.from({ length: 520 }, (_, i) => line(`人 ${i}`, `X${i}`))].join("\n");
    await expect(previewDriverPaste(db, tenantId, tooMany)).rejects.toThrow("500人まで");
    await client.close();
  });

  it("進み具合：印とデータから決まる。とばす・終える・また出す", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    // 新しい会社（何も入っていない）
    const [fresh] = await db.insert(s.tenants).values({ name: "はじめて運送（架空）" }).returning();
    let p = await loadOnboarding(db, fresh.id);
    expect(p).toMatchObject({ doneCount: 0, total: 6, complete: false, minutesLeft: 55 });
    expect(p.next?.key).toBe("company");

    await setOnboardingStep(db, fresh.id, "company", "skipped", null);
    p = await loadOnboarding(db, fresh.id);
    expect(p.steps[0].state).toBe("skipped");
    expect(p.next?.key).toBe("drivers");

    await finishOnboarding(db, fresh.id, null);
    p = await loadOnboarding(db, fresh.id);
    expect(p).toMatchObject({ complete: true, finished: true, next: null });
    await reopenOnboarding(db, fresh.id, null);
    p = await loadOnboarding(db, fresh.id);
    expect(p.complete).toBe(false);
    expect(p.steps.every((x) => x.state === "todo")).toBe(true);

    // 済みにすると次へ。まだに戻すと、また案内に出る
    await setOnboardingStep(db, fresh.id, "company", "done", null);
    expect((await loadOnboarding(db, fresh.id)).next?.key).toBe("drivers");
    await setOnboardingStep(db, fresh.id, "company", null, null);
    expect((await loadOnboarding(db, fresh.id)).next?.key).toBe("company");

    // デモの会社は変わらない
    const demo = await loadOnboarding(db, tenantId);
    expect(demo.doneCount).toBe(5);
    expect(demo.next?.key).toBe("parallel");
    await client.close();
  });

  it("純関数：データがあれば印が無くても済み。「あとで」でもデータがあれば済み", () => {
    const p = onboardingProgress({ drivers: "skipped" }, { drivers: 3, projects: 0, rules: 0, workEntries: 0, parallelChecks: 0 });
    expect(p.steps[1]).toMatchObject({ state: "auto", note: "登録済み 3人" });
    expect(p.doneCount).toBe(1);
  });

  it("会社の基本：tenants の列と settings の 2 つだけを書く（振込依頼人の設定は残す）", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const { value, fieldErrors } = checkCompanyBasics({
      closingDay: "20",
      payMonthOffset: "1",
      payDay: "0",
      transferFeeBearer: "company",
      registrationNo: "１２３４５６７８９０１２３",
      taxMethod: "simplified",
      paymentTermsText: "  毎月20日締め・翌月末日払い ",
    });
    expect(fieldErrors).toEqual({});
    await saveCompanyBasics(db, tenantId, value!, null);
    const [t] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    expect(t).toMatchObject({ closingDay: 20, payMonthOffset: 1, payDay: 0, registrationNo: "T1234567890123", taxMethod: "simplified" });
    expect(t.settings.transferFeeBearer).toBe("company");
    expect(t.settings.paymentTermsText).toBe("毎月20日締め・翌月末日払い");
    expect(t.settings.requester?.code).toBe("1234567890");
    expect(t.onboarding.company).toBe("done");
    const form = await loadCompanyForm(db, tenantId);
    expect(form.owners).toEqual(["デモ 社長"]);
    // ほかの会社は変わらない
    const [o] = await db.select().from(s.tenants).where(eq(s.tenants.id, otherId));
    expect(o).toMatchObject({ closingDay: 0, payDay: 25, registrationNo: "T1234567890123", taxMethod: "general" });
    expect(o.settings.transferFeeBearer).toBeUndefined();

    // 設定で「免税」にしている会社は、ここで保存しても免税のまま（原則課税に変わらない）
    await db.update(s.tenants).set({ taxMethod: "exempt" }).where(eq(s.tenants.id, otherId));
    expect((await loadCompanyForm(db, otherId)).taxMethod).toBe("exempt");
    const exempt = checkCompanyBasics({ closingDay: "0", payMonthOffset: "1", payDay: "25", transferFeeBearer: "company", registrationNo: "", taxMethod: "exempt", paymentTermsText: "" });
    expect(exempt.fieldErrors).toEqual({});
    await saveCompanyBasics(db, otherId, exempt.value!, null);
    const [o2] = await db.select().from(s.tenants).where(eq(s.tenants.id, otherId));
    expect(o2).toMatchObject({ taxMethod: "exempt", registrationNo: null });
    // 最初の会社は、ほかの会社の保存で変わらない
    const [t2] = await db.select().from(s.tenants).where(eq(s.tenants.id, tenantId));
    expect(t2).toMatchObject({ closingDay: 20, taxMethod: "simplified" });

    const bad = checkCompanyBasics({ closingDay: "20", payMonthOffset: "0", payDay: "10", transferFeeBearer: "", registrationNo: "T12", taxMethod: "x", paymentTermsText: "" });
    expect(Object.keys(bad.fieldErrors).sort()).toEqual(["payDay", "registrationNo", "taxMethod", "transferFeeBearer"]);
    expect(bad.fieldErrors.payDay).toContain("当月払い");
    await client.close();
  });

  it("支払日の目安：末日締め・翌月25日払いは 60 日の中、翌々月末日払いは超える月がある", () => {
    expect(payRuleText(0, 1, 25)).toBe("毎月末日締め・翌月25日払い");
    const ok = deadlineHint(0, 1, 25, "2026-09-23");
    expect(ok?.tone).toBe("ok");
    expect(ok?.text).toContain("60日・2か月の中に入ります");
    const ng = deadlineHint(0, 2, 0, "2026-09-23");
    expect(ng?.tone).toBe("ng");
    expect(ng?.text).toContain("フリーランス法 第4条");
    expect(ng?.text).toContain("おそれ");
  });

  it("元請と案件：元請は別名で当てる。同じ案件は登録しない。ほかの会社には入らない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const rows = projectRowsFromPaste(
      [
        line("元請名", "案件名", "単位", "受注単価", "支払単価"),
        line("Ａ物流", "チャーター便", "件", "25,000", "20000"),
        line("A物流（架空）", "宅配（個建て）", "個", "190", "150"),
        line("C運輸株式会社", "引越し応援", "日", "２０，０００", "16000"),
        line("C運輸", "引越し応援", "日", "20000", "16000"),
        line("", "倉庫内作業", "時間", "1800", "2000"),
        line("B商事", "", "件", "abc", ""),
      ].join("\n"),
    );
    expect(rows).toHaveLength(6);
    const clients = await db.select({ id: s.clients.id, name: s.clients.name, aliases: s.clients.aliases }).from(s.clients).where(eq(s.clients.tenantId, tenantId));
    const projects = await db.select({ id: s.projects.id, name: s.projects.name, clientId: s.projects.clientId, aliases: s.projects.aliases }).from(s.projects).where(eq(s.projects.tenantId, tenantId));
    const p = parseProjectRows(rows, clients, projects);
    expect(p.counts).toEqual({ new: 3, duplicate: 2, error: 1 });
    expect(p.newClients).toEqual(["C運輸株式会社"]);
    expect(p.rows[4].warnings.join()).toContain("支払単価が受注単価より高く");
    expect(p.rows[5].errors.join()).toContain("案件の名前を入れてください");

    const res = await createProjects(db, tenantId, rows, null);
    expect(res).toMatchObject({ clients: 1, projects: 3, skipped: 2 });
    const a = clients.find((c) => c.name === "A物流（架空）")!;
    const [charter] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "チャーター便")));
    expect(charter).toMatchObject({ clientId: a.id, unit: "件", billRate: 25000, payRate: 20000 });
    const [moving] = await db.select().from(s.projects).where(and(eq(s.projects.tenantId, tenantId), eq(s.projects.name, "引越し応援")));
    const [c] = await db.select().from(s.clients).where(and(eq(s.clients.tenantId, tenantId), eq(s.clients.name, "C運輸株式会社")));
    expect(moving.clientId).toBe(c.id);
    // もう一度送っても増えない
    await expect(createProjects(db, tenantId, rows, null)).rejects.toThrow();
    expect((await db.select().from(s.projects).where(eq(s.projects.tenantId, tenantId))).length).toBe(8);
    // ほかの会社は 5 件のまま
    expect((await db.select().from(s.projects).where(eq(s.projects.tenantId, otherId))).length).toBe(5);
    expect((await db.select().from(s.clients).where(eq(s.clients.tenantId, otherId))).length).toBe(2);
    await client.close();
  });

  it("控除のルール：印の無いものも登録できるが、分かるように返す。同じ名前は登録しない", async () => {
    const { db, client } = await createTestDb();
    const { tenantId } = await seedDemo(db);
    const { tenantId: otherId } = await seedDemo(db);
    const base = { taxable: true, onlyWhenWorked: true, agreedOn: "", basis: "" };
    expect(checkRule({ ...base, name: "ロイヤリティ", kind: "percent", value: "１０％", agreedInWriting: true }).draft).toMatchObject({ rate: 0.1, amount: null });
    const warn = checkRule({ ...base, name: "端末代", kind: "fixed", value: "3,000", agreedInWriting: false });
    expect(warn.draft).toMatchObject({ amount: 3000, agreedInWriting: false });
    expect(warn.warnings[0]).toContain("フリーランス法 第5条");
    expect(warn.warnings[0]).toContain("おそれ");
    expect(checkRule({ ...base, name: "x", kind: "fixed", value: "1.5", agreedInWriting: true }).errors[0]).toContain("1 円単位");
    expect(checkRule({ ...base, name: "x", kind: "percent", value: "120", agreedInWriting: true }).errors[0]).toContain("100%");

    const res = await createRules(
      db,
      tenantId,
      [
        { ...base, name: "管理費", kind: "fixed", value: "15000", agreedInWriting: true },
        { ...base, name: "端末代", kind: "fixed", value: "3000", agreedInWriting: false },
        { ...base, name: "1個あたりの手数料", kind: "per_unit", value: "5", agreedInWriting: true, agreedOn: "2026-04-01", basis: "業務委託契約 第9条" },
      ],
      null,
    );
    expect(res).toEqual({ created: 2, skipped: ["管理費"], notAgreed: ["端末代"] });
    const rules = await db.select().from(s.deductionRules).where(eq(s.deductionRules.tenantId, tenantId));
    expect(rules).toHaveLength(6);
    expect(rules.find((r) => r.name === "1個あたりの手数料")).toMatchObject({ kind: "per_unit", rate: 5, agreedOn: "2026-04-01", basis: "業務委託契約 第9条", driverId: null });
    await expect(createRules(db, tenantId, [{ ...base, name: "x", kind: "fixed", value: "0", agreedInWriting: true }], null)).rejects.toThrow("0 より大きい数");
    // ほかの会社の控除は 4 件のまま。ほかの会社では「管理費」も新しく登録できる（名前の重なりは会社ごとに見る）
    expect((await db.select().from(s.deductionRules).where(eq(s.deductionRules.tenantId, otherId))).length).toBe(4);
    const otherRes = await createRules(db, otherId, [{ ...base, name: "端末代", kind: "fixed", value: "3000", agreedInWriting: true }], null);
    expect(otherRes).toEqual({ created: 1, skipped: [], notAgreed: [] });
    await client.close();
  });
});
