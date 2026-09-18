"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMonth } from "@/lib/hooks/use-month";
import { cn } from "@/lib/utils";

/** 候補の種別 */
export type CommandGroup = "page" | "driver" | "project" | "client" | "month";

export interface CommandItem {
  id: string;
  group: CommandGroup;
  label: string;
  /** 右側に出す補足（例: 「締め済み」「案件」） */
  hint?: string;
  /** 検索用の別名（ローマ字・かな・英語名など） */
  keywords?: string[];
  /** 移動先。稼動月（?m=）は自動で引き継ぐ */
  href?: string;
  /** 稼動月の切り替え（"YYYY-MM"）。href より優先する */
  month?: string;
  /** 停止中（バッジを出し、並びを後ろにする） */
  inactive?: boolean;
}

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  page: "画面",
  driver: "ドライバー",
  project: "案件",
  client: "取引先",
  month: "稼動月",
};

/** 表示するグループの順番 */
export const COMMAND_GROUP_ORDER: CommandGroup[] = ["page", "driver", "project", "client", "month"];

/** グループごとに表示する候補の上限（どのグループも必ず出るようにする） */
const MAX_PER_GROUP = 15;

/**
 * 検索用の正規化：全角→半角・大文字→小文字・カタカナ→ひらがな・空白と長音を除去
 * （日本語のあいまい検索。「ドライバー」「どらいば」「ﾄﾞﾗｲﾊﾞｰ」をすべて同じ文字列にする）
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　ー・･-]/g, "");
}

/** 1 つの語に対する一致度（0 = 前方一致、1 = 部分一致、null = 不一致） */
function termScore(haystacks: string[], term: string): number | null {
  let best: number | null = null;
  for (const h of haystacks) {
    if (h.startsWith(term)) return 0;
    if (h.includes(term)) best = 1;
  }
  return best;
}

/**
 * 候補の絞り込み（純関数）。
 * - 空のクエリは全件をそのままの順で返す
 * - クエリは空白で区切って AND 条件
 * - 並びは 一致度（前方一致 → 部分一致）→ 稼働中 → 元の順
 */
export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const terms = query
    .split(/[\s　]+/)
    .map((t) => normalizeText(t))
    .filter((t) => t.length > 0);
  if (terms.length === 0) return [...items];

  const scored: { item: CommandItem; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const haystacks = [item.label, ...(item.keywords ?? [])].map(normalizeText);
    let total = 0;
    for (const term of terms) {
      const s = termScore(haystacks, term);
      if (s == null) return;
      total += s;
    }
    scored.push({ item, score: total, index });
  });

  scored.sort((a, b) => a.score - b.score || Number(a.item.inactive ?? false) - Number(b.item.inactive ?? false) || a.index - b.index);
  return scored.map((s) => s.item);
}

export const OPEN_COMMAND_PALETTE_EVENT = "rootive:open-command-palette";

/** どこからでもコマンドパレットを開く（スマホのメニューシートから使う） */
export function openCommandPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_PALETTE_EVENT));
}

/** ヘッダーの検索ボタン ＋ コマンドパレット（⌘K / Ctrl+K） */
export function CommandPalette({ items }: { items: CommandItem[] }) {
  const router = useRouter();
  const { href, setMonth } = useMonth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => filterCommands(items, query), [items, query]);
  const groups = useMemo(
    () => COMMAND_GROUP_ORDER.map((g) => ({ group: g, items: results.filter((r) => r.group === g).slice(0, MAX_PER_GROUP) })).filter((g) => g.items.length > 0),
    [results],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // ⌘K / Ctrl+K で開く（"/" は入力欄と衝突するため使わない）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // 選択中の候補が見えるようにスクロール
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = useCallback(
    (item: CommandItem) => {
      setOpen(false);
      if (item.month) {
        setMonth(item.month);
        return;
      }
      if (item.href) router.push(href(item.href));
    },
    [href, router, setMonth],
  );

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[active] ?? flat[0];
      if (item) run(item);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="検索"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-9 shrink-0 items-center gap-2 rounded-md px-2 text-muted-foreground hover:bg-muted md:w-44 md:border md:px-3"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden text-sm md:inline">検索</span>
        <kbd className="ml-auto hidden rounded border px-1.5 py-0.5 text-[10px] md:inline">⌘K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 md:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" /> 検索
            </DialogTitle>
          </DialogHeader>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="画面・ドライバー・案件・取引先・稼動月"
            aria-label="検索語"
            className="h-11 w-full rounded-md border border-input bg-card px-3 text-base outline-none focus:ring-2 focus:ring-ring"
          />
          <div ref={listRef} className="max-h-[55dvh] overflow-y-auto">
            {flat.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">該当する候補はありません。</p>
            ) : (
              (() => {
                let index = -1;
                return groups.map((g) => (
                  <div key={g.group} className="mb-2">
                    <p className="px-1 py-1 text-xs font-semibold text-muted-foreground">{COMMAND_GROUP_LABELS[g.group]}</p>
                    <ul>
                      {g.items.map((item) => {
                        index += 1;
                        const i = index;
                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              data-index={i}
                              onMouseEnter={() => setActive(i)}
                              onClick={() => run(item)}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm",
                                i === active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate font-medium">{item.label}</span>
                                {item.inactive && <Badge variant="outline">停止中</Badge>}
                              </span>
                              {item.hint && <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ));
              })()
            )}
          </div>
          <p className="text-xs text-muted-foreground">↑↓ で移動／Enter で開く／Esc で閉じる</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
