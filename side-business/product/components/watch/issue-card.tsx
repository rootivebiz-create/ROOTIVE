import Link from "next/link";
import { Card, buttonClass } from "@/components/ui";
import { Badge } from "~/components/page";
import { AckForm, UnackForm } from "~/components/watch/ack-forms";
import type { WatchIssue } from "~/server/features/watch-types";
import { fixLink } from "~/server/features/watch/sources";

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

/**
 * 見張り番の指摘 1 件：見出し・対象・記録から分かること・根拠と出典・直す画面・確認済みの印。
 * 確認済みにする／外すのは事務・オーナーで、まだ締めていない月（振込の遅れは締めたあとも）。
 * 直す画面へのリンクは、直せない人（閲覧の人・会社の設定を変えられない事務・締めた月）には「見る」と出す。
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
  issue: WatchIssue;
  month: string;
  role: "owner" | "staff" | "viewer";
  closed: boolean;
  canAck: boolean;
  ackMinLength: number;
  ack?: AckView | null;
  /** 確認済みにしたあとで、中身（数字・日付・人）が変わったか */
  changedSinceAck?: boolean;
  previous?: { month: string; note: string | null } | null;
}) {
  const k = { month, code: issue.code, subjectId: issue.subjectId };
  const red = issue.severity === "red";
  const fix = issue.fixHref ? fixLink(issue.fixHref, { role, closed }) : null;
  return (
    <li>
      <Card className={issue.acked ? "opacity-90" : CARD_BORDER[issue.severity]}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_TONE[issue.severity]}>{SEVERITY_LABEL[issue.severity]}</Badge>
          {issue.acked && <Badge tone="green">確認済み</Badge>}
          {issue.subjectLabel && <span className="min-w-0 break-words text-sm text-muted-foreground">{issue.subjectLabel}</span>}
        </div>
        <h3 className={`mt-2 font-bold ${red && !issue.acked ? "text-danger" : ""}`}>{issue.title}</h3>
        <p className="mt-1 break-words text-sm">{issue.detail}</p>

        {issue.basis && (
          <p className="mt-2 text-xs text-muted-foreground">
            根拠：{issue.basis}
            {issue.sourceUrl && (
              <a href={issue.sourceUrl} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex min-h-11 items-center align-middle sm:min-h-0">
                出典<span className="sr-only">（新しいタブで開きます）</span> ↗
              </a>
            )}
          </p>
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
          <p className="mt-3 rounded-lg border border-border bg-muted p-3 text-xs">
            {monthJa(previous.month)}にも同じ指摘を確認済みにしています：{previous.note ? `「${previous.note}」` : "（メモなし）"}
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
      </Card>
    </li>
  );
}
