import Link from "next/link";
import { Card, Select, buttonClass } from "@/components/ui";
import { jpDate, yenText } from "@/lib/format";
import type { Rounding } from "@/lib/payroll/types";
import { Badge, EmptyState, PageHeader } from "~/components/page";
import { SourceLink } from "~/components/settings/bits";
import { ActionButton } from "~/components/settings/form-kit";
import { Expand } from "~/components/settings/list-bits";
import { RuleForm, type RuleInitial, type RuleKind } from "~/components/settings/rule-form";
import { getDb } from "~/db/client";
import { requirePageUser, roleAtLeast } from "~/server/auth";
import { listDrivers } from "~/server/features/settings/drivers";
import { rateToPercent, ruleValueText } from "~/server/features/settings/format";
import { listRules, ruleImpactOfMonth, usedRuleIds, type RuleListItem } from "~/server/features/settings/rules";
import { DAMAGE_WORDS, FEE_WORDS } from "~/server/features/watch/rules";
import { SOURCES } from "~/server/features/watch/sources";
import { monthFromParam, monthLabelJa, monthParam } from "~/server/month";
import { getTenant } from "~/server/repo";
import { createRuleAction, deleteRuleAction, setRuleActiveAction, updateRuleAction } from "./actions";

export const metadata = { title: "控除のルール" };

type SP = { m?: string; driver?: string };

function toInitial(r: RuleListItem): RuleInitial {
  const kind = (["percent", "fixed", "per_unit"].includes(r.kind) ? r.kind : "fixed") as RuleKind;
  return {
    id: r.id,
    name: r.name,
    driverId: r.driverId ?? "",
    kind,
    value: kind === "percent" ? String(rateToPercent(r.rate ?? 0)) : kind === "per_unit" ? String(r.rate ?? "") : String(r.amount ?? ""),
    onlyWhenWorked: r.onlyWhenWorked,
    taxable: r.taxable,
    agreedInWriting: r.agreedInWriting,
    agreedOn: r.agreedOn ?? "",
    basis: r.basis ?? "",
    active: r.active,
    sort: String(r.sort),
  };
}

export default async function RulesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("viewer");
  const sp = await searchParams;
  const month = monthFromParam(sp.m);
  const canEdit = roleAtLeast(user.role, "staff");
  const db = await getDb();
  const [tenant, { rows: drivers }, rules, monthImpact, used] = await Promise.all([
    getTenant(db, user.tenantId),
    listDrivers(db, user.tenantId, { status: "all" }),
    listRules(db, user.tenantId),
    ruleImpactOfMonth(db, user.tenantId, month),
    usedRuleIds(db, user.tenantId),
  ]);
  const { closed, byRule: impact } = monthImpact;
  // 締めた月なのに明細の写しが 1 件も無い（明細を作らずに締めた月など）
  const closedWithoutCopies = closed && monthImpact.statements === 0;
  const driverFilter = sp.driver && drivers.some((d) => d.id === sp.driver) ? sp.driver : undefined;
  const shown = driverFilter ? rules.filter((r) => r.driverId === null || r.driverId === driverFilter) : rules;
  const rounding = { amount: tenant.amountRounding as Rounding, tax: tenant.taxRounding as Rounding };
  const driverOptions = drivers.map((d) => ({ id: d.id, name: d.name, code: d.code, active: d.active }));
  const notAgreed = rules.filter((r) => r.active && !r.agreedInWriting).length;
  const others = rules.map((r) => ({ id: r.id, name: r.name, driverId: r.driverId, driverName: r.driverName, active: r.active }));
  const m = monthParam(month);

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="控除のルール"
        month={month}
        basePath="/settings/rules"
        description={
          <>
            ロイヤリティ・管理費・リース・保険など、委託料から差し引くものです。どの控除にも「いつ・どの書面で合意したか」を残します。{" "}
            <SourceLink href={SOURCES.flQa}>公取委 フリーランス法 Q&A</SourceLink>
          </>
        }
      />
      <p className="text-sm text-muted-foreground">
        {closedWithoutCopies
          ? `${monthLabelJa(month)}は締めてありますが、この月の明細の写しがありません。そのため、この月に引いた額はここでは出せません。ほかの月は上の ‹ › で見られます。`
          : closed
            ? `金額の欄は、${monthLabelJa(month)}の締めたときの明細で実際に引いた額です。締めた月の明細は、ルールを変えても変わりません。`
            : `金額の欄は、${monthLabelJa(month)}のいまの稼働で明細を計算したときの当たり方です。まだ締めていない月の明細は、作り直すとルールの変更が反映されます。`}
      </p>

      {canEdit && (
        <Card>
          <Expand summary="控除を追加" open={rules.length === 0}>
            <RuleForm
              key={driverFilter ?? "all"}
              action={createRuleAction}
              drivers={driverOptions}
              rounding={rounding}
              feeWords={FEE_WORDS.source}
              damageWords={DAMAGE_WORDS.source}
              submitLabel="追加する"
              defaultDriverId={driverFilter}
              others={others}
            />
          </Expand>
        </Card>
      )}

      {rules.length > 0 && (
        <form action="/settings/rules" method="get" className="flex flex-wrap gap-2">
          <input type="hidden" name="m" value={m} />
          <label className="min-w-0 flex-1 basis-56">
            <span className="sr-only">ドライバーで絞る</span>
            <Select name="driver" defaultValue={driverFilter ?? ""}>
              <option value="">すべての控除</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code ? `${d.code} ` : ""}
                  {d.name}に当たるもの
                </option>
              ))}
            </Select>
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            絞る
          </button>
        </form>
      )}
      {notAgreed > 0 && <p className="text-sm font-bold text-danger">合意の記録が無い控除が {notAgreed}件 あります。見張り番が毎月指摘します。</p>}

      {shown.length === 0 ? (
        <EmptyState title="控除のルールはまだありません">
          <p>
            引くものが無ければ、ここへの登録は要りません。
            {canEdit ? "今の Excel にロイヤリティや管理費の列があれば、上の「控除を追加」のひな形から登録できます。" : "登録は事務・オーナーの方がします。"}
          </p>
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => {
            const im = impact.get(r.id);
            return (
              <li key={r.id}>
                <Card className="space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold">{r.name}</span>
                    <span className="text-sm">{ruleValueText(r)}</span>
                    <span className="text-xs text-muted-foreground">{r.driverName ? `${r.driverName}だけ` : "全員"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {!r.active && <Badge>使わない</Badge>}
                    {r.agreedInWriting ? <Badge tone="green">合意の記録あり</Badge> : <Badge tone="red">合意の記録なし</Badge>}
                    <Badge>{r.onlyWhenWorked ? "稼働がある月だけ" : "稼働が無い月も"}</Badge>
                    <Badge>{r.taxable ? "消費税あり" : "消費税なし"}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.agreedOn ? `合意した日：${jpDate(r.agreedOn)}` : "合意した日：記録なし"}
                    {r.basis && `・根拠：${r.basis}`}
                  </p>
                  <p className="text-sm">
                    {monthLabelJa(month)}：
                    {im ? (
                      <>
                        <span className="num font-bold">{im.drivers}人・合計 {yenText(im.total)}</span>
                        <span className="text-xs text-muted-foreground">（税抜）</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {closedWithoutCopies ? "明細の写しが無いので出せません" : closed ? "この月は引いていません" : r.active ? "当たる人はいません" : "使わないので引きません"}
                      </span>
                    )}
                  </p>
                  {canEdit && (
                    <Expand summary="直す・使わない・消す">
                      <RuleForm
                        action={updateRuleAction}
                        initial={toInitial(r)}
                        drivers={driverOptions}
                        rounding={rounding}
                        feeWords={FEE_WORDS.source}
                        damageWords={DAMAGE_WORDS.source}
                        submitLabel="保存"
                        others={others}
                      />
                      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                        <ActionButton action={setRuleActiveAction} hidden={{ id: r.id, active: r.active ? "0" : "1" }} label={r.active ? "使わないにする" : "使うように戻す"} />
                        {used.has(r.id) ? (
                          <p className="w-full text-xs text-muted-foreground">支払明細で使われているので消せません（明細の記録を残すため）。やめるときは「使わないにする」を。</p>
                        ) : (
                          <ActionButton
                            action={deleteRuleAction}
                            hidden={{ id: r.id }}
                            label="消す"
                            danger
                            confirm={<p>「{r.name}」を消します。元に戻せません。</p>}
                            confirmLabel="消す"
                          />
                        )}
                      </div>
                    </Expand>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {driverFilter && (
        <p>
          <Link href={`/settings/drivers/${driverFilter}`} className="inline-flex min-h-11 items-center text-sm">
            ← このドライバーの画面へ
          </Link>
        </p>
      )}
    </div>
  );
}
