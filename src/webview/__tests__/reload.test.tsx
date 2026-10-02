// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewMsg } from "../../shared/protocol";
import { App } from "../app";
import { setPost } from "../bus";
import * as store from "../store";

const sent: ViewMsg[] = [];
const sessions = (prefs: object = {}) =>
  store.applyHostMessage({
    type: "sessions",
    items: [],
    live: [],
    pins: [],
    renames: {},
    tags: {},
    here: [],
    onboarding: { done: [], dismissed: true, welcomed: true },
    env: {
      claudeExtension: true,
      hasWorkspace: true,
      platform: "linux",
      prefs: { openChatsIn: "terminal", terminalLocation: "editor", ...prefs },
    },
  });

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.tab.value = "home";
  store.reloading.value = null;
  store.welcome.value = false;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("refresh", () => {
  it("turns while Orbit reloads, at least briefly, then stops", () => {
    render(<App />);
    sessions();
    const btn = screen.getByRole("button", { name: /Refresh everything/ });
    fireEvent.click(btn);
    expect(sent).toContainEqual({ type: "refresh" });
    expect(btn.querySelector(".spin")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Refreshing" })).toBeTruthy();
    act(() => {
      sessions();
    });
    expect(btn.querySelector(".spin")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(btn.querySelector(".spin")).toBeNull();
  });

  it("uses compact spacing when asked", () => {
    render(<App />);
    act(() => {
      sessions({ density: "compact" });
    });
    expect(document.querySelector(".app.compact")).toBeTruthy();
  });
});
