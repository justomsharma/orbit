// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session } from "../../../features/chats/types";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { MenuLayer } from "../../ui/Menu";
import { ChatsView } from "../ChatsView";
import { DEFAULT_FILTER } from "../model";

const sent: ViewMsg[] = [];

function mk(i: number, over: Partial<Session> = {}): Session {
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  return {
    id,
    file: `/p/${id}.jsonl`,
    cwd: "/code/shop",
    project: "shop",
    title: `Chat number ${i}`,
    firstPrompt: "",
    branch: "main",
    startedAt: Date.now() - i * 1000,
    lastActiveAt: Date.now() - i * 1000,
    prompts: 3,
    estimated: false,
    model: null,
    entrypoint: "cli",
    prLinks: [],
    continuedIn: null,
    sizeBytes: 1,
    ...over,
  };
}

function load(items: Session[], here = items.map((s) => s.id)) {
  store.applyHostMessage({
    type: "sessions",
    items,
    live: [],
    pins: [],
    renames: {},
    tags: {},
    here,
    env: { claudeExtension: true, hasWorkspace: true, platform: "linux" },
  });
}

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.query.value = "";
  store.chatFilter.value = { ...DEFAULT_FILTER, date: "all" };
  store.collapsed.value = [];
  store.selected.value = null;
});
afterEach(cleanup);

describe("ChatsView", () => {
  it("shows a friendly empty state before Claude has any chats", () => {
    load([]);
    render(<ChatsView />);
    expect(screen.getByText(/No chats yet/i)).toBeTruthy();
  });

  it("renders only a window of rows for a huge history", () => {
    load(Array.from({ length: 5000 }, (_, i) => mk(i)));
    const { container } = render(<ChatsView />);
    const rows = container.querySelectorAll("[data-row='chat']");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60);
  });

  it("filters as you type", () => {
    load([mk(1, { title: "Fix checkout bug" }), mk(2, { title: "Write docs" })]);
    render(<ChatsView />);
    fireEvent.input(screen.getByRole("combobox", { name: "Search chats" }), {
      target: { value: "checkout" },
    });
    expect(screen.queryByText("Write docs")).toBeNull();
    expect(screen.getByText("Fix checkout bug")).toBeTruthy();
  });

  it("tells a newcomer that clicking a chat opens it in Claude, until they've done it", () => {
    load([mk(1)]);
    render(<ChatsView />);
    expect(screen.getByText(/Click a chat to continue it/)).toBeTruthy();
    cleanup();
    store.onboarding.value = { done: ["continue"], dismissed: false };
    render(<ChatsView />);
    expect(screen.queryByText(/Click a chat to continue it/)).toBeNull();
  });

  it("continues a chat when its row is clicked", () => {
    const s = mk(1);
    load([s]);
    render(<ChatsView />);
    fireEvent.click(screen.getByText("Chat number 1"));
    expect(sent).toContainEqual({ type: "openChat", id: s.id });
  });

  it("continues the highlighted chat with Enter and moves with the arrow keys", () => {
    const a = mk(1);
    const b = mk(2);
    load([a, b]);
    render(<ChatsView />);
    const box = screen.getByRole("combobox", { name: "Search chats" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sent).toContainEqual({ type: "openChat", id: b.id });
  });

  it("shows every chat by default, so nothing seems missing; This folder is one click away", () => {
    const here = mk(1, { title: "Here chat" });
    const away = mk(2, { title: "Away chat" });
    load([here, away], [here.id]);
    render(<ChatsView />);
    expect(screen.getByText("Away chat")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    fireEvent.change(screen.getByLabelText("Folder"), { target: { value: "here" } });
    expect(screen.queryByText("Away chat")).toBeNull();
    expect(screen.getByRole("list", { name: "Active filters" }).textContent).toMatch(/This folder/);
  });

  it("pins from the row's action button", () => {
    const s = mk(1);
    load([s]);
    render(<ChatsView />);
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(sent).toContainEqual({ type: "pin", id: s.id, on: true });
  });

  it("renames inline and saves on Enter", () => {
    const s = mk(1);
    load([s]);
    render(
      <>
        <ChatsView />
        <MenuLayer />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /More actions for/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const input = screen.getByRole("textbox", { name: /New name/ });
    fireEvent.input(input, { target: { value: "Better name" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sent).toContainEqual({ type: "rename", id: s.id, title: "Better name" });
  });

  it("does not also open the chat when Enter is pressed on a row button", () => {
    const s = mk(1);
    load([s]);
    render(<ChatsView />);
    const pin = screen.getByRole("button", { name: "Pin" });
    fireEvent.keyDown(pin, { key: "Enter" });
    expect(sent.filter((m) => m.type === "openChat")).toEqual([]);
  });

  it("offers every row action from the keyboard", () => {
    const s = mk(1);
    load([s]);
    render(<ChatsView />);
    const box = screen.getByRole("combobox", { name: "Search chats" });
    fireEvent.keyDown(box, { key: "p", altKey: true });
    fireEvent.keyDown(box, { key: "c", altKey: true });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(sent).toEqual([
      { type: "pin", id: s.id, on: true },
      { type: "copyResume", id: s.id },
      { type: "openTerminal", id: s.id },
    ]);
    fireEvent.keyDown(box, { key: "F2" });
    expect(screen.getByRole("textbox", { name: /New name/ })).toBeTruthy();
  });

  it("describes a running chat with an unknown state neutrally", () => {
    const s = mk(1);
    store.applyHostMessage({
      type: "sessions",
      items: [s],
      live: [{ sessionId: s.id, pid: 1, status: "unknown", name: null, updatedAt: 0 }],
      pins: [],
      renames: {},
      tags: {},
      here: [s.id],
      env: { claudeExtension: true, hasWorkspace: true, platform: "linux" },
    });
    render(<ChatsView />);
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByText(/Waiting for you/)).toBeNull();
  });

  it("shows a clear message when nothing matches the search", () => {
    load([mk(1)]);
    render(<ChatsView />);
    fireEvent.input(screen.getByRole("combobox", { name: "Search chats" }), {
      target: { value: "zzzz" },
    });
    expect(screen.getByText(/No chats match/i)).toBeTruthy();
  });
});
