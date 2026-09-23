import Link from "next/link";
import { Card } from "@/components/ui";
import { getDb } from "~/db/client";
import { requirePageUser } from "~/server/auth";
import { monthFromParam, monthLabelJa } from "~/server/month";

/** 今月の締め：流れの順に、どこまで済んだかを見せる（各段の中身は機能ごとの画面で） */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const user = await requirePageUser("viewer");
  const month = monthFromParam((await searchParams).m);
  await getDb();
  const steps = [
    { href: "/import", title: "1. 取り込む", body: "今の Excel をそのまま上げる" },
    { href: "/watch", title: "2. 見張り番を見る", body: "フリーランス法・インボイス・おかしな数字" },
    { href: "/statements", title: "3. 明細を作って送る", body: "ドライバーはスマホで確認" },
    { href: "/transfer", title: "4. 振込データ", body: "銀行にそのまま出せる" },
    { href: "/close", title: "5. 締める", body: "締めたら書き換えられない" },
  ];
  return (
    <div>
      <h1 className="text-2xl font-bold">{monthLabelJa(month)}の締め</h1>
      <p className="mt-1 text-sm text-muted-foreground">{user.name}さん、上から順に進めれば終わります。</p>
      <ol className="mt-6 grid gap-3 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.href}>
            <Link href={`${s.href}?m=${month.slice(0, 7)}`} className="block no-underline">
              <Card className="h-full hover:border-foreground">
                <p className="font-bold text-foreground">{s.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
