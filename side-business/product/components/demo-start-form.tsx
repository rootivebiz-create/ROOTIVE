"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { startDemoAction } from "~/app/demo/start/actions";

/** デモを始めるボタン（押したときだけ、架空の会社を作る） */
export function DemoStartForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(startDemoAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      {state?.error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "架空の会社を作っています…（10 秒ほど）" : "デモを始める"}
      </Button>
    </form>
  );
}
