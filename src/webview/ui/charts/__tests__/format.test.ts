import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatPct,
  formatResetIn,
  formatTokens,
  heatBucket,
  meterLevel,
} from "../format";

describe("formatCost", () => {
  it.each([
    [null, "—"],
    [0, "$0"],
    [0.004, "<$0.01"],
    [0.5, "$0.50"],
    [12.345, "$12.35"],
    [1234.5, "$1,235"],
    [98765.4, "$98.8K"],
  ])("%s → %s", (v, want) => {
    expect(formatCost(v)).toBe(want);
  });
});

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1234, "1.2K"],
    [12_900, "12.9K"],
    [3_400_000, "3.4M"],
    [1_250_000_000, "1.25B"],
  ])("%s → %s", (v, want) => {
    expect(formatTokens(v)).toBe(want);
  });
});

describe("formatPct", () => {
  it("rounds and clamps for display", () => {
    expect(formatPct(0.3842)).toBe("38%");
    expect(formatPct(0.004)).toBe("<1%");
    expect(formatPct(0)).toBe("0%");
  });
});

describe("formatResetIn", () => {
  const now = 1_000_000_000_000;
  it.each([
    [now + 30_000, "Resets in <1m"],
    [now + 14 * 60_000, "Resets in 14m"],
    [now + (2 * 60 + 14) * 60_000, "Resets in 2h 14m"],
    [now + (3 * 24 + 5) * 3600_000, "Resets in 3d 5h"],
    [now - 1, "Reset due"],
  ])("%s", (t, want) => {
    expect(formatResetIn(t, now)).toBe(want);
  });
});

describe("meterLevel", () => {
  it("maps usage to calm, warning and critical", () => {
    expect(meterLevel(10)).toBe("ok");
    expect(meterLevel(74.9)).toBe("ok");
    expect(meterLevel(75)).toBe("warn");
    expect(meterLevel(90)).toBe("critical");
    expect(meterLevel(130)).toBe("critical");
  });
});

describe("heatBucket", () => {
  it("puts zero in bucket 0 and splits the rest into four quantiles", () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    expect(values.map((v) => heatBucket(v, values))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("uses the darkest step when every active day is the same", () => {
    expect(heatBucket(5, [0, 5, 5])).toBe(4);
  });
});
