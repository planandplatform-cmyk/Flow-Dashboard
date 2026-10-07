import { describe, expect, it } from "vitest";
import { compareWindow, periodQuery, presetRange, resolvePeriod, shiftRange } from "./period";

const opts = { today: "2026-10-07", defaultMonth: "2026-07-01" };

describe("presets", () => {
  it("resolves each preset relative to today", () => {
    expect(presetRange("last_30", "2026-10-07")).toEqual({ start: "2026-09-07", end: "2026-10-06" });
    expect(presetRange("this_month", "2026-10-07")).toEqual({ start: "2026-10-01", end: "2026-10-07" });
    expect(presetRange("last_month", "2026-03-15")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(presetRange("qtd", "2026-08-20")).toEqual({ start: "2026-07-01", end: "2026-08-20" });
    expect(presetRange("ytd", "2026-10-07")).toEqual({ start: "2026-01-01", end: "2026-10-07" });
    expect(presetRange("last_12", "2026-10-07")).toEqual({ start: "2025-10-01", end: "2026-09-30" });
  });
});

describe("resolvePeriod", () => {
  it("defaults to the landing month compared with the month before", () => {
    const p = resolvePeriod({}, opts);
    expect(p.range).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    expect(p.month).toBe("2026-07-01");
    expect(p.label).toBe("July 2026");
    expect(p.compareRange).toEqual({ start: "2026-06-01", end: "2026-06-30" });
    expect(p.compareLabel).toBe("June 2026");
  });

  it("reads ?month", () => {
    const p = resolvePeriod({ month: "2026-03" }, opts);
    expect(p.range).toEqual({ start: "2026-03-01", end: "2026-03-31" });
    expect(p.compareRange).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("compares a partial month with the same days of the month before", () => {
    const p = resolvePeriod({ range: "this_month" }, { ...opts, today: "2026-03-31" });
    expect(p.compareRange).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    const q = resolvePeriod({ range: "this_month" }, opts);
    expect(q.compareRange).toEqual({ start: "2026-09-01", end: "2026-09-07" });
  });

  it("compares day ranges with the same number of days just before", () => {
    const p = resolvePeriod({ range: "last_30" }, opts);
    expect(p.compareRange).toEqual({ start: "2026-08-08", end: "2026-09-06" });
  });

  it("compares quarter to date with the previous quarter to the same point", () => {
    const p = resolvePeriod({ range: "qtd" }, { ...opts, today: "2026-11-30" });
    expect(p.range).toEqual({ start: "2026-10-01", end: "2026-11-30" });
    expect(p.compareRange).toEqual({ start: "2026-07-01", end: "2026-08-31" });
  });

  it("supports same period last year, custom comparison and none", () => {
    expect(resolvePeriod({ month: "2026-02", compare: "yoy" }, opts).compareRange).toEqual({ start: "2025-02-01", end: "2025-02-28" });
    const c = resolvePeriod({ month: "2026-07", compare: "custom", cfrom: "2026-01-01", cto: "2026-01-31" }, opts);
    expect(c.compareRange).toEqual({ start: "2026-01-01", end: "2026-01-31" });
    expect(c.compareLabel).toBe("January 2026");
    const n = resolvePeriod({ compare: "none" }, opts);
    expect(n.compareRange).toBeNull();
    expect(n.compareLabel).toBeNull();
  });

  it("treats a custom range of whole months as months", () => {
    const p = resolvePeriod({ range: "custom", from: "2026-04-01", to: "2026-06-30" }, opts);
    expect(p.preset).toBe("custom");
    expect(p.month).toBeNull();
    expect(p.compareRange).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(p.label).toBe("Apr 2026 to Jun 2026");
    expect(resolvePeriod({ range: "custom", from: "2025-12-03", to: "2026-01-09" }, opts).label).toBe("Dec 3, 2025 to Jan 9, 2026");
  });

  it("ignores invalid ranges with a notice", () => {
    for (const params of [
      { range: "custom", from: "2026-07-31", to: "2026-07-01" },
      { range: "custom", from: "2026-02-30", to: "2026-03-01" },
      { range: "custom", from: "2020-01-01", to: "2026-01-01" },
    ]) {
      const p = resolvePeriod(params, opts);
      expect(p.range).toEqual({ start: "2026-07-01", end: "2026-07-31" });
      expect(p.notice).toMatch(/not valid/);
    }
    const c = resolvePeriod({ compare: "custom", cfrom: "nope" }, opts);
    expect(c.compareMode).toBe("previous");
    expect(c.notice).toMatch(/comparison/);
  });
});

describe("other windows", () => {
  it("shifts months calendar-aware", () => {
    expect(shiftRange({ start: "2026-03-31", end: "2026-03-31" }, { months: 1 })).toEqual({ start: "2026-02-28", end: "2026-02-28" });
    expect(shiftRange({ start: "2026-07-14", end: "2026-08-06" }, { months: 12 })).toEqual({ start: "2025-07-14", end: "2025-08-06" });
  });

  it("compares an ad campaign window by the same rule", () => {
    const month = resolvePeriod({}, opts);
    expect(compareWindow(month, { start: "2026-07-14", end: "2026-08-06" })).toEqual({ start: "2026-06-20", end: "2026-07-13" });
    expect(compareWindow(month, month.range)).toEqual(month.compareRange);
    expect(compareWindow(resolvePeriod({ compare: "yoy" }, opts), { start: "2026-07-14", end: "2026-08-06" })).toEqual({
      start: "2025-07-14",
      end: "2025-08-06",
    });
    expect(compareWindow(resolvePeriod({ compare: "none" }, opts), month.range)).toBeNull();
  });

  it("round-trips through the URL", () => {
    for (const params of [
      { month: "2026-05" },
      { range: "ytd", compare: "yoy" },
      { range: "custom", from: "2026-04-03", to: "2026-05-09", compare: "custom", cfrom: "2025-04-03", cto: "2025-05-09" },
    ]) {
      const p = resolvePeriod(params, opts);
      const again = resolvePeriod(Object.fromEntries(new URLSearchParams(periodQuery(p))), opts);
      expect(again.range).toEqual(p.range);
      expect(again.compareRange).toEqual(p.compareRange);
    }
  });
});
