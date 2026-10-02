import { randomUUID } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type Ctx, L, writeBlob, writeSession } from "../../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { readTimeline, readVersion } from "../reader";
import type { FileVersion } from "../types";

const tmp = useTmpDir();
const B1 = "0123456789abcdef@v1";
const B2 = "0123456789abcdef@v2";
const B3 = "0123456789abcdef@v3";

/** A fake machine: a Claude home plus a project folder with `src/` in it. */
function setup(build: (c: Ctx, cwd: string) => (Record<string, unknown> | string)[]) {
  const root = tmp();
  const home = join(root, ".claude");
  const cwd = join(root, "shop");
  mkdirSync(join(cwd, "src"), { recursive: true });
  const id = randomUUID();
  const s = writeSession(home, cwd, (c) => build(c, cwd), { id });
  const read = () => readTimeline({ home, sessionId: id, transcript: s.file, cwd });
  const blob = (name: string, content: string | Buffer = "old") =>
    writeBlob(home, id, name, content);
  const blobPath = (name: string) => join(home, "file-history", id, name);
  return { root, home, cwd, id, file: s.file, read, blob, blobPath };
}

describe("readTimeline", () => {
  it("resolves a relative tracking path through realParentDir", async () => {
    const f = setup((c, cwd) => [
      L.user(c, "fix a"),
      L.fileDelta(
        c,
        join("src", "a.ts"),
        { backupFileName: B1, version: 1, realParentDir: join(cwd, "src") },
        "m1",
      ),
    ]);
    f.blob(B1);
    writeFileSync(join(f.cwd, "src", "a.ts"), "new");
    const [a] = await f.read();
    expect(a).toMatchObject({
      path: join(f.cwd, "src", "a.ts"),
      name: "a.ts",
      createdByClaude: false,
      exists: true,
    });
    expect(a!.versions).toEqual([
      {
        version: 1,
        at: expect.any(Number),
        messageId: "m1",
        blob: f.blobPath(B1),
        available: true,
        bytes: 3,
      },
    ]);
  });

  it("trusts realParentDir over the chat folder", async () => {
    const f = setup((c, cwd) => [
      L.fileDelta(c, join("pkg", "b.ts"), {
        backupFileName: B1,
        version: 1,
        realParentDir: join(cwd, "..", "elsewhere", "pkg"),
      }),
    ]);
    const [b] = await f.read();
    expect(b!.path).toBe(join(f.root, "elsewhere", "pkg", "b.ts"));
    expect(b!.exists).toBe(false);
  });

  it("without realParentDir, uses absolute paths as is and resolves relative ones from the chat folder", async () => {
    const abs = join(tmp(), "abs.ts");
    const f = setup((c) => [
      L.fileDelta(c, join("src", "rel.ts"), { backupFileName: B1, version: 1 }),
      L.fileDelta(c, abs, { backupFileName: B2, version: 2 }),
    ]);
    const paths = (await f.read()).map((x) => x.path).sort();
    expect(paths).toEqual([abs, resolve(f.cwd, "src", "rel.ts")].sort());
  });

  it("marks files Claude created (no backup before the first version)", async () => {
    const f = setup((c, cwd) => [
      L.fileDelta(c, "new.ts", { backupFileName: null, version: 1, realParentDir: cwd }),
      L.fileDelta(c, "new.ts", { backupFileName: B2, version: 2, realParentDir: cwd }),
    ]);
    f.blob(B2);
    const [n] = await f.read();
    expect(n!.createdByClaude).toBe(true);
    expect(n!.versions.map((v) => [v.version, v.blob, v.available])).toEqual([
      [1, null, true],
      [2, f.blobPath(B2), true],
    ]);
  });

  it("keeps versions whose blob is missing, marked unavailable", async () => {
    const f = setup((c, cwd) => [
      L.fileDelta(c, "gone.ts", { backupFileName: B1, version: 1, realParentDir: cwd }),
    ]);
    const [g] = await f.read();
    expect(g!.versions[0]).toMatchObject({ blob: f.blobPath(B1), available: false });
  });

  it("ignores backup names that are not Claude's hex@vN form (no path traversal)", async () => {
    const f = setup((c, cwd) => [
      L.fileDelta(c, "evil.ts", {
        backupFileName: "../../etc/passwd",
        version: 1,
        realParentDir: cwd,
      }),
      L.fileDelta(c, "evil.ts", { backupFileName: "ABCDEF0123456789@v2", version: 2 }),
      L.fileDelta(c, "evil.ts", { backupFileName: "0123456789abcdef@v3/..", version: 3 }),
      L.fileDelta(c, "ok.ts", { backupFileName: B1, version: 1, realParentDir: cwd }),
    ]);
    const files = await f.read();
    expect(files.map((x) => x.name)).toEqual(["ok.ts"]);
  });

  it("merges a delta and a snapshot of the same version, delta first", async () => {
    const f = setup((c, cwd) => [
      L.fileSnapshot(c, {}),
      L.fileSnapshot(
        c,
        { "a.ts": { backupFileName: B1, version: 1, realParentDir: cwd } },
        {
          messageId: "snap",
        },
      ),
      L.fileDelta(c, "a.ts", { backupFileName: B1, version: 1, realParentDir: cwd }, "delta"),
      L.fileSnapshot(
        c,
        {
          "a.ts": { backupFileName: B1, version: 1, realParentDir: cwd },
          [join("src", "b.ts")]: { backupFileName: B2, version: 2 },
        },
        { messageId: "snap2", isSnapshotUpdate: true },
      ),
      L.fileSnapshot(c, { "a.ts": { backupFileName: B2, version: 2, realParentDir: cwd } }),
    ]);
    const files = await f.read();
    const a = files.find((x) => x.name === "a.ts")!;
    expect(a.versions.map((v) => [v.version, v.messageId])).toEqual([
      [1, "delta"],
      [2, expect.any(String)],
    ]);
    const b = files.find((x) => x.name === "b.ts")!;
    expect(b.path).toBe(resolve(f.cwd, "src", "b.ts"));
    expect(b.versions.map((v) => [v.version, v.messageId])).toEqual([[2, "snap2"]]);
  });

  it("sorts versions ascending", async () => {
    const f = setup((c, cwd) => [
      L.fileDelta(c, "a.ts", { backupFileName: B3, version: 3, realParentDir: cwd }),
      L.fileDelta(c, "a.ts", { backupFileName: B1, version: 1, realParentDir: cwd }),
      L.fileDelta(c, "a.ts", { backupFileName: B2, version: 2, realParentDir: cwd }),
    ]);
    const [a] = await f.read();
    expect(a!.versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("lists the most recently changed file first", async () => {
    const at = (m: number) => `2026-09-10T08:${String(m).padStart(2, "0")}:00.000Z`;
    const f = setup((c, cwd) => [
      L.fileDelta(c, "old.ts", {
        backupFileName: B1,
        version: 1,
        backupTime: at(1),
        realParentDir: cwd,
      }),
      L.fileDelta(c, "mid.ts", {
        backupFileName: B1,
        version: 1,
        backupTime: at(2),
        realParentDir: cwd,
      }),
      L.fileDelta(c, "new.ts", {
        backupFileName: B1,
        version: 1,
        backupTime: at(3),
        realParentDir: cwd,
      }),
      L.fileDelta(c, "old.ts", {
        backupFileName: B2,
        version: 2,
        backupTime: at(9),
        realParentDir: cwd,
      }),
    ]);
    const files = await f.read();
    expect(files.map((x) => x.name)).toEqual(["old.ts", "new.ts", "mid.ts"]);
    expect(files[0]!.versions[1]!.at).toBe(Date.parse(at(9)));
  });

  it("returns [] for a missing transcript, a bad session id or a chat without checkpoints", async () => {
    const f = setup((c) => [L.user(c, "hi"), L.assistant(c)]);
    expect(await f.read()).toEqual([]);
    expect(
      await readTimeline({
        home: f.home,
        sessionId: f.id,
        transcript: join(f.root, "no.jsonl"),
        cwd: f.cwd,
      }),
    ).toEqual([]);
    expect(
      await readTimeline({ home: f.home, sessionId: "../x", transcript: f.file, cwd: f.cwd }),
    ).toEqual([]);
  });

  it("skips corrupt lines and entries without a usable version", async () => {
    const f = setup((c, cwd) => [
      '{"type":"file-history-delta", broken',
      L.fileDelta(c, "a.ts", { backupFileName: B1, version: 0, realParentDir: cwd }),
      L.fileDelta(c, "b.ts", { backupFileName: B1, version: 1.5, realParentDir: cwd }),
      L.fileDelta(c, "c.ts", { backupFileName: B1, version: 1, realParentDir: cwd }),
    ]);
    expect((await f.read()).map((x) => x.name)).toEqual(["c.ts"]);
  });
});

describe("readVersion", () => {
  const v = (blob: string | null): FileVersion => ({
    version: 1,
    at: 0,
    messageId: null,
    blob,
    available: true,
    bytes: 0,
  });

  it("reads a text checkpoint", async () => {
    const f = setup(() => []);
    expect(await readVersion(v(f.blob(B1, "const a = 1;\n// héllo\n")))).toEqual({
      text: "const a = 1;\n// héllo\n",
    });
  });

  it("flags bytes that are not UTF-8 text as binary", async () => {
    const f = setup(() => []);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
    expect(await readVersion(v(f.blob(B1, png)))).toEqual({ binary: true });
  });

  it("returns null for a missing, oversized or created-by-Claude version", async () => {
    const f = setup(() => []);
    expect(await readVersion(v(f.blobPath(B1)))).toBeNull();
    expect(await readVersion(v(f.blob(B2, "x".repeat(100))), 10)).toBeNull();
    expect(await readVersion(v(null))).toBeNull();
  });

  it("refuses paths that are not Claude checkpoint blobs", async () => {
    const d = tmp();
    const p = join(d, "secret.txt");
    writeFileSync(p, "secret");
    expect(await readVersion(v(p))).toBeNull();
    const fake = join(d, "file-history", "not-a-session", B1);
    mkdirSync(join(d, "file-history", "not-a-session"), { recursive: true });
    writeFileSync(fake, "x");
    expect(await readVersion(v(fake))).toBeNull();
  });
});

describe("readVersion and linked folders", () => {
  it("won't read a checkpoint through a linked session folder", async () => {
    const root = tmp();
    const id = randomUUID();
    const real = join(root, "elsewhere");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "0123456789abcdef@v1"), "secret");
    const hist = join(root, ".claude", "file-history");
    mkdirSync(hist, { recursive: true });
    try {
      symlinkSync(real, join(hist, id), "junction");
    } catch {
      return; // this machine can't make folder links
    }
    const v: FileVersion = {
      version: 1,
      at: 0,
      messageId: null,
      blob: join(hist, id, "0123456789abcdef@v1"),
      available: true,
      bytes: 0,
    };
    expect(await readVersion(v)).toBeNull();
  });
});
