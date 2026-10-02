import { describe, expect, it } from "vitest";
import { FIVE_HOURS, pace, paceText, WEEK } from "../pace";

const H = 3_600_000;
const D = 24 * H;

describe("pace", () => {
  it("projects the weekly use from how far into the week you are", () => {
    // 3.5 days in, 40% used → 80% by the end: enough.
    const p = pace({ pct: 40, resetsAt: 3.5 * D }, 0, WEEK)!;
    expect(p.projected).toBeCloseTo(80);
    expect(p.verdict).toBe("under");
    expect(p.exhaustsAt).toBeNull();
  });

  it("says when you'll run out at this rate", () => {
    // 2 days in, 50% used → 175% projected; 100% after 4 days, i.e. 2 days from now.
    const p = pace({ pct: 50, resetsAt: 5 * D }, 0, WEEK)!;
    expect(p.verdict).toBe("ahead");
    expect(p.projected).toBeCloseTo(175);
    expect(p.exhaustsAt).toBeCloseTo(2 * D);
  });

  it("calls 90–110% on track", () => {
    expect(pace({ pct: 50, resetsAt: 3.5 * D }, 0, WEEK)!.verdict).toBe("on-track");
  });

  it("waits until enough of the window has passed to judge", () => {
    expect(pace({ pct: 5, resetsAt: 7 * D - 2 * H }, 0, WEEK)).toBeNull();
    expect(pace({ pct: 5, resetsAt: 0 }, 0, WEEK)).toBeNull();
    // The 5-hour window needs half an hour.
    expect(pace({ pct: 10, resetsAt: 4.75 * H }, 0, FIVE_HOURS)).toBeNull();
    expect(pace({ pct: 10, resetsAt: 4 * H }, 0, FIVE_HOURS)!.projected).toBeCloseTo(50);
  });

  it("explains itself in plain words, with the countdown only when you'll run out", () => {
    const now = 0;
    const ahead = pace({ pct: 50, resetsAt: 5 * D }, 0, WEEK)!;
    const t = paceText(ahead, "week", now);
    expect(t.sentence).toBe("Not enough to last the week.");
    expect(t.detail).toBe(
      "Not enough to last the week. At this rate you'd use about 175% of the week's allowance; the faint bar shows where that lands.",
    );
    expect(t.outIn).toBe("out in 2d");
    const fine = paceText(pace({ pct: 40, resetsAt: 3.5 * D }, 0, WEEK)!, "week", now);
    expect(fine.sentence).toBe("Enough to last the week.");
    expect(fine.outIn).toBeNull();
    expect(paceText(pace({ pct: 60, resetsAt: 4 * H }, 0, FIVE_HOURS)!, "5 hours", now).outIn).toBe(
      "out in 40m",
    );
  });
});
