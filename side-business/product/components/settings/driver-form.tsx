"use client";

import { useEffect, useRef, useState } from "react";
import { Input, Select } from "@/components/ui";
import { WITHHOLDING_CATEGORIES, WITHHOLDING_CATEGORY_ORDER, type WithholdingCategory } from "@/lib/engine/withholding";
import { daysBetweenDates } from "~/server/features/settings/format";
import { KanaPreview, SourceLink } from "./bits";
import type { DriverInitial } from "./driver-initial";
import { Callout, Check, F, ResultLine, Section, SubmitRow, useFormAction, type FormAction } from "./form-kit";

/** ドライバーの登録・変更（基本・インボイス・口座・取引の日付・源泉徴収） */
export function DriverForm({
  action,
  initial,
  submitLabel,
  today,
  sources,
}: {
  action: FormAction;
  initial: DriverInitial;
  submitLabel: string;
  today: string;
  sources: { invoiceRegistry: string; flLaw: string; mhlwFl: string };
}) {
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const [registered, setRegistered] = useState(initial.invoiceRegistered);
  const [checkedOn, setCheckedOn] = useState(initial.registrationCheckedOn);
  const [withholding, setWithholding] = useState(initial.withholdingCategory || "none");
  const [bankName, setBankName] = useState(initial.bankNameKana);
  const [branchName, setBranchName] = useState(initial.branchNameKana);
  const [holder, setHolder] = useState(initial.holderKana);
  const [accountNo, setAccountNo] = useState(initial.accountNumber);
  const [endOn, setEndOn] = useState(initial.endOn);
  const [endNoticedOn, setEndNoticedOn] = useState(initial.endNoticedOn);
  const [kana, setKana] = useState(initial.kana);
  const errorRef = useRef<HTMLDivElement>(null);

  // 誤りがあったら、上の知らせが見えるところへ
  useEffect(() => {
    if (state && !state.ok) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [state]);

  const info = WITHHOLDING_CATEGORIES[(withholding as WithholdingCategory) in WITHHOLDING_CATEGORIES ? (withholding as WithholdingCategory) : "none"];
  const digits = accountNo.normalize("NFKC").replace(/\D/g, "");
  const noticeDays = endOn && endNoticedOn && /^\d{4}-\d{2}-\d{2}$/.test(endOn) && /^\d{4}-\d{2}-\d{2}$/.test(endNoticedOn) ? daysBetweenDates(endNoticedOn, endOn) : null;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div ref={errorRef}>
        <ResultLine state={state && !state.ok ? state : undefined} />
      </div>

      <Section title="基本">
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="名前" error={fe.name}>
            <Input name="name" defaultValue={initial.name} required maxLength={60} placeholder="例：青木 翔太" autoComplete="off" />
          </F>
          <F label="フリガナ（任意）" error={fe.kana} hint="口座名義を空にしたときの見本にも使います">
            <Input name="kana" value={kana} onChange={(e) => setKana(e.currentTarget.value)} maxLength={60} placeholder="例：アオキ ショウタ" autoComplete="off" />
          </F>
          <F label="社内の番号（任意）" error={fe.code} hint="Excel に番号があれば、取り込みの照合に使います">
            <Input name="code" defaultValue={initial.code} maxLength={20} placeholder="例：D01" autoComplete="off" />
          </F>
          <F label="別名（任意）" error={fe.aliases} hint="Excel での書き方が違うとき。「、」かカンマで区切る（例：青木、アオキ）">
            <Input name="aliases" defaultValue={initial.aliases} autoComplete="off" />
          </F>
          <F label="メールアドレス（任意）" error={fe.email}>
            <Input name="email" type="email" defaultValue={initial.email} autoComplete="off" />
          </F>
          <F label="電話番号（任意）" error={fe.phone}>
            <Input name="phone" type="tel" defaultValue={initial.phone} autoComplete="off" />
          </F>
        </div>
        <Check name="active" defaultChecked={initial.active} label="いま委託している（有効）" hint="やめた人は外すと、一覧や選ぶところで後ろに回ります。記録は残ります" />
      </Section>

      <Section title="インボイス">
        <Check
          name="invoiceRegistered"
          checked={registered}
          onChange={setRegistered}
          label="適格請求書発行事業者に登録している"
          hint="登録している方の明細は、仕入明細書として登録番号を載せます"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <F label={registered ? "登録番号（T＋13 桁）" : "登録番号（登録している方だけ）"} error={fe.registrationNo} hint="数字 13 桁だけでも入れられます（T を付けて保存します）">
            <Input name="registrationNo" defaultValue={initial.registrationNo} required={registered} placeholder="T1234567890123" autoComplete="off" />
          </F>
          <F label="公表サイトで確かめた日" error={fe.registrationCheckedOn}>
            <div className="flex gap-2">
              <Input type="date" name="registrationCheckedOn" value={checkedOn} onChange={(e) => setCheckedOn(e.currentTarget.value)} className="min-w-0 flex-1" />
              <button type="button" onClick={() => setCheckedOn(today)} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm hover:bg-muted">
                今日
              </button>
            </div>
          </F>
        </div>
        <p className="text-sm">
          登録の有無は、国税庁の <SourceLink href={sources.invoiceRegistry}>適格請求書発行事業者 公表サイト</SourceLink> で番号を入れて確かめられます。確かめたら日付を残しておくと、見張り番が見直しの時期を知らせます。
        </p>
      </Section>

      <Section title="振込先の口座" description="振込データ（全銀）に使います。カナは半角に直して保存します。">
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="金融機関コード（4 桁）" error={fe.bankCode}>
            <Input name="bankCode" defaultValue={initial.bankCode} inputMode="numeric" maxLength={8} placeholder="例：0001" autoComplete="off" />
          </F>
          <F label="金融機関名（カナ・任意）" error={fe.bankNameKana}>
            <Input name="bankNameKana" value={bankName} onChange={(e) => setBankName(e.currentTarget.value)} placeholder="例：ミズホ" autoComplete="off" />
          </F>
          <F label="支店コード（3 桁）" error={fe.branchCode}>
            <Input name="branchCode" defaultValue={initial.branchCode} inputMode="numeric" maxLength={6} placeholder="例：101" autoComplete="off" />
          </F>
          <F label="支店名（カナ・任意）" error={fe.branchNameKana}>
            <Input name="branchNameKana" value={branchName} onChange={(e) => setBranchName(e.currentTarget.value)} autoComplete="off" />
          </F>
          <F label="預金の種類" error={fe.accountType}>
            <Select name="accountType" defaultValue={initial.accountType}>
              <option value="ordinary">普通</option>
              <option value="checking">当座</option>
            </Select>
          </F>
          <F
            label="口座番号（7 桁まで）"
            error={fe.accountNumber}
            hint={digits && digits.length < 7 && digits.length > 0 ? `7 桁に 0 を足して「${digits.padStart(7, "0")}」で保存します` : undefined}
          >
            <Input name="accountNumber" value={accountNo} onChange={(e) => setAccountNo(e.currentTarget.value)} inputMode="numeric" maxLength={10} autoComplete="off" />
          </F>
        </div>
        <F label="口座名義（カナ）" error={fe.holderKana} hint="通帳の名義どおりに。ひらがな・全角カナでも入れられます">
          <Input name="holderKana" value={holder} onChange={(e) => setHolder(e.currentTarget.value)} placeholder="例：アオキ ショウタ" autoComplete="off" />
        </F>
        {!holder && kana && (
          <button type="button" className="min-h-11 text-sm text-link underline" onClick={() => setHolder(kana)}>
            フリガナ（{kana}）を口座名義に入れる
          </button>
        )}
        <KanaPreview value={holder} label="口座名義は振込データ" />
        <KanaPreview value={bankName} label="金融機関名は振込データ" />
        <KanaPreview value={branchName} label="支店名は振込データ" />
      </Section>

      <Section title="取引の記録（フリーランス法）">
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="取引条件を明示した日" error={fe.termsIssuedOn} hint="業務の内容・報酬の額・支払期日などを書面やメールで渡した日">
            <Input type="date" name="termsIssuedOn" defaultValue={initial.termsIssuedOn} />
          </F>
          <F label="委託を始めた日" error={fe.startedOn}>
            <Input type="date" name="startedOn" defaultValue={initial.startedOn} />
          </F>
          <F label="委託の終了日（決まったら）" error={fe.endOn}>
            <Input type="date" name="endOn" value={endOn} onChange={(e) => setEndOn(e.currentTarget.value)} />
          </F>
          <F label="終了を伝えた日" error={fe.endNoticedOn}>
            <Input type="date" name="endNoticedOn" value={endNoticedOn} onChange={(e) => setEndNoticedOn(e.currentTarget.value)} />
          </F>
        </div>
        {noticeDays !== null && noticeDays >= 0 && (
          <Callout tone={noticeDays >= 30 ? "gray" : "yellow"}>
            終了日の {noticeDays}日前に伝えています。
            {noticeDays < 30 &&
              " 6か月以上続けた委託を終えるときは、30日前までの予告が求められる場合があります（フリーランス法 第16条）。事情の確認をおすすめします。"}{" "}
            <SourceLink href={sources.mhlwFl}>厚労省 フリーランス法（就業環境）</SourceLink>
          </Callout>
        )}
      </Section>

      <Section title="源泉徴収・その他">
        <Check name="isCorporation" defaultChecked={initial.isCorporation} label="法人（会社）として契約している" hint="法人への支払には、報酬の源泉徴収をしません" />
        <F label="源泉徴収の区分" error={fe.withholdingCategory}>
          <Select name="withholdingCategory" value={withholding} onChange={(e) => setWithholding(e.currentTarget.value)}>
            {WITHHOLDING_CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {WITHHOLDING_CATEGORIES[c].label}
              </option>
            ))}
          </Select>
        </F>
        <p className="text-xs text-muted-foreground">
          {info.examples}。区分の判断は税理士にご確認ください。
        </p>
        <F label="メモ（任意）" error={fe.notes}>
          <textarea name="notes" defaultValue={initial.notes} rows={2} maxLength={500} className="block min-h-11 w-full rounded-lg border border-border bg-card px-3 py-2 text-base" />
        </F>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <ResultLine state={state?.ok ? state : undefined} />
        <SubmitRow pending={pending} label={submitLabel} />
      </div>
    </form>
  );
}
