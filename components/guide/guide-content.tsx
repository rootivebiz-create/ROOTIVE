import Link from "next/link";
import { ChevronRight, Info, Lightbulb } from "lucide-react";
import type { Role } from "@/lib/db/types";
import { roleNoteFor } from "@/lib/guide/match";
import type { FaqItem, OverviewSection, PageGuide } from "@/lib/guide/types";

/** 1 つの画面のガイド（「？」のダイアログと /guide で共用。フックを使わないのでサーバーでも描ける） */
export function PageGuideContent({ guide, role, showLinks = true }: { guide: PageGuide; role?: Role; showLinks?: boolean }) {
  const note = roleNoteFor(guide, role);
  return (
    <div className="space-y-3 text-sm" data-guide={guide.slug}>
      <p>{guide.purpose}</p>
      {note && (
        <p className="flex gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span>{note}</span>
        </p>
      )}
      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">使い方</p>
        <ol className="list-decimal space-y-1 pl-5">
          {guide.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      {guide.tips && guide.tips.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            <Lightbulb className="h-3.5 w-3.5" aria-hidden />
            知っておくと楽になること
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {guide.tips.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {showLinks && guide.related && guide.related.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {guide.related.map((r) => (
            <Link key={r.href} href={r.href} className="inline-flex items-center gap-0.5 rounded-md border px-2 py-1 text-xs hover:bg-muted">
              {r.label}
              <ChevronRight className="h-3 w-3" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** 全体ガイドの 1 節 */
export function OverviewSectionContent({ section }: { section: OverviewSection }) {
  return (
    <div className="space-y-2 text-sm">
      {section.body?.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {section.steps && (
        <ol className="list-decimal space-y-1 pl-5">
          {section.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {section.items && (
        <ul className="list-disc space-y-1 pl-5">
          {section.items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <dl className="divide-y text-sm">
      {items.map((f) => (
        <div key={f.q} className="py-2">
          <dt className="font-medium">Q. {f.q}</dt>
          <dd className="mt-0.5 text-muted-foreground">A. {f.a}</dd>
        </div>
      ))}
    </dl>
  );
}
