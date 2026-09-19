/**
 * 文章を作る（取引先向けの月次報告・ドライバーへのお知らせ・入金のお願い など）。
 * 会社名・月・金額はデータパックから埋め、分からないもの（担当者名など）は 〇〇 のままにする。
 */
import "server-only";
import { AI_MAX_TOKENS } from "./config";
import { callClaude } from "./insights";
import { yen } from "@/lib/format";
import { DRAFT_KIND_LABELS, type DraftKind, type DraftParams } from "@/lib/schemas/ai";
import type { AiContext } from "./context";

const COMMON_RULES = [
  "あなたは軽貨物運送会社の事務担当として、そのまま送れる日本語のビジネス文書を書きます。",
  "渡された JSON の数値だけを根拠にし、JSON に無い事実（担当者名・住所・電話番号・日付の約束など）は作らず 〇〇 のままにします。",
  "金額は ¥1,234,567 の形式、率は小数 1 桁 % で書きます。",
  "出力は本文だけ。前置き・後書き・コードフェンス・「以下が文面です」のような説明は付けません。",
  "誇張や断定を避け、相手に失礼のない丁寧な言い回しにします。",
].join("\n");

const KIND_RULES: Record<DraftKind, string> = {
  monthly_report: [
    "取引先へ送る月次報告のメール文を書きます。",
    "件名（「件名：」で始める 1 行）・宛名・あいさつ・当月の稼働実績（件数・売上などデータにある数値）・次月へ向けた一言・結びの順に書きます。",
    "利益・原価・ドライバーへの支払額など社内の数字は書きません。",
    "全体で 400 文字程度にまとめます。",
  ].join("\n"),
  driver_notice: [
    "業務委託ドライバー全員へ送るお知らせ文を書きます。",
    "あいさつ・お知らせの内容・お願いしたいこと・問い合わせ先（〇〇）の順に、箇条書きを交えて読みやすく書きます。",
    "委託先の個人事業主が相手なので、指揮命令のような表現（命令・指示・強制）は避け、依頼の形にします。",
    "全体で 300 文字程度にまとめます。",
  ].join("\n"),
  payment_reminder: [
    "未入金の請求書について、取引先へ入金をお願いするメール文を書きます。",
    "件名（「件名：」で始める 1 行）・宛名・あいさつ・対象の請求書（請求番号・対象月・金額・支払期日）・入金のお願い・行き違いのお詫びの一文・結びの順に書きます。",
    "催促が強くなりすぎないよう、あくまで確認のお願いとして書きます。",
    "対象の請求書が JSON に無い場合は、その旨を 1 文で書いてから汎用の文面にします。",
  ].join("\n"),
  statement_notice: [
    "支払明細を公開したことをドライバーへ伝える連絡文を書きます。",
    "あいさつ・対象月の明細を確認できること・確認方法（ドライバーポータル）・振込予定日は明細に記載があること・問い合わせ先（〇〇）の順に書きます。",
    "個々のドライバーの金額は書かず、全員に同じ文面で送れる内容にします。",
    "全体で 250 文字程度にまとめます。",
  ].join("\n"),
  recruit: [
    "軽貨物ドライバーの募集文（求人サイト・SNS 向け）を書きます。",
    "冒頭のキャッチコピー・仕事の内容・募集の条件（〇〇 のままでよい）・応募方法（〇〇）の順に、箇条書きを交えて書きます。",
    "報酬は JSON にある数値から分かる範囲だけを書き、分からない場合は 〇〇 とします。「必ず稼げる」などの断定的な表現は使いません。",
    "全体で 400 文字程度にまとめます。",
  ].join("\n"),
};

/** 文章の調子 */
const TONE_RULES: Record<DraftParams["tone"], string> = {
  polite: "文体は「です・ます」調のかしこまったビジネス文書にします。",
  friendly: "文体は「です・ます」調のまま、やわらかく親しみやすい言い回しにします。",
};

/** 種類ごとのシステムプロンプト */
export function buildDraftSystemPrompt(kind: DraftKind, params: DraftParams): string {
  return [COMMON_RULES, "", KIND_RULES[kind], TONE_RULES[params.tone]].join("\n");
}

/** 文章づくりに渡す数値（種類ごとに必要な分だけ抜き出して小さくする） */
export function buildDraftFacts(kind: DraftKind, ctx: AiContext): Record<string, unknown> {
  const base = {
    会社名: ctx.company.name,
    対象月: ctx.month_label,
    稼働件数: ctx.current.entry_count,
    稼働したドライバー数: ctx.drivers.filter((d) => d.entry_count > 0).length,
  };
  switch (kind) {
    case "monthly_report":
      return {
        ...base,
        売上: yen(ctx.current.bill),
        案件: ctx.projects.map((p) => ({ 案件: p.project, 取引先: p.client, 件数: p.entry_count, 数量: p.qty_total, 売上: yen(p.bill) })),
      };
    case "payment_reminder":
      return {
        ...base,
        未入金の請求書: ctx.invoices.map((i) => ({ 請求番号: i.invoice_no, 取引先: i.client, 対象月: i.month, 金額: yen(i.total), 支払期日: i.due_date ?? "〇〇" })),
      };
    case "statement_notice":
      return { ...base, 消費税率: `${(ctx.company.tax_rate * 100).toFixed(1)}%` };
    case "recruit":
      return {
        ...base,
        案件: ctx.projects.map((p) => ({ 案件: p.project, 件数: p.entry_count })),
        ドライバー数: ctx.drivers.length,
      };
    case "driver_notice":
    default:
      return base;
  }
}

export interface DraftResult {
  model: string;
  text: string;
}

/** 文章を作る（API キーの有無は呼び出し元で確認済みであること） */
export async function requestDraft(kind: DraftKind, params: DraftParams, ctx: AiContext): Promise<DraftResult> {
  const facts = buildDraftFacts(kind, ctx);
  const user = [
    `${DRAFT_KIND_LABELS[kind]}の文面を作ってください。`,
    params.to ? `宛名は「${params.to}」です。` : "宛名は分からないので 〇〇 のままにしてください。",
    params.note ? `伝えたいこと：${params.note}` : "",
    "",
    "# 使ってよい数値（JSON）",
    JSON.stringify(facts),
  ]
    .filter(Boolean)
    .join("\n");

  const { model, text } = await callClaude({
    system: buildDraftSystemPrompt(kind, params),
    messages: [{ role: "user", content: user }],
    maxTokens: AI_MAX_TOKENS.draft,
    emptyMessage: "AI から文章が返りませんでした。もう一度お試しください。",
  });
  return { model, text };
}
