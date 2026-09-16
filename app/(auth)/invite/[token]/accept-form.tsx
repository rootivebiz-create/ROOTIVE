"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { acceptInviteAction, type AuthFormState } from "@/lib/actions/auth";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, {} as AuthFormState);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state.error && <Alert variant="destructive">{state.error}</Alert>}
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? "ログイン中…" : "ログインして始める"}
      </Button>
      <p className="text-xs text-muted-foreground">このリンクは 1 回だけ使えます。次回からはログイン画面でメールアドレスを入力してください（パスワードは後から設定できます）。</p>
    </form>
  );
}
