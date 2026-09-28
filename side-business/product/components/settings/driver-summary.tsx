import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import { WITHHOLDING_CATEGORIES, type WithholdingCategory } from "@/lib/engine/withholding";
import { jpDate } from "@/lib/format";
import type { DriverRow } from "~/server/features/settings/drivers";
import { ACCOUNT_TYPE_LABEL, hasBank, maskAccount } from "~/server/features/settings/format";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-2 last:border-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

const dash = (v: string | null | undefined) => (v ? v : "—");
const date = (v: string | null | undefined) => (v ? jpDate(v) : "—");

/** 閲覧の人向けの読むだけの表示（口座番号は一部だけ） */
export function DriverSummary({ d }: { d: DriverRow }) {
  const wh = WITHHOLDING_CATEGORIES[(d.withholdingCategory as WithholdingCategory) in WITHHOLDING_CATEGORIES ? (d.withholdingCategory as WithholdingCategory) : "none"];
  return (
    <Card>
      <dl>
        <Row label="名前">
          {d.name}
          {d.kana && <span className="ml-2 text-muted-foreground">{d.kana}</span>}
        </Row>
        <Row label="社内の番号">{dash(d.code)}</Row>
        <Row label="別名">{d.aliases.length ? d.aliases.join("、") : "—"}</Row>
        <Row label="メール・電話">
          {dash(d.email)}・{dash(d.phone)}
        </Row>
        <Row label="インボイス">{d.invoiceRegistered ? `登録あり（${dash(d.registrationNo)}）` : "登録なし"}</Row>
        <Row label="公表サイトで確かめた日">{date(d.registrationCheckedOn)}</Row>
        <Row label="口座">
          {hasBank(d)
            ? `${d.bankCode} ${d.bankNameKana ?? ""}・${d.branchCode} ${d.branchNameKana ?? ""}・${ACCOUNT_TYPE_LABEL[d.accountType === "checking" ? "checking" : "ordinary"]} ${maskAccount(d.accountNumber)}・${d.holderKana}`
            : "未登録"}
        </Row>
        <Row label="取引条件を明示した日">{date(d.termsIssuedOn)}</Row>
        <Row label="委託を始めた日">{date(d.startedOn)}</Row>
        <Row label="終了日・伝えた日">
          {date(d.endOn)}・{date(d.endNoticedOn)}
        </Row>
        <Row label="法人">{d.isCorporation ? "法人" : "個人"}</Row>
        <Row label="源泉徴収">{wh.label}</Row>
        <Row label="状態">{d.active ? "有効" : "無効"}</Row>
        <Row label="メモ">{dash(d.notes)}</Row>
      </dl>
    </Card>
  );
}
