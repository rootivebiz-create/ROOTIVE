import { describe, expect, it } from "vitest";
import { renewedSessionExpiry, SESSION_IDLE_DAYS, SESSION_MAX_DAYS } from "~/server/auth";

const DAY = 24 * 3600 * 1000;

describe("ログインの期限（使っている間は延ばす）", () => {
  const created = new Date("2026-10-01T09:00:00+09:00");

  it("使っていれば 1 日に 1 回まで延ばす（毎回は書き込まない）", () => {
    const first = { createdAt: created, expiresAt: new Date(created.getTime() + SESSION_IDLE_DAYS * DAY) };
    // 同じ日のうちは延ばさない
    expect(renewedSessionExpiry(first, new Date(created.getTime() + 3 * 3600 * 1000))).toBeNull();
    // 次の日に使えば、そこから 14 日
    const nextDay = new Date(created.getTime() + DAY + 60_000);
    expect(renewedSessionExpiry(first, nextDay)).toEqual(new Date(nextDay.getTime() + SESSION_IDLE_DAYS * DAY));
  });

  it("ログインしてから 90 日を超えては延ばさない", () => {
    const late = new Date(created.getTime() + (SESSION_MAX_DAYS - 3) * DAY);
    const session = { createdAt: created, expiresAt: new Date(late.getTime() + 2 * DAY) };
    // 延ばしても 90 日目で止まる
    expect(renewedSessionExpiry(session, late)).toEqual(new Date(created.getTime() + SESSION_MAX_DAYS * DAY));
    const atMax = { createdAt: created, expiresAt: new Date(created.getTime() + SESSION_MAX_DAYS * DAY) };
    expect(renewedSessionExpiry(atMax, new Date(created.getTime() + (SESSION_MAX_DAYS - 1) * DAY))).toBeNull();
  });
});
