/**
 * LINE に送られてきた文から「何を聞かれたか」を判定し、答えの文面を組み立てる（純関数）。
 *
 * アプリを開かずに LINE で数字を聞けるようにするためのもの。
 * **判定も文面もここだけ**にまとめ、DB の読み取りと権限の確認は lib/line/answer.ts が行う。
 * AI（ANTHROPIC_API_KEY）が無くても、ここの数字だけで成立する。
 */
import { normalizeText } from "@/lib/text";
import { yen, pct } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";

export type LineIntent = "summary" | "cash" | "approvals" | "alerts" | "payout" | "entries" | "help" | "unknown";

/**
 * 判定に使う言葉。**漢字とかなの両方**を並べる
 * （normalizeText は全角・カタカナ・長音は揃えるが、漢字をかなには直さないため）。
 * 比べるときは両側を正規化するので、ここは普通の書き方で並べてよい。
 */
const INTENT_WORDS: { intent: LineIntent; words: string[] }[] = [
  { intent: "help", words: ["ヘルプ", "help", "使い方", "つかいかた", "何ができる", "なにができる", "できること", "メニュー"] },
  { intent: "cash", words: ["資金", "しきん", "現金", "げんきん", "残高", "ざんだか", "キャッシュ", "お金", "入金"] },
  { intent: "approvals", words: ["決裁", "けっさい", "承認", "しょうにん", "申請", "しんせい", "稟議", "りんぎ"] },
  { intent: "alerts", words: ["アラート", "気になる", "異常", "いじょう", "警告", "問題"] },
  { intent: "payout", words: ["支払", "しはらい", "振込", "ふりこみ", "払い", "はらい"] },
  { intent: "entries", words: ["稼働", "かどう", "入力", "にゅうりょく", "日報", "にっぽう", "点呼", "てんこ"] },
  { intent: "summary", words: ["売上", "うりあげ", "利益", "りえき", "着地", "ちゃくち", "見込", "みこみ", "今月", "こんげつ", "先月", "数字", "すうじ", "調子", "ちょうし", "どう", "経営", "目標", "もくひょう"] },
];

/** 正規化した言葉の表（毎回 normalize しないように 1 度だけ作る） */
const NORMALIZED_WORDS = INTENT_WORDS.map(({ intent, words }) => ({ intent, words: words.map(normalizeText).filter(Boolean) }));

/** これだけを送ってきたら「使い方」とみなす（ふつうの質問の末尾の ？ と区別する） */
const HELP_ONLY = new Set(["?", "？", "help", "へるぷ"].map(normalizeText));

/** 何を聞かれたかを判定する */
export function detectLineIntent(text: string): LineIntent {
  const t = normalizeText(text);
  if (!t) return "unknown";
  if (HELP_ONLY.has(t)) return "help";
  for (const { intent, words } of NORMALIZED_WORDS) {
    if (words.some((w) => t.includes(w))) return intent;
  }
  return "unknown";
}

/** 今月の着地（売上・営業利益・目標比） */
export interface SummaryNumbers {
  month: string;
  bill: number;
  operatingProfit: number;
  billForecast: number;
  operatingProfitForecast: number;
  profitTarget: number;
  /** 見込みベースの達成率（目標が未設定なら null） */
  profitTargetRate: number | null;
  isClosed: boolean;
  entryCount: number;
}

export function summaryText(s: SummaryNumbers): string {
  const label = formatMonthJa(s.month);
  if (s.entryCount === 0) {
    return `${label}はまだ稼働が入っていません。`;
  }
  const lines = [`${label}（${s.isClosed ? "締め済み" : "今の時点"}）`, `売上 ${yen(s.bill)} / 営業利益 ${yen(s.operatingProfit)}`];
  if (!s.isClosed) {
    lines.push(`このままいくと 売上 ${yen(s.billForecast)} / 営業利益 ${yen(s.operatingProfitForecast)} の見込みです。`);
  }
  if (s.profitTarget > 0 && s.profitTargetRate != null) {
    const diff = s.operatingProfitForecast - s.profitTarget;
    lines.push(
      diff >= 0
        ? `営業利益の目標 ${yen(s.profitTarget)} に対して ${pct(s.profitTargetRate)}。${yen(diff)} 上回る見込みです。`
        : `営業利益の目標 ${yen(s.profitTarget)} に対して ${pct(s.profitTargetRate)}。${yen(-diff)} 足りません。`,
    );
  }
  return lines.join("\n");
}

/** 現金の見通し */
export interface CashNumbers {
  balance: number;
  minBalance: number;
  minBalanceOn: string;
  zeroOn: string | null;
  holdDays: number;
  shortfall: number;
  status: "safe" | "watch" | "danger";
}

export function cashText(c: CashNumbers): string {
  const head = `今の残高は ${yen(c.balance)} です。`;
  if (c.zeroOn) {
    return `${head}\nこのままだと ${dateText(c.zeroOn)} に ${yen(c.shortfall)} 足りなくなる見込みです（あと ${c.holdDays} 日）。`;
  }
  const tone = c.status === "safe" ? "余裕があります" : "余裕は多くありません";
  return `${head}\nいちばん少なくなるのは ${dateText(c.minBalanceOn)} の ${yen(c.minBalance)}（あと ${c.holdDays} 日ぶん）。${tone}。`;
}

/** 決裁待ち */
export interface ApprovalNumbers {
  pending: number;
  overdue: number;
  oldestDays: number | null;
  titles: string[];
}

export function approvalsText(a: ApprovalNumbers): string {
  if (a.pending === 0) return "決裁待ちはありません。";
  const lines = [`決裁待ちが ${a.pending} 件です${a.overdue > 0 ? `（うち ${a.overdue} 件は期限切れ）` : ""}。`];
  if (a.oldestDays != null && a.oldestDays > 0) lines.push(`いちばん古いものは ${a.oldestDays} 日前の申請です。`);
  for (const t of a.titles.slice(0, 3)) lines.push(`・${t}`);
  return lines.join("\n");
}

/** 気になること */
export function alertsText(items: { title: string; severity: string }[], openTotal: number): string {
  if (openTotal === 0) return "いまは気になることはありません。";
  const lines = [`未対応が ${openTotal} 件あります。`];
  for (const a of items.slice(0, 3)) lines.push(`・${a.severity === "high" ? "【重要】" : ""}${a.title}`);
  if (openTotal > 3) lines.push(`ほか ${openTotal - 3} 件。`);
  return lines.join("\n");
}

/** ドライバーへの支払 */
export interface PayoutNumbers {
  month: string;
  total: number;
  driverCount: number;
  payoutDate: string | null;
  isClosed: boolean;
}

export function payoutText(p: PayoutNumbers): string {
  if (p.driverCount === 0) return `${formatMonthJa(p.month)}の支払はまだありません。`;
  const lines = [`${formatMonthJa(p.month)}のドライバーへの支払は ${p.driverCount} 名・${yen(p.total)}（税込）です。`];
  if (p.payoutDate) lines.push(`振込予定日は ${dateText(p.payoutDate)} です。`);
  if (!p.isClosed) lines.push("まだ締めていないので、締めると確定します。");
  return lines.join("\n");
}

/** 稼働の入力状況 */
export interface EntryNumbers {
  month: string;
  entryCount: number;
  zeroQtyCount: number;
  pendingDayEntries: number;
  missingReports: number;
}

export function entriesText(e: EntryNumbers): string {
  const label = formatMonthJa(e.month);
  const lines = [`${label}の稼働は ${e.entryCount} 行です。`];
  if (e.zeroQtyCount > 0) lines.push(`数量が 0 の行が ${e.zeroQtyCount} 件あります。`);
  if (e.pendingDayEntries > 0) lines.push(`承認待ちの日別の稼働が ${e.pendingDayEntries} 件あります。`);
  if (e.missingReports > 0) lines.push(`点呼の記録が無い日が ${e.missingReports} 日あります。`);
  if (lines.length === 1) lines.push("入力漏れは見当たりません。");
  return lines.join("\n");
}

/** できることの案内（ロールによって出す項目を変える） */
export function helpText(opts: { canSeeCash: boolean; isOwner: boolean }): string {
  const lines = ["LINE でそのまま聞けます。", "", "・「今月どう？」… 売上と営業利益の着地", "・「支払は？」… ドライバーへの支払と振込予定日", "・「稼働は？」… 入力漏れ・承認待ち", "・「気になることある？」… 未対応のお知らせ"];
  if (opts.canSeeCash) lines.push("・「資金繰りは？」… 残高と、いつ足りなくなるか");
  if (opts.isOwner) lines.push("・「決裁は？」… 決裁待ちの件数と中身");
  return lines.join("\n");
}

/** 権限が足りないとき */
export function notAllowedText(what: string): string {
  return `${what}は代表（または管理者）だけが見られる設定になっています。`;
}

/** 連携していない人から届いたとき */
export function notLinkedText(): string {
  return "このアカウントはまだ連携されていません。アプリの「設定 → 外部連携」で合言葉を作って、その 8 桁をこのトークに送ってください。";
}

/** "YYYY-MM-DD" → "9月20日" */
function dateText(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[2])}月${Number(m[3])}日`;
}
