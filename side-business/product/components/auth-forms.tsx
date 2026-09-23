"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { acceptInviteAction, loginAction, setupAction, type FormState } from "~/server/session-actions";

function ErrorBox({ state }: { state: FormState }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      {state.error}
    </p>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
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
  const [state, action, pending] = useActionState(setupAction, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4">
      <ErrorBox state={state} />
      <input type="hidden" name="token" value={token} />
      <Field label="会社名" hint={fe.company}>
        <Input name="company" required placeholder="例：◯◯運送株式会社" />
      </Field>
      <Field label="お名前（オーナー）" hint={fe.name}>
        <Input name="name" required />
      </Field>
      <Field label="メールアドレス" hint={fe.email}>
        <Input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="パスワード（10 文字以上）" hint={fe.password ?? "覚えやすい長めの文がおすすめです"}>
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "作っています…" : "はじめる"}
      </Button>
    </form>
  );
}

export function InviteForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <ErrorBox state={state} />
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted-foreground">{email} としてログインできるようにします。</p>
      <Field label="パスワードを決める（10 文字以上）" hint={state?.fieldErrors?.password}>
        <Input name="password" type="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "設定しています…" : "決めてログイン"}
      </Button>
    </form>
  );
}
