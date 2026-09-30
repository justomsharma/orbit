// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleUsage } from "../../../../test/helpers/usageFixture";
import type { Session } from "../../../features/chats/types";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { HomeView } from "../HomeView";
import { UsageView } from "../UsageView";

const sent: ViewMsg[] = [];
const ID = "00000000-0000-4000-8000-000000000001";

function chat(over: Partial<Session> = {}): Session {
  return {
    id: ID,
    file: "",
    cwd: "/Users/ana/code/shop",
    project: "shop",
    title: "Fix checkout race",
    firstPrompt: "",
    branch: "main",
    startedAt: Date.now() - 3600_000,
    lastActiveAt: Date.now() - 600_000,
    prompts: 5,
    estimated: false,
    model: null,
    entrypoint: "cli",
    prLinks: [],
    continuedIn: null,
    sizeBytes: 1,
    ...over,
  };
}

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.usage.value = null;
  store.now.value = Date.now();
  store.range.value = "month";
  store.sessions.value = [chat()];
  store.here.value = [ID];
  store.live.value = [];
  store.loaded.value = true;
});
afterEach(cleanup);

describe("UsageView", () => {
  it("says it is reading usage until the first numbers arrive", () => {
    render(<UsageView />);
    expect(screen.getByText(/Reading your usage/)).toBeTruthy();
  });

  it("leads with the API value for the chosen range and explains what it means", () => {
    store.usage.value = sampleUsage();
    render(<UsageView />);
    expect(screen.getByText("API value · last 30 days")).toBeTruthy();
    expect(screen.getByText(/at API list prices/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(screen.getByText("API value · last 7 days")).toBeTruthy();
  });

  it("offers to turn on plan limits when they are off", () => {
    store.usage.value = sampleUsage();
    render(<UsageView />);
    fireEvent.click(screen.getByRole("button", { name: /Show my plan limits/ }));
    expect(sent).toContainEqual({ type: "quota", on: true });
  });

  it("shows the 5-hour and weekly meters when Claude has reported them", () => {
    const now = Date.now();
    store.now.value = now;
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
          fiveHour: { pct: 38, resetsAt: now + 3600_000 },
          sevenDay: { pct: 81, resetsAt: now + 3 * 86_400_000 },
          spendLimit: null,
        },
      },
    });
    render(<UsageView />);
    expect(screen.getByLabelText("5-hour limit").getAttribute("aria-valuenow")).toBe("38");
    expect(screen.getByLabelText("Weekly limit")).toBeTruthy();
    expect(screen.getByText(/Updated 1m ago/)).toBeTruthy();
  });

  it("explains where plan limits come from while waiting for the first report", () => {
    store.usage.value = sampleUsage({ quota: { enabled: true, shadowed: false, data: null } });
    render(<UsageView />);
    expect(screen.getByText(/next message in a terminal/i)).toBeTruthy();
  });

  it("says when a project's own statusline hides Orbit's there", () => {
    store.usage.value = sampleUsage({ quota: { enabled: true, shadowed: true, data: null } });
    render(<UsageView />);
    expect(screen.getByText(/project sets its own statusline/i)).toBeTruthy();
  });

  it("shows a window that already reset as reset, not as stale numbers", () => {
    const now = Date.now();
    store.usage.value = sampleUsage({
      quota: {
        enabled: true,
        shadowed: false,
        data: {
          v: 1,
          updatedAt: now - 6 * 3600_000,
          sessionId: null,
          model: null,
          contextPct: null,
          costUsd: null,
          fiveHour: { pct: 97, resetsAt: now - 3600_000 },
          sevenDay: null,
          spendLimit: null,
        },
      },
    });
    render(<UsageView />);
    expect(screen.queryByText("97%")).toBeNull();
    expect(screen.getByText(/5-hour limit reset/i)).toBeTruthy();
  });

  it("copies the weekly recap", () => {
    store.usage.value = sampleUsage();
    render(<UsageView />);
    fireEvent.click(screen.getByRole("button", { name: /Copy as Markdown/ }));
    expect(sent).toContainEqual({ type: "copyRecap" });
  });

  it("opens a top chat from the list", () => {
    store.usage.value = sampleUsage();
    render(<UsageView />);
    fireEvent.click(screen.getByRole("button", { name: /Fix checkout race/ }));
    expect(sent).toContainEqual({ type: "openChat", id: ID });
  });
});

describe("HomeView", () => {
  it("greets and starts a new chat", () => {
    render(<HomeView />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Good|Working late/);
    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    expect(sent).toContainEqual({ type: "newChat" });
  });

  it("picks up where you left off", () => {
    render(<HomeView />);
    expect(screen.getByText("Fix checkout race")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(sent).toContainEqual({ type: "openChat", id: ID });
  });

  it("lists running chats", () => {
    store.live.value = [{ sessionId: ID, pid: 1, status: "busy", name: null, updatedAt: 0 }];
    render(<HomeView />);
    expect(screen.getByText("Running now")).toBeTruthy();
    expect(screen.getByText(/Working…/)).toBeTruthy();
  });

  it("shows today's numbers against yesterday", () => {
    store.usage.value = sampleUsage();
    render(<HomeView />);
    expect(screen.getByText("API value today")).toBeTruthy();
    expect(screen.getByText(/vs yesterday/)).toBeTruthy();
  });

  it("teases the weekly recap and jumps to it", () => {
    store.usage.value = sampleUsage();
    render(<HomeView />);
    expect(screen.getByText(/12 chats/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /See your week/ }));
    expect(store.tab.value).toBe("usage");
  });

  it("welcomes someone with no chats yet", () => {
    store.sessions.value = [];
    store.here.value = [];
    render(<HomeView />);
    expect(screen.getByText(/Start your first chat/)).toBeTruthy();
  });
});
