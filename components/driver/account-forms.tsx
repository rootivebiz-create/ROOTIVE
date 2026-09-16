"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateDisplayNameAction, updatePasswordAction, type AuthFormState } from "@/lib/actions/auth";

const initial: AuthFormState = {};

/** 表示名の変更とパスワード設定（ドライバー本人） */
export function AccountForms({ displayName, email }: { displayName: string; email: string }) {
  const router = useRouter();
  const [nameState, nameAction, namePending] = useActionState(updateDisplayNameAction, initial);
  const [pwState, pwAction, pwPending] = useActionState(updatePasswordAction, initial);

  // 表示名の更新後はヘッダーの表示名も更新する
  useEffect(() => {
    if (nameState.ok) router.refresh();
  }, [nameState, router]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>表示名</CardTitle>
          <CardDescription>画面上部に表示される名前です。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={nameAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="account-email">メールアドレス</Label>
              <Input id="account-email" value={email} readOnly disabled />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display_name">表示名</Label>
              <Input id="display_name" name="display_name" defaultValue={displayName} maxLength={50} required autoComplete="nickname" />
            </div>
            {nameState.error && <Alert variant="destructive">{nameState.error}</Alert>}
            {nameState.ok && <Alert variant="success">{nameState.message}</Alert>}
            <Button type="submit" disabled={namePending}>
              {namePending ? "保存中…" : "表示名を保存"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>パスワード</CardTitle>
          <CardDescription>設定すると、メールのリンクの代わりにパスワードでもログインできます。</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={pwAction} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="password">新しいパスワード（8 文字以上）</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password_confirm">新しいパスワード（確認）</Label>
              <Input id="password_confirm" name="password_confirm" type="password" autoComplete="new-password" minLength={8} required />
            </div>
            {pwState.error && <Alert variant="destructive">{pwState.error}</Alert>}
            {pwState.ok && <Alert variant="success">{pwState.message}</Alert>}
            <Button type="submit" disabled={pwPending}>
              {pwPending ? "設定中…" : "パスワードを設定"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
