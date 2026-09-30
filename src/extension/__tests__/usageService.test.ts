import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { L, writeSession } from "../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../test/helpers/tmp";
import { OrbitStore } from "../../core/orbitStore";
import { UsageService } from "../usageService";

const tmp = useTmpDir();

function at(daysAgo: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  // Never in the future: before 10:00, "today at 10:00" hasn't happened yet.
  return new Date(Math.min(d.getTime(), Date.now() - 1000)).toISOString();
}

function fixture() {
  const home = tmp();
  const s1 = writeSession(home, "/code/shop", (c) => [
    L.user(c, "today", at(0)),
    L.assistant(c, "claude-opus-5-5", at(0)),
    L.assistant(c, "claude-opus-5-5", at(1)),
  ]);
  const s2 = writeSession(home, "/code/api", (c) => [
    L.user(c, "older", at(10)),
    L.assistant(c, "claude-sonnet-5", at(10)),
  ]);
  return { home, s1, s2 };
}

const noQuota = { status: async () => ({ enabled: false }), readQuota: async () => null };

describe("UsageService", () => {
  it("summarizes today, yesterday, 7 and 30 days and all time", async () => {
    const { home } = fixture();
    const svc = new UsageService(home, new OrbitStore(join(tmp(), "s")), noQuota);
    const snap = await svc.snapshot([], Date.now());
    expect(snap.ready).toBe(true);
    expect(snap.today.messages).toBe(1);
    expect(snap.yesterday.messages).toBe(1);
    expect(snap.week.messages).toBe(2);
    expect(snap.month.messages).toBe(3);
    expect(snap.all.messages).toBe(3);
    expect(snap.today.cost).toBeGreaterThan(0);
    expect(snap.heat).toHaveLength(26 * 7);
    expect(snap.pricingAsOf).toBe("2026-09-30");
  });

  it("counts today's messages even when their time is a little ahead of the clock", async () => {
    const { home } = fixture();
    const svc = new UsageService(home, new OrbitStore(join(tmp(), "s")), noQuota);
    // Snapshot at 09:00 while a message says 10:00 today (clock skew, or a test run at 1am).
    const snap = await svc.snapshot([], new Date(at(0, 9)).getTime());
    expect(snap.today.messages).toBe(1);
    expect(snap.all.messages).toBe(3);
  });

  it("persists the index so the next start does not rescan everything", async () => {
    const { home } = fixture();
    const store = new OrbitStore(join(tmp(), "s"));
    const a = new UsageService(home, store, noQuota);
    await a.snapshot([], Date.now());
    await a.flush();
    const saved = await store.read<{ v?: number } | null>("usage-index.json", null);
    expect(saved?.v).toBe(1);
    const b = new UsageService(home, store, noQuota);
    const snap = await b.snapshot([], Date.now());
    expect(snap.all.messages).toBe(3);
  });

  it("includes the plan-limit state and the weekly recap", async () => {
    const { home } = fixture();
    const quota = {
      status: async () => ({ enabled: true }),
      readQuota: async () => ({
        v: 1 as const,
        updatedAt: 5,
        sessionId: null,
        model: null,
        contextPct: null,
        costUsd: null,
        fiveHour: { pct: 40, resetsAt: 9 },
        sevenDay: null,
        spendLimit: null,
      }),
    };
    const svc = new UsageService(home, new OrbitStore(join(tmp(), "s")), quota);
    const snap = await svc.snapshot([], Date.now());
    expect(snap.quota).toMatchObject({ enabled: true, data: { fiveHour: { pct: 40 } } });
    expect(snap.recap.tokens).toBeGreaterThan(0);
    expect(typeof snap.recapMarkdown).toBe("string");
  });

  it("reuses the last snapshot when nothing changed (no work on idle refreshes)", async () => {
    const { home } = fixture();
    const svc = new UsageService(home, new OrbitStore(join(tmp(), "s")), noQuota);
    const now = Date.now();
    const a = await svc.snapshot([], now);
    const b = await svc.snapshot([], now + 1000);
    expect(b).toBe(a);
  });

  it("passes on whether a project statusline hides Orbit's", async () => {
    const { home } = fixture();
    const quota = {
      status: async () => ({ enabled: true, shadowed: true }),
      readQuota: async () => null,
    };
    const svc = new UsageService(home, new OrbitStore(join(tmp(), "s")), quota);
    expect((await svc.snapshot([], Date.now())).quota.shadowed).toBe(true);
  });

  it("returns an empty but valid snapshot when Claude has no data", async () => {
    const svc = new UsageService(tmp(), new OrbitStore(join(tmp(), "s")), noQuota);
    const snap = await svc.snapshot([], Date.now());
    expect(snap.all.messages).toBe(0);
    expect(snap.today.cost).toBe(0);
  });
});
