// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConversationPage } from "../../../features/chats/conversation";
import type { LiveStatus, Session } from "../../../features/chats/types";
import type { ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { MenuLayer } from "../../ui/Menu";
import { ChatsView } from "../ChatsView";
import { DEFAULT_FILTER } from "../model";
import { openDetails } from "../open";

const sent: ViewMsg[] = [];
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mk = (n: number, over: Partial<Session> = {}): Session => ({
  id: id(n),
  file: "",
  cwd: "/code/shop",
  project: "shop",
  title: `Chat ${n}`,
  firstPrompt: "",
  branch: "main",
  startedAt: Date.now() - n * 3_600_000 - 60_000,
  lastActiveAt: Date.now() - n * 3_600_000,
  prompts: 1,
  estimated: false,
  model: null,
  entrypoint: "cli",
  prLinks: [],
  continuedIn: null,
  sizeBytes: 1,
  ...over,
});

function load(items: Session[], extra: Record<string, unknown> = {}, live: LiveStatus[] = []) {
  store.applyHostMessage({
    type: "sessions",
    items,
    live,
    pins: [],
    renames: {},
    tags: {},
    here: items.map((s) => s.id),
    env: { claudeExtension: true, hasWorkspace: true, platform: "linux" },
    ...extra,
  } as never);
}

const view = () =>
  render(
    <>
      <ChatsView />
      <MenuLayer />
    </>,
  );

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.query.value = "";
  store.chatFilter.value = { ...DEFAULT_FILTER, date: "all" };
  store.collapsed.value = [];
  store.selected.value = null;
  store.details.value = null;
  store.conversation.value = null;
  store.inMessages.value = false;
});
afterEach(cleanup);

describe("Chats list", () => {
  it("selects many chats and pins, exports, archives or hides them at once", () => {
    load([mk(1), mk(2), mk(3)]);
    view();
    fireEvent.click(screen.getByRole("button", { name: /^Select$/ }));
    fireEvent.click(screen.getByRole("option", { name: "Chat 1" }));
    fireEvent.click(screen.getByRole("option", { name: "Chat 2" }));
    const bar = screen.getByRole("toolbar", { name: "Selected chats" });
    expect(within(bar).getByText("2 selected")).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: /Export/ }));
    expect(sent).toContainEqual({ type: "chat:save", ids: [id(1), id(2)] });
    fireEvent.click(within(bar).getByRole("button", { name: /Hide/ }));
    expect(sent).toContainEqual({
      type: "chat:mark",
      ids: [id(1), id(2)],
      set: "hidden",
      on: true,
    });
    // Clicking a row while selecting never opens it.
    expect(sent.some((m) => m.type === "openChat")).toBe(false);
    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    expect(store.selected.value).toHaveLength(3);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(store.selected.value).toBeNull();
  });

  it("collapses a date group, keeping its count, and every group at once", () => {
    load([mk(1, { lastActiveAt: Date.now() - 1000 }), mk(900)]);
    view();
    const today = screen.getByRole("button", { name: /Today/ });
    fireEvent.click(today);
    expect(screen.queryByText("Chat 1")).toBeNull();
    expect(today.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Collapse every group" }));
    expect(screen.queryByText("Chat 900")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open every group" }));
    expect(screen.getByText("Chat 1")).toBeTruthy();
    expect(screen.getByText("Chat 900")).toBeTruthy();
  });

  it("offers every chat action from its ⋯ menu (and right-click)", () => {
    load([mk(1)], { temp: [id(1)] });
    view();
    fireEvent.contextMenu(screen.getByRole("option", { name: "Chat 1" }));
    const menu = screen.getByRole("menu", { name: "Chat 1 actions" });
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((b) => b.textContent);
    expect(labels).toEqual([
      "Make permanent",
      "Rename…",
      "Pin to top",
      "Continue in a terminal",
      "Fork into a new chat",
      "Copy resume command",
      "Copy chat id",
      "Files and transcript",
      "Export as Markdown…",
      "Export chat (.jsonl)…",
      "Archive",
      "Hide from the list",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Make permanent" }));
    expect(sent).toContainEqual({ type: "chat:mark", ids: [id(1)], set: "temp", on: false });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes a menu with Escape and moves through it with the arrow keys", () => {
    load([mk(1)]);
    view();
    fireEvent.click(screen.getByRole("button", { name: "More actions for Chat 1" }));
    const menu = screen.getByRole("menu");
    const first = within(menu).getAllByRole("menuitem")[0]!;
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(menu).getAllByRole("menuitem")[1]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("tags temporary chats, worktrees, branches and folders", () => {
    load(
      [
        mk(1, {
          worktree: { kind: "claude", name: "fix-cart", removed: false },
          branch: "fix/cart",
        }),
      ],
      { temp: [id(1)] },
    );
    view();
    const row = screen.getByRole("option", { name: "Chat 1" });
    expect(within(row).getByText("Temp")).toBeTruthy();
    expect(within(row).getByText("fix-cart")).toBeTruthy();
    expect(within(row).getByText("shop")).toBeTruthy();
  });

  it("shows a chat that's waiting on you with its own words", () => {
    const s = mk(1);
    load([s], {}, [{ sessionId: s.id, pid: 1, status: "waiting", name: null, updatedAt: 0 }]);
    view();
    expect(screen.getByRole("option", { name: /Needs your answer\. Chat 1/ })).toBeTruthy();
  });

  it("Recent shows the 20 newest and offers the rest", () => {
    load(Array.from({ length: 25 }, (_, i) => mk(i + 1)));
    store.chatFilter.value = { ...DEFAULT_FILTER, date: "recent" };
    view();
    expect(screen.getByText("25 chats".replace("25", "20"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all 25" }));
    expect(store.filters().date).toBe("all");
  });

  it("keeps archived and hidden chats in lists of their own", () => {
    load([mk(1), mk(2), mk(3)], { archived: [id(2)], hidden: [id(3)] });
    view();
    expect(screen.queryByText("Chat 2")).toBeNull();
    expect(screen.queryByText("Chat 3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    fireEvent.click(screen.getByRole("radio", { name: /Hidden/ }));
    expect(screen.getByText("Chat 3")).toBeTruthy();
    fireEvent.contextMenu(screen.getByRole("option", { name: "Chat 3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show in the list again" }));
    expect(sent).toContainEqual({ type: "chat:mark", ids: [id(3)], set: "hidden", on: false });
  });

  it("starts chats every way from the launch bar", () => {
    load([mk(1)]);
    view();
    fireEvent.click(screen.getByRole("button", { name: /New chat/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue the last chat/ }));
    fireEvent.click(screen.getByRole("button", { name: "More ways to start a chat" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New temporary chat" }));
    fireEvent.click(screen.getByRole("button", { name: "More ways to start a chat" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Restore recent terminals" }));
    fireEvent.click(screen.getByRole("button", { name: "More ways to start a chat" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Import many…" }));
    expect(sent.map((m) => m.type)).toEqual([
      "newChat",
      "continueLast",
      "chats:newTemp",
      "chats:restore",
      "chats:import",
    ]);
  });
});

describe("A chat's details", () => {
  const page = (over: Partial<ConversationPage> = {}): ConversationPage => ({
    total: 120,
    stats: {
      messages: 120,
      tools: 40,
      tokens: { input: 1200, output: 3400, cacheRead: 9000, cacheWrite: 100 },
      durationMs: (2 * 60 + 25) * 60_000,
    },
    turns: [
      {
        role: "claude",
        at: Date.now(),
        text: "Fixed the race",
        thinking: "lock it",
        tools: [{ name: "Edit", arg: "cart.ts" }],
        usage: { input: 10, output: 20, cache: 30 },
      },
      {
        role: "you",
        at: Date.now() - 1000,
        text: "Fix the race",
        thinking: null,
        tools: [],
        usage: null,
      },
    ],
    matches: null,
    ...over,
  });

  function open(over: Partial<ConversationPage> = {}) {
    load([mk(1, { firstPrompt: "please fix the race in checkout" })]);
    view();
    act(() => openDetails(id(1)));
    const ask = sent.filter((m) => m.type === "chat:conversation").at(-1) as { req: string };
    act(() =>
      store.applyHostMessage({
        type: "chat:conversation",
        id: id(1),
        req: ask.req,
        page: page(over),
      }),
    );
  }

  it("shows the chat's stats and newest messages, with tools and thinking", () => {
    open();
    expect(screen.getByText("2h 25m")).toBeTruthy();
    expect(screen.getByText("4.6K")).toBeTruthy();
    expect(screen.getByText(/Showing last 2 of 120 messages · newest first/)).toBeTruthy();
    expect(screen.getByText("Fixed the race")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByText(/20 out · 10 in · 30 cache/)).toBeTruthy();
  });

  it("pages, flips to the oldest first, and searches the whole chat", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Show more \(118 remaining\)/ }));
    expect(sent.at(-1)).toMatchObject({ type: "chat:conversation", limit: 100, order: "latest" });
    fireEvent.click(screen.getByRole("radio", { name: "Earliest" }));
    expect(sent.at(-1)).toMatchObject({ order: "earliest", limit: 50 });
  });

  it("asks again in a new chat from one of your messages", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Ask again in a new chat" }));
    expect(sent).toContainEqual({ type: "chat:askAgain", id: id(1), text: "Fix the race" });
  });

  it("exports and pins from its own buttons", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Export$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Pin$/ }));
    expect(sent).toContainEqual({ type: "chat:save", ids: [id(1)] });
    expect(sent).toContainEqual({ type: "pin", id: id(1), on: true });
  });
});
