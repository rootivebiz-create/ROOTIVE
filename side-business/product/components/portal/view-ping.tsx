"use client";

import { useEffect } from "react";
import { recordViewAction } from "~/app/s/actions";

/**
 * ブラウザで開かれたときだけ「開いた」を記録する（LINE などのリンクの下見は JavaScript を動かさないので数えない）。
 */
export function ViewPing({ token }: { token: string }) {
  useEffect(() => {
    void recordViewAction(token);
  }, [token]);
  return null;
}
