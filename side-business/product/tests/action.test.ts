import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runAction, UserError } from "~/server/action";
import { friendlyDbError } from "~/server/db-errors";

afterEach(() => vi.restoreAllMocks());

describe("Server Action の包み（runAction）", () => {
  it("入力欄ごとの誤りは fieldErrors に。入力欄の決まらない誤り（1 つの値だけを確かめたとき）は、その文を error に出す", async () => {
    const one = await runAction(async () => z.string().min(3, "3 文字以上にしてください").parse("ab"));
    expect(one).toEqual({ ok: false, error: "3 文字以上にしてください" });

    // zod の既定の文（英語）は出さない
    expect(await runAction(async () => z.string().uuid().parse("x"))).toEqual({ ok: false, error: "入力を確かめてください" });

    const obj = await runAction(async () => z.object({ name: z.string().min(1, "名前を入れてください") }).parse({ name: "" }));
    expect(obj).toEqual({ ok: false, error: "入力を確かめてください", fieldErrors: { name: "名前を入れてください" } });

    const both = await runAction(async () =>
      z
        .object({ a: z.string().min(1, "a を入れてください"), b: z.string() })
        .refine((v) => v.a !== v.b, "a と b は違う値にしてください")
        .parse({ a: "", b: "" }),
    );
    expect(both).toMatchObject({ ok: false, fieldErrors: { a: "a を入れてください" } });
  });

  it("利用者向けのエラーはそのまま。思わぬエラーは日本語にして、ログに 1 行の JSON で残す（探す目印は action failed）", async () => {
    expect(await runAction(async () => Promise.reject(new UserError("この月は締めてあります")))).toEqual({ ok: false, error: "この月は締めてあります" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runAction(async () => Promise.reject(new Error("boom", { cause: { message: "duplicate key value violates unique constraint", code: "23505" } })));
    expect(r).toEqual({ ok: false, error: "同じものがすでに登録されています。" });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(String(spy.mock.calls[0][0]));
    expect(logged).toMatchObject({ level: "error", event: "action failed", name: "Error", code: "23505" });
    expect(logged.message).toContain("duplicate key");
  });

  it("締めた月のエラーは、だれが・どこで外すかまで書く", () => {
    expect(friendlyDbError(new Error("MONTH_CLOSED"))).toBe("この月は締め済みです。直すときは、オーナーが「締め」の画面で締めを外してください。");
  });
});
