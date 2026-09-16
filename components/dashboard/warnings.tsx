import { AlertTriangle, ChevronRight } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { MonthLink } from "@/components/layout/month-link";
import { yen, qty as qtyText } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import type { DashboardWarnings as Warnings } from "@/lib/db/queries-dashboard";

const MAX_LIST = 5;

function itemLabel(projectName: string, itemName: string): string {
  return itemName && itemName !== "標準" ? `${projectName}（${itemName}）` : projectName;
}

function LinkRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <MonthLink href={href} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-warning/10">
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRight className="h-4 w-4 shrink-0" />
    </MonthLink>
  );
}

/** 警告（該当時のみ表示。各警告から該当画面へ遷移） §4.1・§12-1 */
export function DashboardWarnings({ warnings }: { warnings: Warnings }) {
  const { lossEntries, mgmtFeeMismatches, idleDrivers, zeroQtyEntries, openPastMonths, rateDiffs } = warnings;
  const count =
    (lossEntries.length ? 1 : 0) + (mgmtFeeMismatches.length ? 1 : 0) + (idleDrivers.length ? 1 : 0) + (zeroQtyEntries.length ? 1 : 0) + (openPastMonths.length ? 1 : 0) + (rateDiffs.length ? 1 : 0);
  if (count === 0) return null;

  return (
    <Alert variant="warning" className="space-y-3">
      <AlertTitle className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4" /> 確認が必要な項目（{count} 件）
      </AlertTitle>
      <AlertDescription className="space-y-3 text-foreground">
        {lossEntries.length > 0 && (
          <section>
            <p className="font-medium">支払単価が受注単価を上回る稼働行（赤字）が {lossEntries.length} 件あります</p>
            <div className="mt-1">
              {lossEntries.slice(0, MAX_LIST).map((e) => (
                <LinkRow key={e.id} href={`/entries?q=${encodeURIComponent(e.driverName)}`}>
                  {e.driverName}／{itemLabel(e.projectName, e.itemName)}：支払 <span className="num">{yen(e.payRate)}</span> ＞ 受注 <span className="num">{yen(e.billRate)}</span>
                  {e.qty > 0 && <span className="text-muted-foreground">（数量 {qtyText(e.qty)}）</span>}
                </LinkRow>
              ))}
              {lossEntries.length > MAX_LIST && <LinkRow href="/entries">ほか {lossEntries.length - MAX_LIST} 件を稼働入力で確認</LinkRow>}
            </div>
          </section>
        )}

        {mgmtFeeMismatches.length > 0 && (
          <section>
            <p className="font-medium">今月の管理費がドライバーの標準と異なります（入力ミスの可能性）</p>
            <div className="mt-1">
              {mgmtFeeMismatches.map((m) => (
                <LinkRow key={m.driverId} href={`/payouts/${encodeURIComponent(m.driverId)}/statement`}>
                  {m.driverName}：今月 <span className="num">{yen(m.setting)}</span>（標準 <span className="num">{yen(m.defaultFee)}</span>）
                </LinkRow>
              ))}
            </div>
          </section>
        )}

        {idleDrivers.length > 0 && (
          <section>
            <p className="font-medium">稼働中なのに今月の稼働がないドライバーが {idleDrivers.length} 名います</p>
            <div className="mt-1">
              <LinkRow href="/entries">{idleDrivers.map((d) => d.driverName).join("、")}</LinkRow>
            </div>
          </section>
        )}

        {zeroQtyEntries.length > 0 && (
          <section>
            <p className="font-medium">数量が 0 のままの稼働行が {zeroQtyEntries.length} 件あります（前月から複製した未入力の行）</p>
            <div className="mt-1">
              <LinkRow href="/entries">
                {[...new Set(zeroQtyEntries.map((e) => e.driverName))].slice(0, MAX_LIST).join("、")}
                {new Set(zeroQtyEntries.map((e) => e.driverName)).size > MAX_LIST && " ほか"}
              </LinkRow>
            </div>
          </section>
        )}

        {rateDiffs.length > 0 && (
          <section>
            <p className="font-medium">単価・率が現在の設定と異なる稼働行が {rateDiffs.length} 件あります</p>
            <div className="mt-1">
              {rateDiffs.slice(0, MAX_LIST).map((d) => (
                <LinkRow key={d.entryId} href={`/entries?q=${encodeURIComponent(d.driverName)}`}>
                  {d.driverName}／{itemLabel(d.projectName, d.itemName)}：<span className="tabular-nums">{d.changes.join("、")}</span>
                </LinkRow>
              ))}
              {rateDiffs.length > MAX_LIST && <LinkRow href="/entries">ほか {rateDiffs.length - MAX_LIST} 件を稼働入力で確認</LinkRow>}
            </div>
            <p className="mt-1 px-2 text-xs text-muted-foreground">稼働入力の「マスタの値に更新」でまとめて反映できます</p>
          </section>
        )}

        {openPastMonths.length > 0 && (
          <section>
            <p className="font-medium">締めていない過去の月があります</p>
            <div className="mt-1">
              <LinkRow href="/settings/months">{openPastMonths.map(formatMonthJa).join("、")}</LinkRow>
            </div>
          </section>
        )}
      </AlertDescription>
    </Alert>
  );
}
