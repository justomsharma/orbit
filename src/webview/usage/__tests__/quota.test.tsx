// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleUsage } from "../../../../test/helpers/usageFixture";
import type { ViewMsg } from "../../../shared/protocol";
import type { QuotaFile } from "../../../tap/statusline";
import { setPost } from "../../bus";
import * as store from "../../store";
import { QuotaCard } from "../QuotaCard";

const H = 3_600_000;
const D = 24 * H;
const sent: ViewMsg[] = [];
const now = Date.now();

function load(over: Partial<QuotaFile> = {}) {
  store.usage.value = sampleUsage({
    quota: {
      enabled: true,
      shadowed: false,
      data: {
        v: 1,
        updatedAt: now - 60_000,
        sessionId: null,
        model: null,
        contextPct: null,
        costUsd: null,
        fiveHour: { pct: 40, resetsAt: now + 2 * H },
        sevenDay: { pct: 40, resetsAt: now + 3.5 * D },
        spendLimit: null,
        ...over,
      },
    },
  });
}

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.now.value = now;
});
afterEach(cleanup);

describe("plan limits card", () => {
  it("says whether the week's allowance will last, and explains it", () => {
    load();
    render(<QuotaCard />);
    expect(screen.getByText("Enough to last the week.")).toBeTruthy();
    const why = screen.getByRole("button", {
      name: /At this rate you'd use about 80% of the week's allowance/,
    });
    expect(why.getAttribute("title")).toMatch(/faint bar/);
    fireEvent.click(why);
    expect(screen.getByText(/the faint bar shows where that lands/)).toBeTruthy();
  });

  it("warns when it won't last, with a countdown", () => {
    load({ updatedAt: now, sevenDay: { pct: 50, resetsAt: now + 5 * D } });
    render(<QuotaCard />);
    expect(screen.getByText("Not enough to last the week.")).toBeTruthy();
    expect(screen.getByText("out in 2d")).toBeTruthy();
  });

  it("does the same for the 5-hour window", () => {
    load({ updatedAt: now, fiveHour: { pct: 60, resetsAt: now + 4 * H } });
    render(<QuotaCard />);
    expect(screen.getByText("Not enough to last the 5 hours.")).toBeTruthy();
    expect(screen.getByText("out in 40m")).toBeTruthy();
  });

  it("colours each bar by how full it is", () => {
    load({
      fiveHour: { pct: 85, resetsAt: now + 4.9 * H },
      sevenDay: { pct: 60, resetsAt: now + 6.9 * D },
    });
    const { container } = render(<QuotaCard />);
    const rows = container.querySelectorAll(".qbar");
    expect(rows[0]!.className).toContain("high");
    expect(rows[1]!.className).toContain("mid");
  });

  it("shows how fresh the numbers are, with a live dot, and re-reads on request", () => {
    load();
    render(<QuotaCard />);
    expect(screen.getByText("Updated 1m ago")).toBeTruthy();
    expect(screen.getByRole("img", { name: /^Live/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Re-read latest" }));
    expect(sent).toContainEqual({ type: "refresh" });
  });

  it("calls numbers older than 10 minutes idle", () => {
    load({ updatedAt: now - 3 * H });
    render(<QuotaCard />);
    expect(screen.getByRole("img", { name: /^Idle/ })).toBeTruthy();
  });

  it("offers claude.ai's usage page when a limit is nearly used up", () => {
    load({ fiveHour: { pct: 93, resetsAt: now + 4 * H } });
    render(<QuotaCard />);
    fireEvent.click(screen.getByRole("button", { name: /claude\.ai usage/ }));
    expect(sent).toContainEqual({ type: "openOrbitLink", link: "claudeUsage" });
  });

  it("shows the prompt cache when it's missing, with why", () => {
    load({
      cache: {
        ttl: "5m",
        requests: 40,
        misses: 3,
        rebuilds: 1,
        hitRatio: 0.82,
        recached: 120_000,
        lastMiss: ["tools_changed"],
        toolsAdded: 2,
        toolsRemoved: 1,
      },
    });
    render(<QuotaCard />);
    expect(screen.getByText("Prompt cache (5m)")).toBeTruthy();
    expect(screen.getByText("82% hit")).toBeTruthy();
    expect(
      screen.getByText(/40 requests · 3 missed · 1 rebuilt · 120K tokens re-cached/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Last miss: the tool set changed \(\+2 \/ -1 tools\)/ }),
    ).toBeTruthy();
  });

  it("hides the prompt cache when it's working well", () => {
    load({
      cache: {
        ttl: null,
        requests: 40,
        misses: 0,
        rebuilds: 0,
        hitRatio: 0.99,
        recached: 0,
        lastMiss: [],
        toolsAdded: 0,
        toolsRemoved: 0,
      },
    });
    render(<QuotaCard />);
    expect(screen.queryByText(/Prompt cache/)).toBeNull();
  });

  it("shows the repo, worktree and pull request Claude is working on", () => {
    load({
      repo: { host: "github.com", owner: "acme", name: "shop" },
      worktree: { name: "feat-x", branch: "feat/x", originalBranch: "main", path: "/w/x" },
      pr: {
        number: 412,
        url: "https://github.com/acme/shop/pull/412",
        review: "changes_requested",
        kind: "pr",
      },
    });
    render(<QuotaCard />);
    expect(screen.getByText("acme/shop")).toBeTruthy();
    expect(screen.getByText(/was on main/)).toBeTruthy();
    expect(screen.getByText("changes requested")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Pull request #412/ }));
    expect(sent).toContainEqual({ type: "openLink", url: "https://github.com/acme/shop/pull/412" });
  });

  it("says a window reset since the last reading", () => {
    load({ fiveHour: { pct: 97, resetsAt: now - H } });
    render(<QuotaCard />);
    expect(screen.getByText(/outdated · open Claude to refresh/)).toBeTruthy();
  });
});
