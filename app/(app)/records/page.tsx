import { requireStaff } from "@/lib/auth/session";
import { loadRecordDocs } from "@/lib/records/load";
import { RecordsView } from "@/components/records/records-view";

export const metadata = { title: "書類の検索" };

/**
 * 書類の検索（/records）
 * レシート・請求書・支払通知・契約書を 1 つにまとめ、取引年月日・取引金額・取引先で探せます
 * （電子帳簿保存法の検索要件）。稼動月には依存しません。
 */
export default async function RecordsPage() {
  const { supabase, company } = await requireStaff();
  const docs = await loadRecordDocs(supabase, company.id);
  return <RecordsView docs={docs} />;
}
