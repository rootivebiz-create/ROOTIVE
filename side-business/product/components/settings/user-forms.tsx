"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Input, Select } from "@/components/ui";
import type { ActionResult } from "~/server/action";
import { ROLE_HELP, ROLE_LABEL } from "~/server/features/settings/format";
import { F, ResultLine, SubmitRow, useFormAction, type FormAction } from "./form-kit";

type Role = keyof typeof ROLE_LABEL;
const ROLES: Role[] = ["owner", "staff", "viewer"];

/** 役割を変える（選んで「変える」） */
export function RoleForm({ action, id, role, self, name }: { action: FormAction; id: string; role: Role; self: boolean; name: string }) {
  const { state, pending, onSubmit } = useFormAction(action);
  const [next, setNext] = useState<Role>(role);
  const demoteSelf = self && role === "owner" && next !== "owner";
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 basis-40">
          <span className="sr-only">{name}さんの役割</span>
          <Select name="role" value={next} onChange={(e) => setNext(e.currentTarget.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}（{ROLE_HELP[r]}）
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary" disabled={pending || next === role}>
          {pending ? "変えています…" : "役割を変える"}
        </Button>
      </div>
      {demoteSelf && <p className="text-xs font-bold text-warning">自分をオーナーから外すと、この画面（利用者）と会社の設定は開けなくなります。</p>}
      <ResultLine state={state} />
    </form>
  );
}

type InviteData = { url: string; email: string; name: string; expiresAt: string; reactivates: boolean };
type InviteState = ActionResult<InviteData> | undefined;

/** 招待：リンクを作って画面に出す（メールは送らない。7 日で切れる） */
export function InviteForm({ action }: { action: (prev: InviteState, form: FormData) => Promise<InviteState> }) {
  const [state, dispatch, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [copied, setCopied] = useState(false);
  const fe = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const data = state?.ok ? state.data : undefined;
  useEffect(() => {
    if (state?.ok) {
      ref.current?.reset();
      setCopied(false);
    }
  }, [state]);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-3">
      <form ref={ref} onSubmit={onSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="お名前" error={fe.name}>
            <Input name="name" required maxLength={50} autoComplete="off" />
          </F>
          <F label="メールアドレス" error={fe.email} hint="ログインに使います。メールは送りません">
            <Input name="email" type="email" required autoComplete="off" />
          </F>
        </div>
        <F label="役割" error={fe.role}>
          <Select name="role" defaultValue="staff">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}（{ROLE_HELP[r]}）
              </option>
            ))}
          </Select>
        </F>
        {state && !state.ok && <ResultLine state={state} />}
        <SubmitRow pending={pending} label="招待のリンクを作る" pendingLabel="作っています…" />
      </form>
      {data && (
        <div className="space-y-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm" role="status">
          <p className="font-bold text-success">{data.name}さん（{data.email}）への招待のリンクです。</p>
          <p>
            このリンクは今だけ表示します（あとから見ることはできません）。LINE やメールでご本人に送ってください。7 日で使えなくなります。
            {data.reactivates && " この方は止めていた利用者なので、リンクからパスワードを決めると再開します。"}
          </p>
          <div className="flex flex-wrap gap-2">
            <input readOnly value={data.url} onFocus={(e) => e.currentTarget.select()} className="block min-h-11 min-w-0 flex-1 basis-56 rounded-lg border border-border bg-card px-3 text-sm" aria-label="招待のリンク" />
            <Button onClick={copy} variant="primary">
              {copied ? "コピーしました" : "コピー"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
