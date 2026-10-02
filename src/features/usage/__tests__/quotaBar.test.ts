import { describe, expect, it } from "vitest";
import type { QuotaFile } from "../../../tap/statusline";
import { quotaBar } from "../quotaBar";

const H = 3_600_000;
const now = new Date(2026, 9, 1, 12, 0).getTime();
const q = (
  five: number | null,
  seven: number | null,
  over: Partial<QuotaFile> = {},
): QuotaFile => ({
  v: 1,
  updatedAt: now - 60_000,
  sessionId: null,
  model: null,
  contextPct: null,
  costUsd: null,
  fiveHour: five === null ? null : { pct: five, resetsAt: now + 2 * H },
  sevenDay: seven === null ? null : { pct: seven, resetsAt: now + 50 * H },
  spendLimit: null,
  ...over,
});

describe("quotaBar (the status bar item)", () => {
  it("shows both windows, rounded", () => {
    const b = quotaBar(q(72.4, 40.6), now)!;
    expect(b.text).toBe("$(sparkle) 5h 72% · 7d 41%");
    expect(b.level).toBe("normal");
  });

  it("turns yellow at 75% and red at 90%, whichever window is higher, and back to normal", () => {
    expect(quotaBar(q(80, 10), now)!.level).toBe("warning");
    expect(quotaBar(q(10, 92), now)!.level).toBe("error");
    expect(quotaBar(q(10, 20), now)!.level).toBe("normal");
  });

  it("says a window reset instead of showing an old number", () => {
    const b = quotaBar(q(95, 30, { fiveHour: { pct: 95, resetsAt: now - 1000 } }), now)!;
    expect(b.text).toBe("$(sparkle) 5h reset · 7d 30%");
    expect(b.level).toBe("normal");
    expect(b.tooltip).toContain("5-hour limit: reset since Claude last reported it");
  });

  it("explains each window, when it resets, how fresh it is, and what to do near the limit", () => {
    const b = quotaBar(q(91, 40), now)!;
    expect(b.tooltip).toMatch(/^5-hour limit: 91% used · resets 2:00 PM/);
    expect(b.tooltip).toMatch(/Weekly limit: 40% used · resets \w{3} 2:00 PM/);
    expect(b.tooltip).toMatch(/As of Claude Code's last reply at 11:59 AM\./);
    expect(b.tooltip).toMatch(/claude\.ai → Settings → Usage/);
    expect(b.tooltip).toMatch(/Click to see your plan limits in Orbit\.$/);
  });

  it("hides when Claude hasn't reported any limits", () => {
    expect(quotaBar(null, now)).toBeNull();
    expect(quotaBar(q(null, null), now)).toBeNull();
  });
});
