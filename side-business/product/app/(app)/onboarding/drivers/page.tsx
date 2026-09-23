import { and, count, eq } from "drizzle-orm";
import Link from "next/link";
import { Card } from "@/components/ui";
import { DriversImport } from "~/components/onboarding/drivers-import";
import { NextStepLink, StepHeader } from "~/components/onboarding/step-header";
import { getDb } from "~/db/client";
import * as s from "~/db/schema";
import { requirePageUser } from "~/server/auth";

export const metadata = { title: "ドライバーの名簿を読み込む" };

/**
 * ② ドライバー：Excel の名簿を貼り付けるか、ファイルを置いて、まとめて登録する。
 * 設定の画面からも開く（最初の設定のあとで、新しい人をまとめて足すとき）。
 */
export default async function OnboardingDriversPage() {
  const user = await requirePageUser("staff");
  const db = await getDb();
  const [all] = await db
    .select({ n: count() })
    .from(s.drivers)
    .where(and(eq(s.drivers.tenantId, user.tenantId), eq(s.drivers.active, true)));

  return (
    <div className="mx-auto max-w-3xl">
      <StepHeader
        step="drivers"
        description={
          <>
            今お使いの Excel の名簿を、そのまま貼り付けてください。1 人ずつ「登録番号の形」「口座の桁」を確かめてから登録します。
            すでにいる人（同じ名前・同じ番号）は登録しないので、何度読み込んでも増えません。
          </>
        }
      />
      <Card className="mb-4">
        <p className="text-sm">
          いま登録されているドライバー：<span className="font-bold">{all?.n ?? 0}人</span>
        </p>
      </Card>
      <DriversImport />
      <div className="mt-8 space-y-2 text-sm text-muted-foreground">
        <p>
          登録番号は形（T と 13 桁）だけを確かめます。登録が今も有効かは{" "}
          <a href="https://www.invoice-kohyo.nta.go.jp/" target="_blank" rel="noopener noreferrer">
            国税庁 適格請求書発行事業者 公表サイト
          </a>{" "}
          で確かめられます。
        </p>
        <p>
          1 人ずつ直すときは、メニューの <Link href="/settings/drivers">設定 → ドライバー</Link> から開けます。
        </p>
        <NextStepLink step="drivers" />
      </div>
    </div>
  );
}
