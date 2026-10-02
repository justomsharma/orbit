// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Session } from "../../../features/chats/types";
import type { ChangedFileView, HostMsg, ViewMsg } from "../../../shared/protocol";
import { setPost } from "../../bus";
import * as store from "../../store";
import { CheckpointsView } from "../CheckpointsView";

const sent: ViewMsg[] = [];
const ID = "00000000-0000-4000-8000-000000000001";
const GONE = "1a2b3c4d-0000-4000-8000-000000000002";
const NOW = Date.UTC(2026, 9, 2, 12);

const chat = {
  id: ID,
  file: "",
  cwd: "/code/shop",
  project: "shop",
  title: "Fix checkout race",
  lastActiveAt: NOW - 600_000,
} as Session;

const file = (name: string, over: Partial<ChangedFileView> = {}): ChangedFileView => ({
  path: `/code/shop/src/${name}`,
  name,
  createdByClaude: false,
  exists: true,
  versions: [
    { version: 1, at: NOW - 7200_000, available: false, bytes: 0 },
    { version: 2, at: NOW - 3600_000, available: true, bytes: 2048 },
  ],
  ...over,
});

const filesMsg = (over: Partial<Extract<HostMsg, { type: "cp:files" }>> = {}) =>
  store.applyHostMessage({
    type: "cp:files",
    id: ID,
    gone: false,
    files: [file("cart.ts"), file("api.ts")],
    orphans: 2,
    ...over,
  });

beforeEach(() => {
  sent.length = 0;
  setPost((m) => sent.push(m));
  store.now.value = NOW;
  store.sessions.value = [chat];
  store.renames.value = {};
  store.details.value = null;
  store.cpOpen.value = null;
  store.checkpoints.value = [
    { id: ID, files: 2, versions: 4, bytes: 4096, newest: NOW - 3600_000 },
    { id: GONE, files: 1, versions: 1, bytes: 10, newest: NOW - 86_400_000 * 3 },
  ];
});
afterEach(cleanup);

describe("Checkpoints: chats", () => {
  it("lists every chat with backups, newest first, also ones whose chat is gone", () => {
    render(<CheckpointsView />);
    const rows = screen.getAllByRole("button", { name: /Fix checkout race|Chat 1a2b3c4d/ });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Fix checkout race"),
      expect.stringContaining("Chat 1a2b3c4d"),
    ]);
    expect(screen.getByText("2 chats with checkpoints")).toBeTruthy();
    expect(screen.getByText(/shop · 2 files · 4 versions · 4\.0 KB/)).toBeTruthy();
  });

  it("finds a chat by its id too", () => {
    render(<CheckpointsView />);
    fireEvent.input(screen.getByLabelText("Search checkpoints"), { target: { value: "1a2b" } });
    expect(screen.queryByText("Fix checkout race")).toBeNull();
    expect(screen.getByText(/Chat 1a2b3c4d/)).toBeTruthy();
  });

  it("re-reads on request", () => {
    render(<CheckpointsView />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(sent).toContainEqual({ type: "refresh" });
  });

  it("opens a chat's files", () => {
    render(<CheckpointsView />);
    fireEvent.click(screen.getByRole("button", { name: /Fix checkout race/ }));
    expect(sent).toContainEqual({ type: "cp:files", id: ID });
    expect(screen.getByRole("status").textContent).toMatch(/Reading/);
  });
});

describe("Checkpoints: files and versions", () => {
  const open = () => {
    render(<CheckpointsView />);
    fireEvent.click(screen.getByRole("button", { name: /Fix checkout race/ }));
    filesMsg();
  };

  it("shows each file with its folder and versions, and backups no file explains", async () => {
    open();
    expect(await screen.findByText("2 of 2 files · 2 backups no file explains")).toBeTruthy();
    const cart = screen.getByRole("button", { name: /cart\.ts/ });
    expect(cart.textContent).toMatch(/src · 2 versions · 1 no longer saved/);
  });

  it("filters files by name or folder", async () => {
    open();
    fireEvent.input(await screen.findByLabelText("Search files"), { target: { value: "api" } });
    expect(screen.getByText("1 of 2 files · 2 backups no file explains")).toBeTruthy();
  });

  it("opens one file at a time, newest version first, with sizes", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /cart\.ts/ }));
    const list = screen.getByRole("list", { name: "Versions of cart.ts" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]!.textContent).toMatch(/Before change 2.*2\.0 KB/);
    expect(items[1]!.textContent).toMatch(/Before change 1.*no longer saved/);
    fireEvent.click(screen.getByRole("button", { name: /api\.ts/ }));
    expect(screen.queryByRole("list", { name: "Versions of cart.ts" })).toBeNull();
  });

  it("compares, restores and opens the current file", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /cart\.ts/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Compare cart.ts before change 2 with now" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Restore cart.ts to before change 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Open current file" }));
    const path = "/code/shop/src/cart.ts";
    expect(sent).toContainEqual({ type: "chat:diff", id: ID, path, version: 2 });
    expect(sent).toContainEqual({ type: "chat:restore", id: ID, path, version: 2 });
    expect(sent).toContainEqual({ type: "cp:openFile", id: ID, path });
    const gone = screen.getByRole("button", { name: "Restore cart.ts to before change 1" });
    expect((gone as HTMLButtonElement).disabled).toBe(true);
  });

  it("goes back to all chats with the button or Esc", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "All chats" }));
    expect(screen.getByText("2 chats with checkpoints")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Fix checkout race/ }));
    filesMsg();
    const search = await screen.findByLabelText("Search files");
    fireEvent.input(search, { target: { value: "x" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect((screen.getByLabelText("Search files") as HTMLInputElement).value).toBe("");
    fireEvent.keyDown(screen.getByLabelText("Search files"), { key: "Escape" });
    expect(screen.getByText("2 chats with checkpoints")).toBeTruthy();
  });

  it("explains a chat that's gone but left backups", async () => {
    render(<CheckpointsView />);
    fireEvent.click(screen.getByRole("button", { name: /Chat 1a2b3c4d/ }));
    filesMsg({ id: GONE, gone: true, files: [], orphans: 1 });
    expect(await screen.findByText(/This chat is no longer on disk/)).toBeTruthy();
    expect(screen.getByText(/1 backup is left/)).toBeTruthy();
  });

  it("ignores files for a chat it isn't showing", async () => {
    open();
    filesMsg({ id: GONE, files: [] });
    expect(await screen.findByRole("button", { name: /cart\.ts/ })).toBeTruthy();
  });
});
