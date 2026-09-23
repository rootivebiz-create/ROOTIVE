"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui";
import { F, ResultLine, SubmitRow, useFormAction, type FormAction } from "./form-kit";

/** 自分のパスワードを変える（今のパスワード・新しいパスワード・もう一度） */
export function PasswordForm({ action, email, minLength }: { action: FormAction; email: string; minLength: number }) {
  const { state, pending, onSubmit, fe } = useFormAction(action);
  const ref = useRef<HTMLFormElement>(null);
  const [show, setShow] = useState(false);
  const [next, setNext] = useState("");
  // 変えたら入力を空に戻す（画面にパスワードを残さない）
  useEffect(() => {
    if (state?.ok) {
      ref.current?.reset();
      setNext("");
    }
  }, [state]);
  const type = show ? "text" : "password";
  const short = next.length > 0 && next.length < minLength;

  return (
    <form ref={ref} onSubmit={onSubmit} className="space-y-3">
      {/* パスワードの管理アプリが、どのアカウントのものか分かるように */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <F label="今のパスワード" error={fe.current}>
        <Input name="current" type={type} autoComplete="current-password" required maxLength={200} />
      </F>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="新しいパスワード" error={fe.next} hint={`${minLength} 文字以上。覚えやすい長めの文がおすすめです`}>
          <Input name="next" type={type} autoComplete="new-password" required minLength={minLength} maxLength={200} value={next} onChange={(e) => setNext(e.currentTarget.value)} />
        </F>
        <F label="新しいパスワード（もう一度）" error={fe.confirm}>
          <Input name="confirm" type={type} autoComplete="new-password" required maxLength={200} />
        </F>
      </div>
      {short && <p className="text-xs text-muted-foreground">あと {minLength - next.length} 文字です。</p>}
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.currentTarget.checked)} className="h-5 w-5 accent-[var(--primary)]" />
        入れた文字を見せる
      </label>
      <ResultLine state={state} />
      <SubmitRow pending={pending} label="パスワードを変える" pendingLabel="変えています…" />
    </form>
  );
}
