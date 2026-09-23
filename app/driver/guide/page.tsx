import Link from "next/link";
import { requireDriver } from "@/lib/auth/session";
import { guidesForRole } from "@/lib/guide/match";
import { DRIVER_FAQ, DRIVER_OVERVIEW } from "@/lib/guide/overview";
import { PAGE_GUIDES } from "@/lib/guide/pages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { FaqList, OverviewSectionContent, PageGuideContent } from "@/components/guide/guide-content";

export const metadata = { title: "使い方ガイド" };

/** ドライバー用の使い方ガイド */
export default async function DriverGuidePage() {
  await requireDriver();
  const guides = guidesForRole(PAGE_GUIDES, "driver").filter((g) => g.href !== "/driver/guide");

  return (
    <div className="space-y-4">
      <PageHeader title="使い方ガイド" description="毎日の報告・予定・支払明細の見方です。画面の右上の「？」からも、その画面の使い方を開けます。" />
      {DRIVER_OVERVIEW.map((s) => (
        <Card key={s.slug} id={s.slug} className="scroll-mt-20">
          <CardHeader>
            <CardTitle>{s.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <OverviewSectionContent section={s} />
          </CardContent>
        </Card>
      ))}
      {guides.map((g) => (
        <Card key={g.slug} id={g.slug} className="scroll-mt-20">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>{g.title}</CardTitle>
            <Link href={g.href} className="text-xs text-primary underline-offset-2 hover:underline">
              この画面を開く
            </Link>
          </CardHeader>
          <CardContent>
            <PageGuideContent guide={g} role="driver" showLinks={false} />
          </CardContent>
        </Card>
      ))}
      <Card id="faq" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>よくある質問</CardTitle>
        </CardHeader>
        <CardContent>
          <FaqList items={DRIVER_FAQ} />
        </CardContent>
      </Card>
    </div>
  );
}
