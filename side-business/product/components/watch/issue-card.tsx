import Link from "next/link";
import { Card, Money, buttonClass } from "@/components/ui";
import { Badge } from "~/components/page";
import { AckForm, UnackForm } from "~/components/watch/ack-forms";
import { fixLink } from "~/server/features/watch/sources";
import type { WatchImpact, WatchIssueEx } from "~/server/features/watch/types";

export const SEVERITY_LABEL = { red: "赤", yellow: "黄", info: "お知らせ" } as const;
const SEVERITY_TONE = { red: "red", yellow: "yellow", info: "gray" } as const;
const CARD_BORDER = { red: "border-danger/60", yellow: "border-warning/50", info: "" } as const;

const jst = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 2026-09-01 → 2026年9月 */
function monthJa(month: string): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  return `${y}年${m}月`;
}

export type AckView = { note: string | null; byName: string | null; at: Date };

/** 影響額：「¥357,555（遠藤 大輔さんの2026年10月分の支払額）」。出せないものは「—」と理由 */
export function ImpactLine({ impact }: { impact?: WatchImpact | null }) {
  const label = impact?.label ?? "金額で出す指摘ではありません";
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-sm">
      <span className="text-xs font-bold text-muted-foreground">影響額</span>
      {impact && impact.yen !== null ? (
        <Money value={impact.yen} className="text-base font-bold" />
      ) : (
        <span className="font-bold" aria-label="金額なし">
          —
        </span>
      )}
      <span className="min-w-0 break-words text-xs text-muted-foreground">（{label}）</span>
    </p>
  );
}

/**
 * 見張り番の指摘 1 件：見出し・影響額・対象・記録から分かること・根拠と出典と時点・直す画面・確認済みの印。
 * 確認済みにする／外すのは事務・オーナーで、まだ締めていない月（振込の遅れ・質問は締めたあとも）。
 * 直す画面へのリンクは、直せない人（閲覧の人・会社の設定を変えられない事務・締めた月）には「見る」と出す。
 * 確認済みの指摘は消さずに、灰色の 1 行にたたむ（開くと中身とメモ。確認したあとで中身が変わったものはたたまない）。
 * 前の月に確認済みにした黄・お知らせも、翌月は灰色の 1 行にたたむ（開くと前の月のメモを下書きにして確認済みにできる）。
 */
export function IssueCard({
  issue,
  month,
  role,
  closed,
  canAck,
  ackMinLength,
  ack,
  changedSinceAck = false,
  previous,
}: {
  issue: WatchIssueEx;
  month: string;
  role: "owner" | "staff" | "viewer";
  closed: boolean;
  canAck: boolean;
  ackMinLength: number;
  ack?: AckView | null;
  /** 確認済みにしたあとで、中身（数字・日付・人）が変わったか */
  changedSinceAck?: boolean;
  previous?: { month: string; note: string | null; fromCode?: string } | null;
}) {
  const k = { month, code: issue.code, subjectId: issue.subjectId };
  const red = issue.severity === "red";
  const fix = issue.fixHref ? fixLink(issue.fixHref, { role, closed }) : null;
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[issue.severity]}>{SEVERITY_LABEL[issue.severity]}</Badge>
        {issue.acked && <Badge tone="green">確認済み</Badge>}
        {issue.subjectLabel && <span className="min-w-0 break-words text-sm text-muted-foreground">{issue.subjectLabel}</span>}
      </div>
      <h3 className={`mt-2 font-bold ${red && !issue.acked ? "text-danger" : ""}`}>{issue.title}</h3>
      <ImpactLine impact={issue.impact} />
      <p className="mt-1 break-words text-sm">{issue.detail}</p>

      {issue.basis ? (
        <p className="mt-2 text-xs text-muted-foreground">
          根拠：{issue.basis}
          {issue.asOf && <span className="ml-1">（{issue.asOf}時点の情報）</span>}
          {issue.sourceUrl && (
            <a href={issue.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex min-h-11 items-center align-middle sm:min-h-0">
              出典<span className="sr-only">（新しいタブで開きます）</span> ↗
            </a>
          )}
        </p>
      ) : (
        issue.asOf && <p className="mt-2 text-xs text-muted-foreground">記録の数字から見ています（{issue.asOf}時点のルール）</p>
      )}

      {issue.acked && (
        <div className="mt-3 rounded-lg border border-success/40 bg-success/10 p-3 text-sm">
          <p className="font-bold text-success">確認済み</p>
          <p className="mt-1 whitespace-pre-line break-words">{issue.ackNote || "（メモなし）"}</p>
          {ack && (
            <p className="mt-1 text-xs text-muted-foreground">
              {ack.byName ? `${ack.byName}さん・` : ""}
              {jst.format(ack.at)}
            </p>
          )}
          {changedSinceAck && (
            <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs font-bold text-warning">
              確認済みにしたあとで、この指摘の中身（数字・日付・人）が変わりました。もう一度確かめて、メモを書き直してください。
            </p>
          )}
        </div>
      )}
      {!issue.acked && previous && (
        <p className="mt-3 break-words rounded-lg border border-border bg-muted p-3 text-xs">
          {previous.fromCode === "paid_late"
            ? `${monthJa(previous.month)}分の見張り番で、この振込の遅れを確認済みにしています：`
            : `${monthJa(previous.month)}にも同じ指摘を確認済みにしています：`}
          {previous.note ? `「${previous.note}」` : "（メモなし）"}
          {!red && "この月の分も、中身が同じか確かめて確認済みにしてください。"}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start">
        {fix && (
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <Link href={fix.href} className={buttonClass(fix.canFix && !issue.acked ? "primary" : "secondary", "w-full sm:w-auto")}>
              {fix.text}
            </Link>
            {fix.note && <p className="text-xs text-muted-foreground sm:max-w-xs">{fix.note}</p>}
          </div>
        )}
        {canAck && !issue.acked && (
          <div className="w-full sm:min-w-72 sm:flex-1">
            <AckForm k={k} minLength={ackMinLength} red={red} draftNote={previous?.note} />
          </div>
        )}
        {canAck && issue.acked && changedSinceAck && (
          <div className="w-full sm:min-w-72 sm:flex-1">
            <AckForm
              k={k}
              minLength={ackMinLength}
              red={red}
              draftNote={issue.ackNote}
              label="確かめ直してメモを書き直す"
              draftHint="いまのメモを下書きに入れています。変わった中身を確かめてから保存してください。"
            />
          </div>
        )}
        {canAck && issue.acked && <UnackForm k={k} red={red} />}
      </div>
    </>
  );
  // 灰色の 1 行にたたむ：この月に確認済みにしたもの（確認後に中身が変わったものは除く）と、
  // 前の月に確認済みにした黄・お知らせ（締めを止めないもの。赤は締めを止めるので、たたまずに出す）
  const carried = !issue.acked && !!previous && !red;
  if ((issue.acked && !changedSinceAck) || carried) {
    const yen = issue.impact?.yen ?? null;
    return (
      <li>
        <details className="group rounded-card border border-border bg-muted">
          {/* スマホでは「印・金額・▾」の下に見出しを 1 行で（幅が狭くても見出しが消えないように）。広い画面では 1 行に並べる */}
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
            {carried ? <Badge tone="gray">{monthJa(previous!.month)}に確認済み</Badge> : <Badge tone="green">確認済み</Badge>}
            {yen !== null && <Money value={yen} className="shrink-0 text-xs sm:order-last" />}
            <span aria-hidden className="ml-auto shrink-0 group-open:rotate-180 sm:order-last sm:ml-0">
              ▾
            </span>
            <span className="min-w-0 basis-full truncate sm:basis-0 sm:flex-1">
              {SEVERITY_LABEL[issue.severity]}・{issue.title}
              {issue.subjectLabel ? `（${issue.subjectLabel}）` : ""}
            </span>
          </summary>
          <div className="rounded-b-card border-t border-border bg-card p-4">{body}</div>
        </details>
      </li>
    );
  }
  return (
    <li>
      <Card className={issue.acked ? "opacity-90" : CARD_BORDER[issue.severity]}>{body}</Card>
    </li>
  );
}
