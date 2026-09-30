import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshScheduler } from "../scheduler";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("RefreshScheduler", () => {
  it("runs once shortly after a burst of changes", () => {
    const run = vi.fn();
    const s = new RefreshScheduler(run, { delayMs: 500, minIntervalMs: 2000 });
    s.trigger();
    s.trigger();
    s.trigger();
    vi.advanceTimersByTime(499);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("refreshes at most once per interval while changes keep coming", () => {
    const run = vi.fn();
    const s = new RefreshScheduler(run, { delayMs: 500, minIntervalMs: 2000 });
    for (let t = 0; t < 10_000; t += 100) {
      s.trigger();
      vi.advanceTimersByTime(100);
    }
    // First run at 500 ms, then every 2 s: 500, 2500, 4500, 6500, 8500.
    expect(run).toHaveBeenCalledTimes(5);
  });

  it("stops cleanly when disposed", () => {
    const run = vi.fn();
    const s = new RefreshScheduler(run, { delayMs: 500, minIntervalMs: 2000 });
    s.trigger();
    s.dispose();
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
