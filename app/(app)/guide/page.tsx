import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/db/types";
import { faqForRole, guidesForRole, sectionsForRole } from "@/lib/guide/match";
import { STAFF_FAQ, STAFF_OVERVIEW } from "@/lib/guide/overview";
import { PAGE_GUIDES } from "@/lib/guide/pages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { FaqList, OverviewSectionContent, PageGuideContent } from "@/components/guide/guide-content";

export const metadata = { title: "使い方ガイド" };

/**
 * 使い方ガイド（スタッフ）。全体の流れ → 各ページの使い方 → よくある質問。
 * ロールで見られない画面のガイドは出さない（ナビと同じ出し分け）。
 */
export default async function GuidePage() {
  const { profile } = await requireStaff();
  const role = profile.role;
  const sections = sectionsForRole(STAFF_OVERVIEW, role);
  const guides = guidesForRole(PAGE_GUIDES, role).filter((g) => g.href !== "/guide");
  const faq = faqForRole(STAFF_FAQ, role);

  return (
    <div className="space-y-4">
      <PageHeader title="使い方ガイド" description={`${ROLE_LABELS[role]}として使うときの、全体の流れと各ページの使い方です。各画面の右上（スマホはメニュー）の「？」からも、その画面の使い方を開けます。`} />

      <Card>
        <CardHeader>
          <CardTitle>目次</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">全体の流れ</p>
            <ul className="space-y-1">
              {sections.map((s) => (
                <li key={s.slug}>
                  <a href={`#${s.slug}`} className="underline-offset-2 hover:underline">
                    {s.title}
                  </a>
                </li>
              ))}
              <li>
                <a href="#faq" className="underline-offset-2 hover:underline">
                  よくある質問
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">各ページの使い方（{guides.length}）</p>
            <ul className="columns-2 gap-4 space-y-1">
              {guides.map((g) => (
                <li key={g.slug} className="break-inside-avoid">
                  <a href={`#${g.slug}`} className="underline-offset-2 hover:underline">
                    {g.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {sections.map((s) => (
        <Card key={s.slug} id={s.slug} className="scroll-mt-20">
          <CardHeader>
            <CardTitle>{s.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <OverviewSectionContent section={s} />
          </CardContent>
        </Card>
      ))}

      <h2 className="pt-2 text-lg font-bold">各ページの使い方</h2>
      {guides.map((g) => (
        <Card key={g.slug} id={g.slug} className="scroll-mt-20">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>{g.title}</CardTitle>
            <Link href={g.href} className="text-xs text-primary underline-offset-2 hover:underline">
              この画面を開く
            </Link>
          </CardHeader>
          <CardContent>
            <PageGuideContent guide={g} role={role} showLinks={false} />
          </CardContent>
        </Card>
      ))}

      <Card id="faq" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>よくある質問</CardTitle>
        </CardHeader>
        <CardContent>
          <FaqList items={faq} />
        </CardContent>
      </Card>
    </div>
  );
}
