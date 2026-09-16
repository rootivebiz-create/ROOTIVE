"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sendMagicLinkAction, sendPasswordResetAction, signInWithPasswordAction, type AuthFormState } from "@/lib/actions/auth";

const initial: AuthFormState = {};

export function LoginForm({ next }: { next: string }) {
  const [magicState, magicAction, magicPending] = useActionState(sendMagicLinkAction, initial);
  const [pwState, pwAction, pwPending] = useActionState(signInWithPasswordAction, initial);
  const [resetState, resetAction, resetPending] = useActionState(sendPasswordResetAction, initial);
  const [email, setEmail] = useState("");

  return (
    <Tabs defaultValue="magic">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="magic">メールでログイン</TabsTrigger>
        <TabsTrigger value="password">パスワード</TabsTrigger>
      </TabsList>
      <TabsContent value="magic">
        <form action={magicAction} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1.5">
            <Label htmlFor="email-magic">メールアドレス</Label>
            <Input id="email-magic" name="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          {magicState.error && <Alert variant="destructive">{magicState.error}</Alert>}
          {magicState.ok && <Alert variant="success">{magicState.message}</Alert>}
          <Button type="submit" className="w-full" size="lg" disabled={magicPending}>
            {magicPending ? "送信中…" : "ログイン用リンクを送る"}
          </Button>
          <p className="text-xs text-muted-foreground">メールに届いたリンクをタップするとログインできます。別の端末で開いても構いません。</p>
        </form>
      </TabsContent>
      <TabsContent value="password">
        <form action={pwAction} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <div className="space-y-1.5">
            <Label htmlFor="email-pw">メールアドレス</Label>
            <Input id="email-pw" name="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">パスワード</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          {pwState.error && <Alert variant="destructive">{pwState.error}</Alert>}
          <Button type="submit" className="w-full" size="lg" disabled={pwPending}>
            {pwPending ? "ログイン中…" : "ログイン"}
          </Button>
        </form>
        <form action={resetAction} className="mt-3">
          <input type="hidden" name="email" value={email} />
          {resetState.error && <Alert variant="destructive" className="mb-2">{resetState.error}</Alert>}
          {resetState.ok && <Alert variant="success" className="mb-2">{resetState.message}</Alert>}
          <Button type="submit" variant="link" size="sm" className="px-0" disabled={resetPending || !email}>
            パスワードを忘れた場合（再設定メールを送る）
          </Button>
        </form>
      </TabsContent>
    </Tabs>
  );
}
