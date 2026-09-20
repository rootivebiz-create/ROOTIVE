"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveCompanyProfileAction, type CompanyProfileInput } from "@/lib/actions/executive";
import { companyProfileSchema } from "@/lib/schemas/executive";
import type { CompanyProfile } from "@/lib/db/types";
import { FieldError, toFieldErrors, type FieldErrors } from "./field-error";

interface FormState {
  corporateNumber: string;
  establishedOn: string;
  capital: string;
  registeredAddress: string;
  representativeName: string;
  businessPurpose: string;
  transportOffice: string;
  transportNumber: string;
  transportNotifiedOn: string;
  laborInsuranceNumber: string;
  socialInsuranceNumber: string;
  memo: string;
}

function initialForm(profile: CompanyProfile | null): FormState {
  return {
    corporateNumber: profile?.corporate_number ?? "",
    establishedOn: profile?.established_on ?? "",
    capital: profile?.capital == null ? "" : String(profile.capital),
    registeredAddress: profile?.registered_address ?? "",
    representativeName: profile?.representative_name ?? "",
    businessPurpose: profile?.business_purpose ?? "",
    transportOffice: profile?.transport_office ?? "",
    transportNumber: profile?.transport_number ?? "",
    transportNotifiedOn: profile?.transport_notified_on ?? "",
    laborInsuranceNumber: profile?.labor_insurance_number ?? "",
    socialInsuranceNumber: profile?.social_insurance_number ?? "",
    memo: profile?.memo ?? "",
  };
}

/**
 * 会社の基本情報（/executive/company?tab=basic）。
 * 支払明細に印字する会社名・住所は「設定 / 会社設定」にある。ここは登記・許認可・社会保険の控え。
 */
export function CompanyProfileForm({ profile }: { profile: CompanyProfile | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>(() => initialForm(profile));
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const buildInput = (): CompanyProfileInput => ({
    corporate_number: form.corporateNumber,
    established_on: form.establishedOn,
    capital: form.capital,
    registered_address: form.registeredAddress,
    representative_name: form.representativeName,
    business_purpose: form.businessPurpose,
    transport_office: form.transportOffice,
    transport_number: form.transportNumber,
    transport_notified_on: form.transportNotifiedOn,
    labor_insurance_number: form.laborInsuranceNumber,
    social_insurance_number: form.socialInsuranceNumber,
    memo: form.memo,
  });

  const submit = () => {
    const input = buildInput();
    const parsed = companyProfileSchema.safeParse(input);
    if (!parsed.success) {
      const fe = toFieldErrors(parsed.error.issues);
      setErrors(fe);
      toast.error(Object.values(fe)[0]?.[0] ?? "入力内容を確認してください。");
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await saveCompanyProfileAction(input);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "保存しました");
      router.refresh();
    });
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending}>
          <Save /> {pending ? "保存中…" : "保存"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>登記のこと</CardTitle>
          <CardDescription>融資の申し込みや契約のときに毎回聞かれる情報です。ここに控えておくと探さずに済みます。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-corporate">法人番号（13 桁）</Label>
              <NumberInput
                id="profile-corporate"
                decimal={false}
                value={form.corporateNumber}
                onChange={(e) => set({ corporateNumber: e.target.value })}
                placeholder="1234567890123"
                maxLength={13}
                disabled={pending}
                aria-invalid={!!errors.corporate_number}
              />
              <FieldError errors={errors} name="corporate_number" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-established">設立日</Label>
              <Input id="profile-established" type="date" value={form.establishedOn} onChange={(e) => set({ establishedOn: e.target.value })} disabled={pending} aria-invalid={!!errors.established_on} />
              <FieldError errors={errors} name="established_on" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-capital">資本金（円）</Label>
              <NumberInput id="profile-capital" value={form.capital} onChange={(e) => set({ capital: e.target.value })} placeholder="1,000,000" disabled={pending} aria-invalid={!!errors.capital} />
              <FieldError errors={errors} name="capital" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-representative">代表者名</Label>
              <Input id="profile-representative" value={form.representativeName} onChange={(e) => set({ representativeName: e.target.value })} maxLength={200} disabled={pending} />
              <FieldError errors={errors} name="representative_name" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-address">本店所在地（登記の住所）</Label>
            <Input id="profile-address" value={form.registeredAddress} onChange={(e) => set({ registeredAddress: e.target.value })} maxLength={200} disabled={pending} />
            <FieldError errors={errors} name="registered_address" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-purpose">事業目的</Label>
            <Textarea id="profile-purpose" value={form.businessPurpose} onChange={(e) => set({ businessPurpose: e.target.value })} rows={3} placeholder="貨物軽自動車運送事業、…" disabled={pending} />
            <FieldError errors={errors} name="business_purpose" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>運送事業の届出</CardTitle>
          <CardDescription>貨物軽自動車運送事業の経営届出のことです。営業所を増やすときにも使います。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="profile-office">届出先の運輸支局</Label>
              <Input id="profile-office" value={form.transportOffice} onChange={(e) => set({ transportOffice: e.target.value })} placeholder="関東運輸局 東京運輸支局" maxLength={200} disabled={pending} />
              <FieldError errors={errors} name="transport_office" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-number">届出番号</Label>
              <Input id="profile-number" value={form.transportNumber} onChange={(e) => set({ transportNumber: e.target.value })} maxLength={200} disabled={pending} />
              <FieldError errors={errors} name="transport_number" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-notified">届出日</Label>
              <Input
                id="profile-notified"
                type="date"
                value={form.transportNotifiedOn}
                onChange={(e) => set({ transportNotifiedOn: e.target.value })}
                disabled={pending}
                aria-invalid={!!errors.transport_notified_on}
              />
              <FieldError errors={errors} name="transport_notified_on" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>社会保険・労働保険</CardTitle>
          <CardDescription>手続きのときに使う番号です。マイナンバーなど個人の情報はここに入れないでください。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="profile-labor">労働保険番号</Label>
              <Input id="profile-labor" value={form.laborInsuranceNumber} onChange={(e) => set({ laborInsuranceNumber: e.target.value })} maxLength={200} disabled={pending} />
              <FieldError errors={errors} name="labor_insurance_number" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profile-social">社会保険の事業所整理記号</Label>
              <Input id="profile-social" value={form.socialInsuranceNumber} onChange={(e) => set({ socialInsuranceNumber: e.target.value })} maxLength={200} disabled={pending} />
              <FieldError errors={errors} name="social_insurance_number" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-memo">メモ（任意）</Label>
            <Textarea id="profile-memo" value={form.memo} onChange={(e) => set({ memo: e.target.value })} rows={3} disabled={pending} />
            <FieldError errors={errors} name="memo" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending}>
          <Save /> {pending ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}
