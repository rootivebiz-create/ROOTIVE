"use client";

import { useMemo, useState } from "react";
import { Input, NumberInput, Select } from "@/components/ui";
import { jpDate, jpMonth, yenText } from "@/lib/format";
import { payDateFor, periodOf } from "~/server/calc/statement";
import {
  deadlineHint,
  deemedNote,
  FEE_BEARER_WARNING,
  isStandardNote,
  payRuleSentence,
  readNumber,
  ROUNDING_CHOICES,
  TAX_METHODS,
  wordingWarnings,
} from "~/server/features/settings/format";
import { Callout, Check, Choice, F, ResultLine, Section, SubmitRow, useFormAction, type FormAction } from "./form-kit";
import { KanaPreview, SourceLink } from "./bits";

export type CompanyInitial = {
  name: string;
  registrationNo: string;
  taxMethod: "general" | "simplified" | "exempt";
  payTaxToExempt: boolean;
  taxRounding: string;
  amountRounding: string;
  closingDay: number;
  payMonthOffset: number;
  payDay: number;
  paymentTermsText: string;
  transferFeeBearer: "company" | "driver";
  capitalYen: string;
  employees: string;
  deemedConfirmDays: string;
  statementNote: string;
  requester: {
    code: string;
    nameKana: string;
    bankCode: string;
    bankNameKana: string;
    branchCode: string;
    branchNameKana: string;
    accountType: "ordinary" | "checking";
    accountNumber: string;
  };
};

export type CompanyFormProps = {
  action: FormAction;
  initial: CompanyInitial;
  canEdit: boolean;
  /** 今日（YYYY-MM-DD）と、支払日の例に使う月（YYYY-MM-01） */
  today: string;
  month: string;
  periodWords: readonly string[];
  startWords: readonly string[];
  toriteki: { capitalYen: number; employees: number };
  sources: { flGuidelines: string; flQa: string; toritekiLeaflet: string; toritekiOverview: string; exemptQa: string; invoiceRegistry: string; purchaseStatement: string; purchaseStatementQa: string };
};

const DAYS = Array.from({ length: 30 }, (_, i) => i + 1);

export function CompanyForm({ action, initial, canEdit, today, month, periodWords, startWords, toriteki, sources }: CompanyFormProps) {
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const [taxMethod, setTaxMethod] = useState(initial.taxMethod);
  const [regNo, setRegNo] = useState(initial.registrationNo);
  const [closingDay, setClosingDay] = useState(initial.closingDay);
  const [payMonthOffset, setPayMonthOffset] = useState(initial.payMonthOffset);
  const [payDay, setPayDay] = useState(initial.payDay);
  const [terms, setTerms] = useState(initial.paymentTermsText);
  const [fee, setFee] = useState(initial.transferFeeBearer);
  const [capital, setCapital] = useState(initial.capitalYen);
  const [employees, setEmployees] = useState(initial.employees);
  const [days, setDays] = useState(initial.deemedConfirmDays);
  const [note, setNote] = useState(initial.statementNote);
  const [reqName, setReqName] = useState(initial.requester.nameKana);
  const [reqBank, setReqBank] = useState(initial.requester.bankNameKana);
  const [reqBranch, setReqBranch] = useState(initial.requester.branchNameKana);

  const rule = payRuleSentence(closingDay, payMonthOffset, payDay);
  const hint = useMemo(() => deadlineHint(closingDay, payMonthOffset, payDay, today), [closingDay, payMonthOffset, payDay, today]);
  const payDate = payDateFor(month, { payMonthOffset, payDay });
  // 明細の計算と同じ式で出す（締め日が末日でなければ、前の月の締め日の翌日から）
  const period = periodOf(month, closingDay);
  const wording = wordingWarnings(terms, periodWords, startWords);
  const daysNum = readNumber(days);
  const dayCount = daysNum !== null && Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 60 ? daysNum : 7;
  const noteDays = /(\d+)日以内/.exec(note.normalize("NFKC"))?.[1];
  const noteMismatch = noteDays !== undefined && Number(noteDays) !== dayCount;
  const capNum = readNumber(capital);
  const empNum = readNumber(employees);
  const torOver = (capNum !== null && capNum > toriteki.capitalYen) || (empNum !== null && empNum > toriteki.employees);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
        <Section title="会社">
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="会社名" error={fe.name}>
              <Input name="name" defaultValue={initial.name} required maxLength={100} />
            </F>
            <F label="登録番号（T＋13 桁）" error={fe.registrationNo} hint="明細（仕入明細書）に載ります。未登録なら空のまま">
              <Input name="registrationNo" value={regNo} onChange={(e) => setRegNo(e.currentTarget.value)} placeholder="T1234567890123" inputMode="text" autoComplete="off" />
            </F>
          </div>
        </Section>

        <Section title="消費税" description="どれに当たるかは、税理士にご確認ください。">
          <input type="hidden" name="taxMethod" value={taxMethod} />
          <Choice name="taxMethodChoice" value={taxMethod} onChange={setTaxMethod} options={TAX_METHODS} disabled={!canEdit} />
          {fe.taxMethod && <p className="text-xs font-bold text-danger">{fe.taxMethod}</p>}
          {taxMethod === "exempt" && regNo.trim() !== "" && (
            <Callout tone="yellow">「免税」を選んでいますが、登録番号が入っています。インボイスに登録している会社は消費税を納める側になるので、どちらかが違っていないか確かめてください。</Callout>
          )}
          <Check
            name="payTaxToExempt"
            defaultChecked={initial.payTaxToExempt}
            label="インボイスに登録していない（免税の）方にも、消費税相当額を払う"
            hint={
              <>
                チェックすると、登録していない方にも委託料の10%を「消費税相当額」として明細に載せて払います。変えるときは、相手との話し合いの記録を残し、公取委の Q&A の確認をおすすめします。{" "}
                <SourceLink href={sources.exemptQa}>公取委「免税事業者との取引」Q&A</SourceLink>
              </>
            }
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="消費税の1円未満" error={fe.taxRounding}>
              <Select name="taxRounding" defaultValue={initial.taxRounding}>
                {ROUNDING_CHOICES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </F>
            <F label="単価 × 数量・率の控除の1円未満" error={fe.amountRounding}>
              <Select name="amountRounding" defaultValue={initial.amountRounding}>
                {ROUNDING_CHOICES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </F>
          </div>
        </Section>

        <Section title="締め日と支払日（ドライバーへの支払）">
          <div className="grid gap-3 sm:grid-cols-3">
            <F label="締め日" error={fe.closingDay}>
              <Select name="closingDay" value={String(closingDay)} onChange={(e) => setClosingDay(Number(e.currentTarget.value))}>
                <option value="0">末日</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}日
                  </option>
                ))}
              </Select>
            </F>
            <F label="支払う月" error={fe.payMonthOffset}>
              <Select name="payMonthOffset" value={String(payMonthOffset)} onChange={(e) => setPayMonthOffset(Number(e.currentTarget.value))}>
                <option value="0">当月</option>
                <option value="1">翌月</option>
                <option value="2">翌々月</option>
              </Select>
            </F>
            <F label="支払日" error={fe.payDay}>
              <Select name="payDay" value={String(payDay)} onChange={(e) => setPayDay(Number(e.currentTarget.value))}>
                <option value="0">末日</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}日
                  </option>
                ))}
              </Select>
            </F>
          </div>
          <p className="text-base font-bold">{rule}</p>
          <p className="text-sm text-muted-foreground">
            例：{jpMonth(month)}分の明細は、対象期間 <span className="font-bold text-foreground">{jpDate(period.from)}〜{jpDate(period.to)}</span>・支払日{" "}
            <span className="font-bold text-foreground">{jpDate(payDate)}</span> です。
          </p>
          {closingDay !== 0 && (
            <Callout tone="gray">
              {closingDay}日締めのときは、この期間（前の月の{closingDay}日の翌日〜その月の{closingDay}日）の稼働を「{jpMonth(month)}分」として取り込んでください。
            </Callout>
          )}
          {hint.status === "error" ? (
            <Callout tone="red">{hint.text}</Callout>
          ) : (
            <Callout tone={hint.status === "ok" ? "green" : hint.status === "caution" ? "yellow" : "red"}>
              <p>{hint.text}</p>
              {hint.safer && <p className="mt-1">{hint.safer}</p>}
              <p className="mt-1 text-xs">
                銀行の休みの日（土日・年末年始）は前の営業日にずらして数えています。祝日は入れていません。{" "}
                <SourceLink href={sources.flGuidelines}>フリーランス法 解釈ガイドライン</SourceLink>
              </p>
            </Callout>
          )}
          <F label="取引条件に書いている支払期日の文言" error={fe.paymentTermsText} hint="契約書・取引条件の書面の文をそのまま。見張り番が書き方を確かめます">
            <textarea
              name="paymentTermsText"
              value={terms}
              onChange={(e) => setTerms(e.currentTarget.value)}
              rows={2}
              maxLength={300}
              placeholder={`例：${rule}`}
              className="block min-h-11 w-full rounded-lg border border-border bg-card px-3 py-2 text-base"
            />
          </F>
          {canEdit && terms.trim() !== rule && (
            <button type="button" className="min-h-11 text-sm text-link underline" onClick={() => setTerms(rule)}>
              上の設定の文（{rule}）を入れる
            </button>
          )}
          {wording.map((w) => (
            <Callout key={w} tone="yellow">
              {w} <SourceLink href={sources.flQa}>公取委 フリーランス法 Q&A</SourceLink>
            </Callout>
          ))}
        </Section>

        <Section title="振込手数料">
          <input type="hidden" name="transferFeeBearer" value={fee} />
          <Choice
            name="feeChoice"
            value={fee}
            onChange={setFee}
            disabled={!canEdit}
            options={[
              { id: "company", label: "会社が持つ", help: "振込額はそのまま届きます" },
              { id: "driver", label: "ドライバーが持つ", help: "振込額から手数料を差し引きます" },
            ]}
          />
          {fee === "driver" && (
            <Callout tone="red">
              {FEE_BEARER_WARNING}見張り番が毎月この設定を指摘します。 <SourceLink href={sources.toritekiLeaflet}>取適法 リーフレット</SourceLink>
            </Callout>
          )}
        </Section>

        <Section
          title="会社の規模（取適法の目安）"
          description={
            <>
              取適法の対象かどうかの目安に使います（見張り番）。 <SourceLink href={sources.toritekiOverview}>取適法の概要</SourceLink>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="資本金（円）" error={fe.capitalYen}>
              <NumberInput name="capitalYen" value={capital} onChange={(e) => setCapital(e.currentTarget.value)} placeholder="例：10,000,000" />
            </F>
            <F label="常時使用する従業員の数（人）" error={fe.employees}>
              <NumberInput name="employees" value={employees} onChange={(e) => setEmployees(e.currentTarget.value)} inputMode="numeric" placeholder="例：12" />
            </F>
          </div>
          {capNum !== null && !Number.isNaN(capNum) && <p className="text-sm text-muted-foreground">資本金 {yenText(capNum)}</p>}
          {torOver && (
            <Callout tone="yellow">
              資本金 {yenText(toriteki.capitalYen)} または 従業員 {toriteki.employees}人 を超えています。取適法の対象になる可能性があります（取引の内容と相手の規模で決まります）。弁護士等へのご確認をおすすめします。
            </Callout>
          )}
        </Section>

        <Section
          title="明細の確認"
          description={
            <>
              ドライバーへ明細（仕入明細書）を送ったあと、連絡が無ければ確認とみなすまでの日数と、明細の下に載せる文です。{" "}
              <SourceLink href={sources.purchaseStatementQa}>インボイス Q&A 問86</SourceLink>・<SourceLink href={sources.purchaseStatement}>仕入明細書</SourceLink>
            </>
          }
        >
          <F label="連絡が無ければ確認とみなすまでの日数" error={fe.deemedConfirmDays} hint="既定は 7 日。取引条件（契約）に書いた日数に合わせてください">
            <NumberInput name="deemedConfirmDays" value={days} onChange={(e) => setDays(e.currentTarget.value)} inputMode="numeric" className="max-w-32" />
          </F>
          <F label="明細の注記" error={fe.statementNote} hint="空のときは、下の薄い文（日数は上の設定）を載せます">
            <textarea
              name="statementNote"
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              rows={3}
              maxLength={400}
              placeholder={deemedNote(dayCount)}
              className="block min-h-11 w-full rounded-lg border border-border bg-card px-3 py-2 text-base"
            />
          </F>
          {noteMismatch &&
            (isStandardNote(note) ? (
              <p className="text-xs text-muted-foreground">保存すると、注記の日数も {dayCount}日 に直します。</p>
            ) : (
              <Callout tone="yellow">
                注記の日数（{noteDays}日）と、確認とみなすまでの日数（{dayCount}日）が違います。どちらかにそろえてください。
              </Callout>
            ))}
        </Section>

        <Section title="振込依頼人（全銀の振込データ）" description="銀行と契約した「総合振込」の情報です。振込データを作るときに使います。">
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="依頼人コード（10 桁）" error={fe.requesterCode} hint="銀行から知らされる番号">
              <Input name="requesterCode" defaultValue={initial.requester.code} inputMode="numeric" autoComplete="off" className="num" />
            </F>
            <F label="依頼人名（カナ）" error={fe.requesterName}>
              <Input name="requesterName" value={reqName} onChange={(e) => setReqName(e.currentTarget.value)} placeholder="例：ｻﾝﾌﾟﾙｳﾝｿｳ(ｶ" />
            </F>
          </div>
          <KanaPreview value={reqName} />
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="金融機関コード（4 桁）" error={fe.requesterBankCode}>
              <Input name="requesterBankCode" defaultValue={initial.requester.bankCode} inputMode="numeric" autoComplete="off" className="num" />
            </F>
            <F label="金融機関名（カナ）" error={fe.requesterBankName}>
              <Input name="requesterBankName" value={reqBank} onChange={(e) => setReqBank(e.currentTarget.value)} />
            </F>
            <F label="支店コード（3 桁）" error={fe.requesterBranchCode}>
              <Input name="requesterBranchCode" defaultValue={initial.requester.branchCode} inputMode="numeric" autoComplete="off" className="num" />
            </F>
            <F label="支店名（カナ）" error={fe.requesterBranchName}>
              <Input name="requesterBranchName" value={reqBranch} onChange={(e) => setReqBranch(e.currentTarget.value)} />
            </F>
            <F label="預金の種類" error={fe.requesterAccountType}>
              <Select name="requesterAccountType" defaultValue={initial.requester.accountType}>
                <option value="ordinary">普通</option>
                <option value="checking">当座</option>
              </Select>
            </F>
            <F label="口座番号（7 桁まで）" error={fe.requesterAccountNumber}>
              <Input name="requesterAccountNumber" defaultValue={initial.requester.accountNumber} inputMode="numeric" autoComplete="off" className="num" />
            </F>
          </div>
          <KanaPreview value={reqBank} label="金融機関名" />
          <KanaPreview value={reqBranch} label="支店名" />
        </Section>
      </fieldset>

      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
          <ResultLine state={state} />
          <SubmitRow pending={pending} label="会社の設定を保存" />
          <p className="text-xs text-muted-foreground">変えた内容は、まだ締めていない月の明細を作り直したときに反映されます。締めた月の明細は変わりません。</p>
        </div>
      )}
    </form>
  );
}
