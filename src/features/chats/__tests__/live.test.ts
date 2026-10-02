import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { pendingQuestion, pidAlive, readLiveSessions } from "../live";

const tmp = useTmpDir();
const A = "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a";
const B = "11111111-2222-4333-8444-555555555555";

function writeLive(home: string, pid: number, body: Record<string, unknown> | string) {
  const dir = join(home, "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${pid}.json`), typeof body === "string" ? body : JSON.stringify(body));
}

describe("readLiveSessions", () => {
  it("reports running chats with their status", async () => {
    const home = tmp();
    writeLive(home, 100, { pid: 100, sessionId: A, status: "busy", name: "shop-1", updatedAt: 5 });
    writeLive(home, 200, { pid: 200, sessionId: B, status: "idle", updatedAt: 7 });
    const m = await readLiveSessions(home, () => true);
    expect(m.get(A)).toEqual({
      sessionId: A,
      pid: 100,
      status: "busy",
      name: "shop-1",
      updatedAt: 5,
    });
    expect(m.get(B)?.status).toBe("idle");
  });

  it("drops chats whose process has exited", async () => {
    const home = tmp();
    writeLive(home, 100, { pid: 100, sessionId: A, status: "busy" });
    const m = await readLiveSessions(home, (pid) => pid !== 100);
    expect(m.size).toBe(0);
  });

  it("ignores corrupt files, bad ids, bad pids and key files", async () => {
    const home = tmp();
    writeLive(home, 1, "{oops");
    writeLive(home, 2, { pid: 2, sessionId: "rm -rf /", status: "busy" });
    writeLive(home, 3, { pid: "3", sessionId: A });
    writeFileSync(join(home, "sessions", "4.abc.key"), "secret");
    expect((await readLiveSessions(home, () => true)).size).toBe(0);
  });

  it("maps an unexpected status to unknown", async () => {
    const home = tmp();
    writeLive(home, 9, { pid: 9, sessionId: A, status: "dreaming" });
    expect((await readLiveSessions(home, () => true)).get(A)?.status).toBe("unknown");
  });

  it("calls a chat waiting for permission 'waiting'", async () => {
    const home = tmp();
    writeLive(home, 9, { pid: 9, sessionId: A, status: "awaiting_permission" });
    expect((await readLiveSessions(home, () => true)).get(A)?.status).toBe("waiting");
  });

  it("ignores session files written on another computer (a shared home folder)", async () => {
    const home = tmp();
    writeLive(home, 9, { pid: 9, sessionId: A, status: "busy", pidDomain: "linux:someone-else" });
    writeLive(home, 10, {
      pid: 10,
      sessionId: B,
      status: "busy",
      pidDomain: `${process.platform}:${hostname()}`,
    });
    const m = await readLiveSessions(home, () => true);
    expect(m.has(A)).toBe(false);
    expect(m.has(B)).toBe(true);
  });

  it("keeps the newest file when two point at the same chat", async () => {
    const home = tmp();
    writeLive(home, 9, { pid: 9, sessionId: A, status: "idle", updatedAt: 1 });
    writeLive(home, 10, { pid: 10, sessionId: A, status: "busy", updatedAt: 5 });
    expect((await readLiveSessions(home, () => true)).get(A)?.pid).toBe(10);
  });

  it("returns an empty map when the folder is missing", async () => {
    expect((await readLiveSessions(tmp(), () => true)).size).toBe(0);
  });
});

describe("pidAlive", () => {
  it("is true for this process and false for an impossible pid", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2 ** 30)).toBe(false);
  });
});

describe("pendingQuestion", () => {
  const ask = (id: string, name = "AskUserQuestion") =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id, name, input: {} }] },
    });
  const answer = (id: string) =>
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: id }] },
    });

  it("is true while Claude's question or plan is waiting for an answer", () => {
    expect(pendingQuestion([ask("t1")].join("\n"))).toBe(true);
    expect(pendingQuestion([ask("t1", "ExitPlanMode")].join("\n"))).toBe(true);
  });

  it("is false once it's answered, or for other tools", () => {
    expect(pendingQuestion([ask("t1"), answer("t1")].join("\n"))).toBe(false);
    expect(pendingQuestion([ask("t1", "Bash")].join("\n"))).toBe(false);
    expect(pendingQuestion("half a line {")).toBe(false);
  });
});
