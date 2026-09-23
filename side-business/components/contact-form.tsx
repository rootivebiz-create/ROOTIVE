"use client";

/**
 * 相談フォーム。入力は送る前に lib/contact.ts の同じ決まりで確かめ、/api/contact に送る。
 * 入力の中身は端末に保存しない。送れないとき（準備中・送信の失敗）は、メールの下書きで送れるようにする。
 */
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Input, Select, buttonClass } from "@/components/ui";
import {
  CONTACT_TEXT,
  DRIVER_OPTIONS,
  LIMITS,
  TOPIC_OPTIONS,
  mailtoHref,
  validateInquiry,
  type FieldErrors,
  type Inquiry,
  type InquiryField,
} from "@/lib/contact";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type FormState = {
  company: string;
  name: string;
  email: string;
  phone: string;
  drivers: string;
  topics: string[];
  message: string;
  agree: boolean;
  website: string;
};

const EMPTY: FormState = {
  company: "",
  name: "",
  email: "",
  phone: "",
  drivers: "",
  topics: [],
  message: "",
  agree: false,
  website: "",
};

/** 誤りがあったとき、先頭から順にカーソルを移す欄 */
const FIELD_ORDER: InquiryField[] = ["company", "name", "email", "phone", "drivers", "topics", "message", "agree"];

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; email: string }
  | { kind: "error"; message: string; draft: Inquiry | null };

function Badge({ required }: { required: boolean }) {
  return required ? (
    <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-bold leading-none text-accent-foreground">必須</span>
  ) : (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs leading-none text-muted-foreground">任意</span>
  );
}

function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm font-bold text-danger">
      {message}
    </p>
  );
}

function Row({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-bold">
        {label}
        <Badge required={required} />
      </label>
      <div className="mt-1">{children}</div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <ErrorText id={`${id}-error`} message={error} />
    </div>
  );
}

const invalidClass = "border-danger focus:border-danger";

export function ContactForm({
  fallbackEmail,
  bookingUrl,
}: {
  /** 送れないときに出すメールの宛先（NEXT_PUBLIC_CONTACT_EMAIL） */
  fallbackEmail: string | null;
  /** 送れないときに出す予約ページ */
  bookingUrl: string | null;
}) {
  const uid = useId();
  const id = (field: string) => `${uid}-${field}`;
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const sending = status.kind === "sending";

  useEffect(() => {
    if (status.kind === "done") doneRef.current?.focus();
  }, [status.kind]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function toggleTopic(topic: string, on: boolean) {
    const next = on ? [...form.topics, topic] : form.topics.filter((t) => t !== topic);
    update("topics", next);
  }

  function focusFirstError(found: FieldErrors) {
    const first = FIELD_ORDER.find((f) => found[f]);
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`);
    el?.focus();
  }

  function showError(message: string, draft: Inquiry | null) {
    setStatus({ kind: "error", message, draft });
    // 読み上げと画面の両方で気づけるよう、知らせの位置へ移る
    requestAnimationFrame(() => alertRef.current?.focus());
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (sending) return;

    // おとりの欄は画面では確かめない（機械に気づかせない）。サーバーが判断する
    const checked = validateInquiry({ ...form, website: "" });
    if (!checked.ok) {
      setErrors(checked.errors);
      setStatus({ kind: "idle" });
      focusFirstError(checked.errors);
      return;
    }
    setErrors({});
    setStatus({ kind: "sending" });

    let res: Response;
    try {
      res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    } catch {
      showError(CONTACT_TEXT.network, checked.data);
      return;
    }

    const data = (await res.json().catch(() => ({}))) as { error?: unknown; fieldErrors?: FieldErrors };
    if (res.ok) {
      setStatus({ kind: "done", email: checked.data.email });
      setForm(EMPTY);
      return;
    }
    const message = typeof data.error === "string" ? data.error : CONTACT_TEXT.failed;
    if (res.status === 400 && data.fieldErrors && typeof data.fieldErrors === "object") {
      setErrors(data.fieldErrors);
      setStatus({ kind: "idle" });
      focusFirstError(data.fieldErrors);
      return;
    }
    // 準備中（503）・送信の失敗（502 など）はメールの下書きでも送れるようにする
    showError(message, res.status >= 500 ? checked.data : null);
  }

  if (status.kind === "done") {
    return (
      <div
        ref={doneRef}
        tabIndex={-1}
        role="status"
        className="rounded-card border-2 border-success bg-card p-5 outline-none"
      >
        <p className="text-lg font-bold text-success">{CONTACT_TEXT.success}</p>
        <p className="mt-2 text-sm">
          <span className="break-all font-bold">{status.email}</span> あてにお送りします。届かないときは、迷惑メールのフォルダも見てください。
        </p>
        {bookingUrl && (
          <p className="mt-4">
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "w-full sm:w-auto")}>
              カレンダーから日時も選んでおく
            </a>
          </p>
        )}
        <p className="mt-4 text-sm">
          <Link href="/demo">待つあいだにデモをさわる</Link>
        </p>
      </div>
    );
  }

  const describedBy = (field: InquiryField, hint = false) =>
    [hint ? `${id(field)}-hint` : null, errors[field] ? `${id(field)}-error` : null].filter(Boolean).join(" ") || undefined;
  const invalid = (field: InquiryField) => (errors[field] ? true : undefined);
  const hasErrors = FIELD_ORDER.some((f) => errors[f]);

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} aria-busy={sending || undefined} className="space-y-5">
      {hasErrors && (
        <p className="rounded-lg border border-danger bg-card px-3 py-2 text-sm font-bold text-danger">{CONTACT_TEXT.invalid}</p>
      )}

      <fieldset disabled={sending} className="space-y-5">
        <Row id={id("company")} label="会社名" required error={errors.company}>
          <Input
            id={id("company")}
            name="company"
            autoComplete="organization"
            maxLength={LIMITS.company}
            required
            value={form.company}
            onChange={(e) => update("company", e.target.value)}
            aria-invalid={invalid("company")}
            aria-describedby={describedBy("company")}
            className={cx(errors.company && invalidClass)}
          />
        </Row>

        <Row id={id("name")} label="お名前" required error={errors.name}>
          <Input
            id={id("name")}
            name="name"
            autoComplete="name"
            maxLength={LIMITS.name}
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            aria-invalid={invalid("name")}
            aria-describedby={describedBy("name")}
            className={cx(errors.name && invalidClass)}
          />
        </Row>

        <Row id={id("email")} label="メールアドレス" required hint="お返事はこのアドレスにお送りします。" error={errors.email}>
          <Input
            id={id("email")}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={LIMITS.email}
            required
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            aria-invalid={invalid("email")}
            aria-describedby={describedBy("email", true)}
            className={cx(errors.email && invalidClass)}
          />
        </Row>

        <Row id={id("phone")} label="電話番号" required={false} hint="数字とハイフンで。電話でのご連絡がよければ入れてください。" error={errors.phone}>
          <Input
            id={id("phone")}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={LIMITS.phone}
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            aria-invalid={invalid("phone")}
            aria-describedby={describedBy("phone", true)}
            className={cx(errors.phone && invalidClass)}
          />
        </Row>

        <Row id={id("drivers")} label="業務委託ドライバーの人数" required error={errors.drivers}>
          <Select
            id={id("drivers")}
            name="drivers"
            required
            value={form.drivers}
            onChange={(e) => update("drivers", e.target.value)}
            aria-invalid={invalid("drivers")}
            aria-describedby={describedBy("drivers")}
            className={cx(errors.drivers && invalidClass)}
          >
            <option value="">選んでください</option>
            {DRIVER_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        </Row>

        <fieldset aria-describedby={errors.topics ? `${id("topics")}-error` : undefined}>
          <legend className="flex items-center gap-2 text-sm font-bold">
            相談したいこと
            <Badge required={false} />
            <span className="font-normal text-muted-foreground">（いくつでも）</span>
          </legend>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TOPIC_OPTIONS.map((t) => (
              <label
                key={t}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm has-[:checked]:border-foreground has-[:checked]:font-bold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground"
              >
                <input
                  type="checkbox"
                  name="topics"
                  value={t}
                  checked={form.topics.includes(t)}
                  onChange={(e) => toggleTopic(t, e.target.checked)}
                  className="size-5 shrink-0 accent-primary"
                />
                {t}
              </label>
            ))}
          </div>
          <ErrorText id={`${id("topics")}-error`} message={errors.topics} />
        </fieldset>

        <div>
          <label htmlFor={id("message")} className="flex items-center gap-2 text-sm font-bold">
            ご相談の内容
            <Badge required={false} />
          </label>
          <textarea
            id={id("message")}
            name="message"
            rows={6}
            maxLength={LIMITS.message}
            value={form.message}
            onChange={(e) => update("message", e.target.value)}
            placeholder="例：ドライバーは12人。支払明細を Excel で作っていて、月末に2日かかっています。"
            aria-invalid={invalid("message")}
            aria-describedby={describedBy("message", true)}
            className={cx(
              "mt-1 block min-h-32 w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground outline-none focus:border-foreground",
              errors.message && invalidClass,
            )}
          />
          <p id={`${id("message")}-hint`} className="mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
            <span>いまの困りごとを一言でも。空欄でも大丈夫です。</span>
            <span className="num shrink-0">
              {form.message.length} / {LIMITS.message}
            </span>
          </p>
          <ErrorText id={`${id("message")}-error`} message={errors.message} />
        </div>

        {/* おとりの欄（人には見えない・読み上げない） */}
        <div aria-hidden="true" className="sr-only">
          <label htmlFor={id("website")}>この欄は空のままにしてください</label>
          <input
            id={id("website")}
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => update("website", e.target.value)}
          />
        </div>

        <div>
          <label
            className={cx(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground",
              errors.agree ? "border-danger" : "border-border",
            )}
          >
            <input
              type="checkbox"
              name="agree"
              required
              checked={form.agree}
              onChange={(e) => update("agree", e.target.checked)}
              aria-invalid={invalid("agree")}
              aria-describedby={errors.agree ? `${id("agree")}-error` : undefined}
              className="size-5 shrink-0 accent-primary"
            />
            <span>
              <a href="/legal/privacy" target="_blank" rel="noopener">
                プライバシーポリシー
              </a>
              に同意します
              <span className="ml-2 align-middle">
                <Badge required />
              </span>
            </span>
          </label>
          <ErrorText id={`${id("agree")}-error`} message={errors.agree} />
        </div>
      </fieldset>

      {status.kind === "error" && (
        <div
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="rounded-card border-2 border-danger bg-card p-4 outline-none"
        >
          <p className="font-bold text-danger">{status.message}</p>
          {status.draft && (fallbackEmail || bookingUrl) && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              {fallbackEmail && (
                <a href={mailtoHref(fallbackEmail, status.draft)} className={buttonClass("secondary")}>
                  入力した内容をメールで送る
                </a>
              )}
              {bookingUrl && (
                <a href={bookingUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary")}>
                  カレンダーから日時を選ぶ
                </a>
              )}
            </div>
          )}
          {status.draft && fallbackEmail && (
            <p className="mt-2 text-xs text-muted-foreground">
              メールのアプリが開き、入力した内容が下書きに入ります。宛先：<span className="break-all">{fallbackEmail}</span>
            </p>
          )}
        </div>
      )}

      <Button type="submit" disabled={sending} className="w-full text-base sm:w-auto sm:min-w-64">
        {sending ? "送信しています…" : "相談を申し込む（無料）"}
      </Button>
    </form>
  );
}
