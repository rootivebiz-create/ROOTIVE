"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Phone, Plus, TriangleAlert, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Empty } from "@/components/ui/empty";
import {
  activeStages,
  checklistProgress,
  closedStages,
  daysBetween,
  daysSinceActivity,
  groupByStage,
  isClosedStage,
  stageLabel,
  staleApplicants,
  STALE_DAYS,
  type ApplicantEventView,
  type ApplicantView,
} from "@/lib/hr/helpers";
import { cn } from "@/lib/utils";
import { ApplicantDialog } from "./applicant-dialog";

export interface ApplicantsPanelProps {
  applicants: ApplicantView[];
  /** 全応募者のやりとり（新しい順）。ダイアログで応募者ごとに絞り込む */
  events: ApplicantEventView[];
  /** 日本時間の今日 "YYYY-MM-DD" */
  today: string;
  /** owner / admin */
  canEdit: boolean;
}

/** パイプラインのカード 1 枚 */
function ApplicantCard({ applicant, today, stale, onOpen }: { applicant: ApplicantView; today: string; stale: boolean; onOpen: () => void }) {
  const days = daysBetween(applicant.appliedOn, today) ?? applicant.daysSinceApplied;
  const progress = checklistProgress(applicant.checklist);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("w-full rounded-lg border border-border bg-card p-2.5 text-left shadow-sm transition-colors hover:bg-muted", stale && "border-warning/60")}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words font-medium leading-snug">{applicant.name}</span>
        <span className="num shrink-0 text-xs text-muted-foreground">{days}日</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {applicant.phone && (
          <span className="inline-flex items-center gap-1">
            <Phone className="h-3 w-3" />
            <span className="num">{applicant.phone}</span>
          </span>
        )}
        {applicant.source && <span className="break-words">{applicant.source}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge variant={progress.complete ? "success" : "secondary"}>
          書類 {progress.done}/{progress.total}
        </Badge>
        {stale && <Badge variant="warning">フォロー漏れ</Badge>}
        {applicant.driverName && <Badge variant="outline">{applicant.driverName}</Badge>}
      </div>
    </button>
  );
}

export function ApplicantsPanel({ applicants, events, today, canEdit }: ApplicantsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const open = useMemo(() => applicants.filter((a) => !isClosedStage(a.stage)), [applicants]);
  const closed = useMemo(() => applicants.filter((a) => isClosedStage(a.stage)), [applicants]);
  const groups = useMemo(() => groupByStage(open, activeStages), [open]);
  const closedGroups = useMemo(() => groupByStage(closed, closedStages), [closed]);
  const stale = useMemo(() => staleApplicants(applicants, today), [applicants, today]);
  const staleIds = useMemo(() => new Set(stale.map((a) => a.id)), [stale]);

  const selected = selectedId ? (applicants.find((a) => a.id === selectedId) ?? null) : null;
  const selectedEvents = useMemo(() => (selectedId ? events.filter((e) => e.applicantId === selectedId) : []), [events, selectedId]);

  return (
    <div className="space-y-4">
      {/* フォロー漏れ */}
      {stale.length > 0 && (
        <Alert variant="warning">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="h-4 w-4" />
            フォロー漏れ {stale.length} 人（{STALE_DAYS} 日以上動きがありません）
          </p>
          <ul className="mt-1.5 space-y-1">
            {stale.map((a) => (
              <li key={a.id}>
                <button type="button" onClick={() => setSelectedId(a.id)} className="text-left text-sm underline-offset-2 hover:underline">
                  {a.name}（{stageLabel(a.stage)} ／ {daysSinceActivity(a, today) ?? 0} 日動きなし）
                </button>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          選考中 <span className="num font-semibold text-foreground">{open.filter((a) => a.stage !== "started").length}</span> 人 ／ 稼働開始{" "}
          <span className="num font-semibold text-foreground">{open.filter((a) => a.stage === "started").length}</span> 人
        </p>
        {canEdit && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> 応募者を追加
          </Button>
        )}
      </div>

      {applicants.length === 0 ? (
        <Empty title="まだ応募者がいません" description={canEdit ? "「応募者を追加」から登録できます。" : "管理者が登録すると表示されます。"}>
          <UserPlus className="h-6 w-6 text-muted-foreground" />
        </Empty>
      ) : (
        <>
          {/* スマホ：段階ごとの折りたたみリスト（横スクロールのカンバンは使わない） */}
          <div className="space-y-2 md:hidden">
            {groups.map((g) => {
              const isOpen = collapsed[g.stage] === undefined ? g.count > 0 : !collapsed[g.stage];
              return (
                <div key={g.stage} className="rounded-lg border border-border bg-card">
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.stage]: isOpen }))}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-2 p-3 text-left"
                  >
                    <span className="font-medium">{g.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="num text-sm text-muted-foreground">{g.count}</span>
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="space-y-2 p-3 pt-0">
                      {g.count === 0 ? (
                        <p className="text-sm text-muted-foreground">この段階の人はいません。</p>
                      ) : (
                        g.applicants.map((a) => (
                          <ApplicantCard key={a.id} applicant={a} today={today} stale={staleIds.has(a.id)} onOpen={() => setSelectedId(a.id)} />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* PC：段階を横に並べた列 */}
          <div className="hidden gap-2 md:grid md:grid-cols-3 xl:grid-cols-6">
            {groups.map((g) => (
              <div key={g.stage} className="rounded-lg bg-muted/50 p-2">
                <div className="mb-2 flex items-center justify-between gap-1 px-1">
                  <span className="text-sm font-medium">{g.label}</span>
                  <span className="num text-xs text-muted-foreground">{g.count}</span>
                </div>
                <div className="space-y-2">
                  {g.count === 0 ? (
                    <p className="px-1 text-xs text-muted-foreground">なし</p>
                  ) : (
                    g.applicants.map((a) => <ApplicantCard key={a.id} applicant={a} today={today} stale={staleIds.has(a.id)} onOpen={() => setSelectedId(a.id)} />)
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 辞退・見送り（畳んで表示） */}
      {closed.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <button type="button" onClick={() => setShowClosed((v) => !v)} aria-expanded={showClosed} className="flex w-full items-center justify-between gap-2 p-3 text-left">
            <span className="font-medium text-muted-foreground">辞退・見送り（{closed.length} 件）</span>
            {showClosed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
          {showClosed && (
            <div className="space-y-3 p-3 pt-0">
              {closedGroups.map((g) => (
                <div key={g.stage} className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {g.label}（{g.count}）
                  </p>
                  {g.count === 0 ? (
                    <p className="text-sm text-muted-foreground">なし</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {g.applicants.map((a) => (
                        <ApplicantCard key={a.id} applicant={a} today={today} stale={false} onOpen={() => setSelectedId(a.id)} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 詳細・追加のダイアログ */}
      <ApplicantDialog
        open={selected != null}
        onOpenChange={(v) => !v && setSelectedId(null)}
        mode="edit"
        applicant={selected}
        events={selectedEvents}
        today={today}
        canEdit={canEdit}
      />
      <ApplicantDialog open={creating} onOpenChange={setCreating} mode="create" today={today} canEdit={canEdit} />
    </div>
  );
}
