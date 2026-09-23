"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";
import { F, focusFirstError } from "~/components/form-field";
import { acceptInviteAction, loginAction, setupAction, type FormState } from "~/server/session-actions";

/** 誤りの帯（入力欄ごとの誤りも箇条書きで） */
function ErrorBox({ state }: { state: FormState }) {
  if (!state?.error) return null;
  const messages = [...new Set(Object.values(state.fieldErrors ?? {}).filter(Boolean))];
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      <p>{state.error}</p>
      {messages.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 送る（onSubmit から）。form の action に直接渡すと、React が送ったあとに入力を空に戻すため、
 * パスワードを打ち間違えただけでメールアドレスや会社名まで消えてしまう。ここでは入力をそのまま残す。
 * 送ったあと、誤りのある最初の入力欄へ移る
 */
function useAuthForm(action: (prev: FormState, form: FormData) => Promise<FormState>) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
  useEffect(() => {
    if (state?.fieldErrors) focusFirstError(ref.current, Object.keys(state.fieldErrors));
  }, [state]);
  // action も渡しておく（JavaScript が動かないときも送れる。動くときは onSubmit が先に受け取るので二重には送らない）
  return { state, pending, onSubmit, ref, action: dispatch };
}

export function LoginForm() {
  const { state, pending, onSubmit, ref, action } = useAuthForm(loginAction);
  return (
    <form ref={ref} action={action} onSubmit={onSubmit} className="space-y-4">
      <ErrorBox state={state} />
      <Field label="メールアドレス">
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="パスワード">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "確かめています…" : "ログイン"}
      </Button>
    </form>
  );
}

export function SetupForm({ token }: { token: string }) {
  const { state, pending, onSubmit, ref, action } = useAuthForm(setupAction);
  const fe = state?.fieldErrors ?? {};
  return (
    <form ref={ref} action={action} onSubmit={onSubmit} className="space-y-4">
      <ErrorBox state={state} />
      <input type="hidden" name="token" value={token} />
      <F label="会社名" error={fe.company}>
        <Input name="company" required placeholder="例：◯◯運送株式会社" />
      </F>
      <F label="お名前（オーナー）" error={fe.name}>
        <Input name="name" required />
      </F>
      <F label="メールアドレス" error={fe.email}>
        <Input name="email" type="email" autoComplete="email" required />
      </F>
      <F label="パスワード（10 文字以上）" error={fe.password} hint="覚えやすい長めの文がおすすめです">
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </F>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "作っています…" : "はじめる"}
      </Button>
    </form>
  );
}

export function InviteForm({ token, email }: { token: string; email: string }) {
  const { state, pending, onSubmit, ref, action } = useAuthForm(acceptInviteAction);
  return (
    <form ref={ref} action={action} onSubmit={onSubmit} className="space-y-4">
      <ErrorBox state={state} />
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted-foreground">{email} としてログインできるようにします。</p>
      <F label="パスワードを決める（10 文字以上）" error={state?.fieldErrors?.password}>
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </F>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "設定しています…" : "決めてログイン"}
      </Button>
    </form>
  );
}
