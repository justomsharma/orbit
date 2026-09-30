// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session } from "../../../features/chats/types";
import type { PromptEntry } from "../../../features/prompts/library";
import type { ViewMsg } from "../../../shared/protocol";
import { App } from "../../app";
import { setPost } from "../../bus";
import * as store from "../../store";
import { ChatsView } from "../ChatsView";

const sent: ViewMsg[] = [];
const ID = "00000000-0000-4000-8000-000000000001";

const chat: Session = {
  id: ID,
  file: `/p/${ID}.jsonl`,
  cwd: "/code/shop",
  project: "shop",
  title: "Fix the parser",
  firstPrompt: "fix the parser",
  branch: "main",
  startedAt: Date.now() - 5000,
  lastActiveAt: Date.now() - 5000,
  prompts: 3,
  estimated: false,
  model: null,
  entrypoint: "cli",
  prLinks: [],
  continuedIn: null,
  sizeBytes: 1,
};

const prompt = (over: Partial<PromptEntry>): PromptEntry => ({
  id: "0123456789ab",
  text: "tell in short and simple",
  count: 60,
  first: 1,
  last: Date.now() - 60_000,
  project: "/code/shop",
  sessionId: ID,
  pastes: 0,
  ...over,
});

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.query.value = "";
  store.filter.value = "all";
  store.chatsMode.value = "chats";
  store.details.value = null;
  store.prompts.value = null;
  store.promptQuery.value = "";
  store.inMessages.value = false;
  store.messageHits.value = null;
  store.applyHostMessage({
    type: "sessions",
    items: [chat],
    live: [],
    pins: [],
    renames: {},
    here: [ID],
    env: { claudeExtension: true, hasWorkspace: true, platform: "linux" },
  });
});
afterEach(cleanup);

describe("Chats | Prompts switch", () => {
  it("tells the host when the prompts view is open, so it only reads history then", async () => {
    store.tab.value = "chats";
    render(<App />);
    fireEvent.click(screen.getByRole("radio", { name: "Prompts" }));
    await waitFor(() => expect(sent).toContainEqual({ type: "tab", tab: "prompts" }));
  });
});

describe("Prompts", () => {
  beforeEach(() => {
    store.chatsMode.value = "prompts";
  });

  it("waits for the history, then lists prompts with how often they were used", () => {
    render(<ChatsView />);
    expect(screen.getByText(/Reading your prompts/)).toBeTruthy();
    act(() => {
      store.applyHostMessage({
        type: "prompts",
        items: [
          prompt({}),
          prompt({ id: "bbbbbbbbbbbb", text: "write tests first", count: 1, pastes: 2 }),
        ],
      });
    });
    expect(screen.getByText("tell in short and simple")).toBeTruthy();
    expect(screen.getByText(/60×/)).toBeTruthy();
    expect(screen.getByText(/2 pasted/)).toBeTruthy();
  });

  it("filters, reuses, copies and opens the chat a prompt came from", () => {
    store.prompts.value = [
      prompt({}),
      prompt({ id: "bbbbbbbbbbbb", text: "write tests first", sessionId: null }),
    ];
    render(<ChatsView />);
    fireEvent.input(screen.getByRole("searchbox", { name: /Search prompts/ }), {
      target: { value: "short" },
    });
    expect(screen.queryByText("write tests first")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Use again/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copy prompt/ }));
    fireEvent.click(screen.getByRole("button", { name: /Open the chat/ }));
    expect(sent).toEqual([
      { type: "prompts:use", id: "0123456789ab" },
      { type: "prompts:copy", id: "0123456789ab" },
      { type: "openChat", id: ID },
    ]);
  });

  it("offers no chat link for a prompt whose chat is gone", () => {
    store.prompts.value = [prompt({ sessionId: null })];
    render(<ChatsView />);
    expect(screen.queryByRole("button", { name: /Open the chat/ })).toBeNull();
  });

  it("explains an empty history", () => {
    store.prompts.value = [];
    render(<ChatsView />);
    expect(screen.getByText(/No prompts yet/)).toBeTruthy();
  });
});

describe("Chat details", () => {
  const openDetails = () => {
    render(<ChatsView />);
    fireEvent.click(screen.getByRole("button", { name: /Files and transcript/ }));
  };
  const files = () =>
    act(() => {
      store.applyHostMessage({
        type: "chat:details",
        id: ID,
        files: [
          {
            path: "/code/shop/src/a.ts",
            name: "a.ts",
            exists: true,
            createdByClaude: false,
            versions: [
              { version: 1, at: 1_700_000_000_000, available: true },
              { version: 2, at: 1_700_000_100_000, available: false },
            ],
          },
          {
            path: "/code/shop/src/new.ts",
            name: "new.ts",
            exists: true,
            createdByClaude: true,
            versions: [{ version: 1, at: 1_700_000_200_000, available: true }],
          },
        ],
      });
    });

  it("asks the host for the chat's changes and shows them", () => {
    openDetails();
    expect(sent).toContainEqual({ type: "chat:details", id: ID });
    expect(screen.getByText(/Reading what changed/)).toBeTruthy();
    files();
    expect(screen.getByRole("heading", { name: "Fix the parser" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "a.ts" })).toBeTruthy();
    expect(screen.getByText(/Created by Claude/)).toBeTruthy();
  });

  it("compares and restores a version; a missing checkpoint can't be used", () => {
    openDetails();
    files();
    const a = screen.getByRole("group", { name: "a.ts" });
    const [compare1, compare2] = within(a).getAllByRole("button", { name: /Compare/ });
    const [restore1, restore2] = within(a).getAllByRole("button", { name: /Restore/ });
    fireEvent.click(compare1!);
    fireEvent.click(restore1!);
    expect(compare2).toHaveProperty("disabled", true);
    expect(restore2).toHaveProperty("disabled", true);
    expect(sent).toContainEqual({
      type: "chat:diff",
      id: ID,
      path: "/code/shop/src/a.ts",
      version: 1,
    });
    expect(sent).toContainEqual({
      type: "chat:restore",
      id: ID,
      path: "/code/shop/src/a.ts",
      version: 1,
    });
  });

  it("never offers to undo the creation of a file", () => {
    openDetails();
    files();
    const made = screen.getByRole("group", { name: "new.ts" });
    expect(within(made).queryByRole("button", { name: /Restore/ })).toBeNull();
  });

  it("reads, exports and continues the chat, and goes back to the list", () => {
    openDetails();
    files();
    fireEvent.click(screen.getByRole("button", { name: /Read transcript/ }));
    fireEvent.click(screen.getByRole("button", { name: /Export as Markdown/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continue chat/ }));
    expect(sent).toContainEqual({ type: "chat:transcript", id: ID });
    expect(sent).toContainEqual({ type: "chat:export", id: ID });
    expect(sent).toContainEqual({ type: "openChat", id: ID });
    fireEvent.click(screen.getByRole("button", { name: /Back to chats/ }));
    expect(screen.getByRole("combobox", { name: /Search chats/ })).toBeTruthy();
  });

  it("says so when Claude changed no files", () => {
    openDetails();
    act(() => store.applyHostMessage({ type: "chat:details", id: ID, files: [] }));
    expect(screen.getByText(/didn't change any files/)).toBeTruthy();
  });
});

describe("Search inside messages", () => {
  it("searches what was said, shows where, and opens the chat", async () => {
    render(<ChatsView />);
    fireEvent.click(screen.getByRole("checkbox", { name: /In messages/ }));
    fireEvent.input(screen.getByRole("combobox", { name: /Search chats/ }), {
      target: { value: "golden set" },
    });
    await waitFor(() => expect(sent.some((m) => m.type === "search")).toBe(true));
    const req = sent.find((m) => m.type === "search") as { req: string; query: string };
    expect(req.query).toBe("golden set");
    act(() =>
      store.applyHostMessage({
        type: "search",
        req: req.req,
        done: true,
        hits: [{ sessionId: ID, snippet: "…use the golden set for…", count: 3 }],
      }),
    );
    expect(screen.getByText("Fix the parser")).toBeTruthy();
    const snippet = document.querySelector(".hit-snippet")!;
    expect(snippet.textContent).toBe("…use the golden set for…");
    expect(screen.getByText(/3 matches/)).toBeTruthy();
    fireEvent.click(snippet);
    expect(sent).toContainEqual({ type: "openChat", id: ID });
  });

  it("respects the chosen filter and highlights the match", async () => {
    const OTHER = "00000000-0000-4000-8000-000000000002";
    store.applyHostMessage({
      type: "sessions",
      items: [chat, { ...chat, id: OTHER, title: "Elsewhere chat", cwd: "/code/api" }],
      live: [],
      pins: [],
      renames: {},
      here: [ID],
      env: { claudeExtension: true, hasWorkspace: true, platform: "linux" },
    });
    store.filter.value = "workspace";
    store.inMessages.value = true;
    render(<ChatsView />);
    fireEvent.input(screen.getByRole("combobox", { name: /Search chats/ }), {
      target: { value: "golden" },
    });
    await waitFor(() => expect(sent.some((m) => m.type === "search")).toBe(true));
    const { req } = sent.find((m) => m.type === "search") as { req: string };
    act(() =>
      store.applyHostMessage({
        type: "search",
        req,
        done: true,
        hits: [
          { sessionId: ID, snippet: "use the Golden set", count: 1 },
          { sessionId: OTHER, snippet: "golden elsewhere", count: 1 },
        ],
      }),
    );
    expect(screen.queryByText("Elsewhere chat")).toBeNull();
    expect(screen.getByText("Golden", { selector: "mark" })).toBeTruthy();
  });

  it("shows how far a long search has got", async () => {
    store.inMessages.value = true;
    render(<ChatsView />);
    fireEvent.input(screen.getByRole("combobox", { name: /Search chats/ }), {
      target: { value: "golden" },
    });
    await waitFor(() => expect(sent.some((m) => m.type === "search")).toBe(true));
    const { req } = sent.find((m) => m.type === "search") as { req: string };
    act(() =>
      store.applyHostMessage({
        type: "search",
        req,
        done: false,
        hits: [],
        searched: 45,
        total: 117,
      }),
    );
    expect(screen.getByRole("status").textContent).toMatch(/45 of 117 chats/);
  });

  it("ignores answers to an older search", () => {
    store.inMessages.value = true;
    render(<ChatsView />);
    act(() =>
      store.applyHostMessage({
        type: "search",
        req: "old",
        done: true,
        hits: [{ sessionId: ID, snippet: "stale", count: 1 }],
      }),
    );
    expect(screen.queryByText("stale")).toBeNull();
  });
});
