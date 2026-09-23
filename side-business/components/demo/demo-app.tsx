"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Money } from "@/components/ui";
import { cx } from "@/lib/cx";
import { jpMonth } from "@/lib/format";
import { summarize } from "@/lib/payroll/calc";
import { ProfitTab } from "./profit-tab";
import { SettingsTab } from "./settings-tab";
import { useDemoState, useRequesterState } from "./state";
import { StatementsTab } from "./statements-tab";
import { TransferTab } from "./transfer-tab";
import { WorkTab } from "./work-tab";

const TABS = [
  { id: "work", label: "稼働" },
  { id: "statements", label: "支払明細" },
  { id: "profit", label: "利益" },
  { id: "transfer", label: "振込データ" },
  { id: "settings", label: "設定" },
] as const;

type TabId = (typeof TABS)[number]["id"];
const isTab = (v: string): v is TabId => TABS.some((t) => t.id === v);

export function DemoApp() {
  const demo = useDemoState();
  const { requester, setRequester, resetRequester } = useRequesterState();
  const [tab, setTab] = useState<TabId>("work");
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // 選んでいる画面は URL の # に持つ（再読み込み・共有しても同じ画面が開く）
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1);
      if (isTab(h)) setTab(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // 幅の狭い画面でタブが横にはみ出したとき、選んでいるタブを見える位置まで横に送る（縦には動かさない）
  useEffect(() => {
    const list = listRef.current;
    const el = tabRefs.current[tab];
    if (!list || !el) return;
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.left < lr.left) list.scrollLeft -= lr.left - er.left + 8;
    else if (er.right > lr.right) list.scrollLeft += er.right - lr.right + 8;
  }, [tab]);

  const choose = useCallback((id: TabId) => {
    setTab(id);
    try {
      window.history.replaceState(null, "", `#${id}`);
    } catch {
      // 履歴を書けない環境でも画面は切り替える
    }
    const el = panelRef.current;
    // 下までスクロールしてから切り替えたときは、新しい画面の頭（固定のタブの下）に戻す
    if (el && el.getBoundingClientRect().top < 128) el.scrollIntoView({ block: "start" });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    choose(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  const summary = useMemo(() => summarize(demo.data), [demo.data]);
  const reset = () => {
    demo.reset();
    resetRequester();
  };

  return (
    <div className="mt-6">
      <div className="sticky top-14 z-20 -mx-4 border-b border-border bg-background/95 px-4 backdrop-blur">
        <div
          ref={listRef}
          role="tablist"
          aria-label="デモの画面"
          onKeyDown={onKeyDown}
          className="flex gap-0.5 overflow-x-auto py-2 sm:gap-1"
        >
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[t.id] = el;
                }}
                type="button"
                role="tab"
                id={`demo-tab-${t.id}`}
                aria-selected={active}
                aria-controls="demo-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => choose(t.id)}
                className={cx(
                  "min-h-11 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-bold transition sm:px-4",
                  active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span>{jpMonth(demo.data.settings.month)}分</span>
        <span>明細 {summary.statements.length} 人</span>
        <span>
          振込額の合計{" "}
          <span className="font-bold text-foreground">
            <Money value={summary.payout} />
          </span>
        </span>
        <span>
          会社に残る利益{" "}
          <span className="font-bold text-foreground">
            <Money value={summary.profit} />
          </span>
        </span>
      </p>

      {!demo.storageOk && (
        <p role="status" className="mt-3 rounded-lg border border-warning px-3 py-2 text-sm text-warning">
          この端末では保存が使えないため、ページを閉じると入力は消えます。
        </p>
      )}

      <div
        ref={panelRef}
        id="demo-panel"
        role="tabpanel"
        aria-labelledby={`demo-tab-${tab}`}
        className="mt-4 scroll-mt-32 outline-none"
        tabIndex={-1}
      >
        {tab === "work" && <WorkTab data={demo.data} summary={summary} actions={demo} />}
        {tab === "statements" && <StatementsTab data={demo.data} summary={summary} storageOk={demo.storageOk} />}
        {tab === "profit" && <ProfitTab data={demo.data} summary={summary} />}
        {tab === "transfer" && (
          <TransferTab
            data={demo.data}
            summary={summary}
            actions={demo}
            requester={requester}
            setRequester={setRequester}
            onGoSettings={() => choose("settings")}
          />
        )}
        {tab === "settings" && <SettingsTab data={demo.data} actions={demo} onReset={reset} />}
      </div>
    </div>
  );
}
