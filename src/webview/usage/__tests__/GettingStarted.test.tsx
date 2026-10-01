// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session } from "../../../features/chats/types";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { HomeView } from "../HomeView";

const sent: ViewMsg[] = [];
const ID = "00000000-0000-4000-8000-000000000001";
const chat: Session = {
  id: ID,
  file: "",
  cwd: "/code/shop",
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
};

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.tab.value = "home";
  store.chatsMode.value = "chats";
  store.usage.value = null;
  store.sessions.value = [chat];
  store.here.value = [ID];
  store.live.value = [];
  store.loaded.value = true;
  store.onboarding.value = { done: ["find"], dismissed: false };
});
afterEach(cleanup);

const guide = () => screen.getByRole("region", { name: /Get started/ });

describe("Get started checklist on Home", () => {
  it("shows what to try, with progress, and ticks what's done", () => {
    render(<HomeView />);
    const g = guide();
    expect(within(g).getByText("1 of 5")).toBeTruthy();
    expect(within(g).getByRole("listitem", { name: /Find an old chat, done/ })).toBeTruthy();
    expect(within(g).getByRole("listitem", { name: /^Check your setup$/ })).toBeTruthy();
  });

  it("takes you to the right place for each step", () => {
    render(<HomeView />);
    fireEvent.click(within(guide()).getByRole("button", { name: /Show me: Check your setup/ }));
    expect(store.tab.value).toBe("setup");
    store.tab.value = "home";
    fireEvent.click(within(guide()).getByRole("button", { name: /Show me: Turn on plan limits/ }));
    expect(store.tab.value).toBe("usage");
    store.tab.value = "home";
    fireEvent.click(
      within(guide()).getByRole("button", { name: /Show me: See what Claude changed/ }),
    );
    expect(store.tab.value).toBe("chats");
  });

  it("can be hidden for good", () => {
    render(<HomeView />);
    fireEvent.click(within(guide()).getByRole("button", { name: /Hide/ }));
    expect(sent).toContainEqual({ type: "onboarding", action: "dismiss" });
  });

  it("celebrates when everything is done, and stays out of the way once hidden", () => {
    store.onboarding.value = {
      done: ["continue", "find", "details", "setup", "limits"],
      dismissed: false,
    };
    const { unmount } = render(<HomeView />);
    expect(within(guide()).getByText(/You're all set/)).toBeTruthy();
    unmount();
    store.onboarding.value = { done: [], dismissed: true };
    render(<HomeView />);
    expect(screen.queryByRole("region", { name: /Get started/ })).toBeNull();
  });
});
