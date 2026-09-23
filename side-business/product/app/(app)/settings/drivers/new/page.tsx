import Link from "next/link";
import { PageHeader } from "~/components/page";
import { DriverForm } from "~/components/settings/driver-form";
import { EMPTY_DRIVER } from "~/components/settings/driver-initial";
import { requirePageUser } from "~/server/auth";
import { todayJst } from "~/server/features/settings/format";
import { SOURCES } from "~/server/features/watch/sources";
import { createDriverAction } from "../actions";

export const metadata = { title: "ドライバーを追加" };

export default async function NewDriverPage() {
  await requirePageUser("staff");
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="ドライバーを追加"
        description={
          <>
            名前だけでも登録できます。口座・登録番号は、あとから入れられます（振込データ・明細を作る前に入れてください）。たくさんいるときは{" "}
            <Link href="/onboarding/drivers">まとめて登録（Excel・貼り付け）</Link> が早いです。
          </>
        }
      />
      <DriverForm
        action={createDriverAction}
        initial={EMPTY_DRIVER}
        submitLabel="登録する"
        today={todayJst()}
        sources={{ invoiceRegistry: SOURCES.invoiceRegistry, flLaw: SOURCES.flLaw, mhlwFl: SOURCES.mhlwFl }}
      />
      <p className="mt-4">
        <Link href="/settings/drivers" className="inline-flex min-h-11 items-center">
          ← ドライバーの一覧へ
        </Link>
      </p>
    </div>
  );
}
