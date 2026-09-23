import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { Notice } from "~/components/page";
import { StatementView } from "~/components/statements/statement-view";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { getStatementRow, loadVersionHistory, versionView } from "~/server/features/statements";
import { describeChanges } from "~/server/features/statements/diff";
import { jpMonthLabel, toDriverView } from "~/server/features/statements/view";
import { readSnapshot } from "~/server/statements-core";

export const metadata = { title: "支払明細（前の版）" };

/** 前の版の中身（保存してある写しをそのまま。ドライバーがその版で見ていたものと同じ） */
export default async function StatementVersionPage({ params }: { params: Promise<{ id: string; version: string }> }) {
  const user = await requirePageUser("viewer");
  const { id, version: raw } = await params;
  const version = Number(raw);
  const db = await getDb();
  const st = await getStatementRow(db, user.tenantId, id);
  if (!st || !Number.isInteger(version)) notFound();
  const old = await versionView(db, user.tenantId, st.id, version);
  if (!old) notFound();
  const current = toDriverView(readSnapshot(st), st);
  const history = await loadVersionHistory(db, user.tenantId, st);
  const item = history.find((h) => h.version === version);
  const isCurrent = version === st.version;
  const changes = isCurrent ? [] : describeChanges(old, current);

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/statements/${st.id}`} className="inline-flex min-h-11 items-center text-sm">
          ← {old.driver.name}さんの明細（いまの版）へ
        </Link>
        <h1 className="text-2xl font-bold">
          {old.driver.name}さんの支払明細・版 {version}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {jpMonthLabel(st.month)}分・{item?.createdAtText ? `${item.createdAtText} に作った写し` : "保存してある写し"}・目印 <span className="font-mono">{old.hashShort}</span>
        </p>
      </div>

      {isCurrent ? (
        <Notice tone="info">これはいまの版です。</Notice>
      ) : (
        <Notice tone="info">これは前の版の写しです（いまの版は 版 {st.version}）。中身は作ったときのまま残してあり、変えられません。</Notice>
      )}

      {item && (
        <Card>
          <h2 className="font-bold">この版の確認</h2>
          {item.confirmations.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">この版をドライバーが確認した記録はありません。</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {item.confirmations.map((c, i) => (
                <li key={i}>{c.at} に確認しています</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {changes.length > 0 && (
        <Card>
          <h2 className="font-bold">この版から、いまの版（版 {st.version}）までに変わったところ</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {changes.map((c, i) => (
              <li key={i} className="break-words">
                ・{c}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 口座は今の台帳のものなので、前の版には出さない */}
      <StatementView view={old} showAccount={false} />
    </div>
  );
}
