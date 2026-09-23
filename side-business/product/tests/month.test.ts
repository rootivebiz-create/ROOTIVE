import { describe, expect, it } from "vitest";
import { monthFromParam, monthLabelJa, shiftMonth } from "~/server/month";

describe("月の扱い", () => {
  it("?m=YYYY-MM を月初日にする。無い・壊れているときは先月", () => {
    expect(monthFromParam("2026-10")).toBe("2026-10-01");
    expect(monthFromParam(["2026-02"])).toBe("2026-02-01");
    expect(monthFromParam("2026-13", new Date("2026-01-15T00:00:00Z"))).toBe("2025-12-01");
    expect(monthFromParam(undefined, new Date("2026-10-05T00:00:00Z"))).toBe("2026-09-01");
  });
  it("月を進める・戻す、日本語の表記", () => {
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(monthLabelJa("2026-10-01")).toBe("2026年10月");
  });
});
