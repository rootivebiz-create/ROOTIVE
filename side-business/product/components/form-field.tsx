"use client";

import {
  cloneElement,
  Fragment,
  isValidElement,
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { cx } from "@/lib/cx";
import type { ActionResult } from "~/server/action";

/**
 * フォームの共通の部品（製品の画面すべてで使う）：入力欄と、その誤りの出し方・送った結果・誤りのある欄へ移ること。
 * 入力の誤り（zod）は Server Action から fieldErrors で返る（server/action.ts の runAction）。
 * - 誤りは赤で入力欄のすぐ下に出し、入力欄に aria-invalid と aria-describedby を付ける（読み上げでも分かるように）
 * - 送った結果の帯（ResultLine）にも、誤りを箇条書きで並べる（長いフォームで、上のほうの誤りに気づけるように）
 * - 送ったあと、誤りのある最初の入力欄へ移る（スマホで画面の外にあっても）
 */

export type FormState = ActionResult<unknown> | undefined;
export type FormAction = (prev: FormState, form: FormData) => Promise<FormState>;

/** 誤りを伝えるときの入力欄の目印（赤い枠） */
const INVALID = "[&_[aria-invalid=true]]:border-danger [&_[aria-invalid=true]]:ring-1 [&_[aria-invalid=true]]:ring-danger";

/** 入力欄（ラベル・入力・ヒント）。error があれば、ヒントの代わりに赤で出し、入力欄に誤りの印を付ける */
export function F({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || hint;
  // 入力欄そのもの（input・select・textarea と、それを包む Input などの部品）にだけ付ける。div などで包んだときは付けない
  const control =
    isValidElement(children) &&
    children.type !== Fragment &&
    (typeof children.type !== "string" || ["input", "select", "textarea"].includes(children.type));
  const child = control
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        "aria-invalid": error ? true : undefined,
        "aria-describedby": note ? noteId : undefined,
      })
    : children;
  return (
    <div className={cx(INVALID, className)}>
      <label className="block">
        <span className="block text-sm font-bold">{label}</span>
        <span className="mt-1 block">{child}</span>
      </label>
      {error ? (
        <p id={noteId} className="mt-1 text-xs font-bold text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** 返ってきた誤り（同じ文は 1 つに） */
export function fieldMessages(state: FormState): string[] {
  if (!state || state.ok || !state.fieldErrors) return [];
  return [...new Set(Object.values(state.fieldErrors).filter(Boolean))];
}

/** 結果を出す（うまくいった・だめだった）。入力の誤りがあれば、その中身も箇条書きで */
export function ResultLine({ state }: { state: FormState }) {
  if (!state) return null;
  if (!state.ok) {
    const messages = fieldMessages(state);
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
  if (!state.message) return null;
  return (
    <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
      {state.message}
    </p>
  );
}

/** 誤りのある最初の入力欄（フォームの中の並び順）へ移る。隠した値だけの誤りなら何もしない */
export function focusFirstError(form: HTMLFormElement | null, names: string[]): HTMLElement | null {
  if (!form || names.length === 0) return null;
  const wanted = new Set(names);
  const target = Array.from(form.querySelectorAll<HTMLElement>("[name]")).find((el) => {
    const name = el.getAttribute("name");
    return !!name && wanted.has(name) && el.getAttribute("type") !== "hidden" && !(el as HTMLInputElement).disabled;
  });
  if (!target) return null;
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: "center", behavior: "smooth" });
  return target;
}

/** 送った結果に入力の誤りがあれば、誤りのある最初の入力欄へ移る（form の action に直接渡すフォーム用） */
export function useFocusFirstError(state: FormState, formRef: RefObject<HTMLFormElement | null>) {
  useEffect(() => {
    if (state && !state.ok && state.fieldErrors) focusFirstError(formRef.current, Object.keys(state.fieldErrors));
  }, [state, formRef]);
}

/**
 * フォームを Server Action で送る。form の action に直接渡すと、React が送ったあとに入力を空に戻すため、
 * 入力の誤りを直すときに打ち直しになる（選んだファイル・チェックも消える）。ここでは onSubmit から送り、入力はそのまま残す。
 * fe：入力欄ごとの誤り（F の error に渡す）
 * resetOnSuccess：うまくいったとき（別の画面へ移ったときも）だけ、フォームを空に戻す（ファイルを上げ直す欄など）。
 *   値を React の state で持つ欄（value を渡す欄）がないフォームでだけ使う
 */
export function useFormAction<S extends ActionResult<unknown> = ActionResult<unknown>>(
  action: (prev: S | undefined, form: FormData) => Promise<S | undefined>,
  opts: { resetOnSuccess?: boolean } = {},
) {
  const [state, dispatch, pending] = useActionState<S | undefined, FormData>(action, undefined);
  const formRef = useRef<HTMLFormElement | null>(null);
  /** 送る前の結果（送ったあとに結果が変わらなければ、別の画面へ移った＝うまくいった） */
  const sent = useRef<{ before: S | undefined } | null>(null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    formRef.current = e.currentTarget;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(e.currentTarget, submitter ?? undefined);
    sent.current = { before: state };
    startTransition(() => dispatch(data));
  };
  const resetOnSuccess = opts.resetOnSuccess === true;
  useEffect(() => {
    if (pending || !sent.current) return;
    const { before } = sent.current;
    sent.current = null;
    const succeeded = state === before || !!state?.ok;
    if (succeeded && resetOnSuccess) formRef.current?.reset();
  }, [pending, state, resetOnSuccess]);
  useFocusFirstError(state, formRef);
  const fe: Record<string, string> = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return { state, pending, onSubmit, fe, formRef };
}
