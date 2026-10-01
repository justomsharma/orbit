import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { L, slugFor, writeSession, writeSubagent } from "../../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { UsageIndex } from "../index";

const tmp = useTmpDir();
const CWD = "C:\\work\\shop";
const at = (min: number) => new Date(Date.UTC(2026, 8, 20, 10, min)).toISOString();
const line = (l: unknown) => `${JSON.stringify(l)}\n`;

function canSymlink(dir: string): boolean {
  try {
    writeFileSync(join(dir, "probe-target"), "x");
    symlinkSync(join(dir, "probe-target"), join(dir, "probe-link"));
    return true;
  } catch {
    return false;
  }
}

async function indexed(home: string) {
  const idx = new UsageIndex(home);
  await idx.update();
  return idx;
}

describe("UsageIndex", () => {
  it("is empty when Claude has no projects yet", async () => {
    const idx = new UsageIndex(tmp());
    expect(await idx.update()).toEqual({ changed: false });
    expect(idx.records()).toEqual([]);
  });

  it("reads usage from an assistant line", async () => {
    const home = tmp();
    const s = writeSession(home, CWD, (c) => [
      L.user(c, "hi"),
      L.assistant(c, "claude-opus-5-5", at(1), {
        id: "msg_A",
        input: 3,
        output: 7,
        read: 11,
        write5m: 13,
        write1h: 17,
        webSearches: 2,
        speed: "fast",
        geo: "us",
      }),
    ]);
    const idx = new UsageIndex(home);
    expect(await idx.update()).toEqual({ changed: true });
    expect(idx.records()).toEqual([
      {
        id: "msg_A",
        t: Date.parse(at(1)),
        model: "claude-opus-5-5",
        session: s.id,
        cwd: CWD,
        input: 3,
        output: 7,
        cacheRead: 11,
        cacheWrite5m: 13,
        cacheWrite1h: 17,
        webSearches: 2,
        fast: true,
        usGeo: true,
      },
    ]);
  });

  it("counts cache writes as 5-minute writes when the breakdown is missing", async () => {
    const home = tmp();
    writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-sonnet-4-5", at(1), {
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 40,
        },
      }),
    ]);
    const [r] = (await indexed(home)).records();
    expect(r).toMatchObject({
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite5m: 40,
      cacheWrite1h: 0,
      webSearches: 0,
      fast: false,
      usGeo: false,
    });
  });

  it("counts a message written as several lines once", async () => {
    const home = tmp();
    writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "msg_A", text: "thinking" }),
      L.assistant(c, "claude-opus-5-5", at(2), { id: "msg_A", text: "tool" }),
      L.assistant(c, "claude-opus-5-5", at(3), { id: "msg_A", text: "done" }),
      L.assistant(c, "claude-opus-5-5", at(4), { id: "msg_B" }),
    ]);
    const recs = (await indexed(home)).records();
    expect(recs.map((r) => r.id)).toEqual(["msg_A", "msg_B"]);
    expect(recs[0]!.t).toBe(Date.parse(at(1)));
  });

  it("takes the final output count of a message written over several lines", async () => {
    const home = tmp();
    writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "msg_A", output: 1 }),
      L.assistant(c, "claude-opus-5-5", at(2), { id: "msg_A", output: 120 }),
      L.assistant(c, "claude-opus-5-5", at(3), { id: "msg_A", output: 500 }),
    ]);
    const [r] = (await indexed(home)).records();
    expect(r!.output).toBe(500);
    expect(r!.t).toBe(Date.parse(at(1)));
  });

  it("keeps the fuller copy when the same message appears in two chats", async () => {
    const home = tmp();
    writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(2), { id: "msg_A", output: 40 }),
    ]);
    writeSession(home, "C:\\work\\blog", (c) => [
      L.assistant(c, "claude-opus-5-5", at(5), { id: "msg_A", output: 400 }),
    ]);
    const [r] = (await indexed(home)).records();
    expect(r!.output).toBe(400);
  });

  it("updates a message whose final line arrives in a later pass", async () => {
    const home = tmp();
    const s = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "msg_A", output: 3 }),
    ]);
    const idx = await indexed(home);
    const { appendFileSync } = await import("node:fs");
    appendFileSync(
      s.file,
      `${JSON.stringify(L.assistant(s.ctx, "claude-opus-5-5", at(2), { id: "msg_A", output: 300 }))}\n`,
    );
    expect((await idx.update()).changed).toBe(true);
    expect(idx.records()[0]!.output).toBe(300);
  });

  it("re-reads a transcript that was replaced by a different file of the same or larger size", async () => {
    const home = tmp();
    const s = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "msg_OLD" }),
    ]);
    const idx = await indexed(home);
    const { renameSync, writeFileSync } = await import("node:fs");
    const replacement = `${JSON.stringify(L.assistant(s.ctx, "claude-opus-5-5", at(2), { id: "msg_NEW", text: "a much longer reply than before" }))}\n`;
    writeFileSync(`${s.file}.new`, replacement);
    renameSync(`${s.file}.new`, s.file);
    await idx.update();
    expect(idx.records().map((r) => r.id)).toEqual(["msg_NEW"]);
  });

  it("counts a message copied into another chat (resume/fork) once, earliest wins", async () => {
    const home = tmp();
    const a = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(5), { id: "msg_A" }),
    ]);
    writeSession(home, "C:\\work\\blog", (c) => [
      L.assistant(c, "claude-opus-5-5", at(2), { id: "msg_A" }),
      L.assistant(c, "claude-opus-5-5", at(9), { id: "msg_B" }),
    ]);
    const recs = (await indexed(home)).records();
    expect(recs.map((r) => r.id)).toEqual(["msg_A", "msg_B"]);
    expect(recs[0]!.cwd).toBe("C:\\work\\blog");
    expect(recs[0]!.session).not.toBe(a.id);
  });

  it("skips synthetic messages and lines without id, usage or timestamp", async () => {
    const home = tmp();
    writeSession(home, CWD, (c) => {
      const noId = L.assistant(c, "claude-opus-5-5", at(1));
      delete (noId.message as Record<string, unknown>).id;
      const noUsage = L.assistant(c, "claude-opus-5-5", at(2));
      delete (noUsage.message as Record<string, unknown>).usage;
      const noTime = L.assistant(c, "claude-opus-5-5", at(3));
      delete noTime.timestamp;
      return [
        L.assistant(c, "<synthetic>", at(4)),
        noId,
        noUsage,
        noTime,
        "{not json",
        L.user(c, 'I pasted "assistant" and "usage" here'),
        L.assistant(c, "claude-opus-5-5", at(5), { id: "msg_ok" }),
      ];
    });
    expect((await indexed(home)).records().map((r) => r.id)).toEqual(["msg_ok"]);
  });

  it("includes subagent transcripts", async () => {
    const home = tmp();
    const s = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "m1" }),
    ]);
    writeSubagent(home, CWD, s.id, (c) => [
      L.assistant(c, "claude-haiku-4-5", at(2), { id: "m2", sidechain: true }),
    ]);
    const recs = (await indexed(home)).records();
    expect(recs.map((r) => [r.id, r.session, r.model])).toEqual([
      ["m1", s.id, "claude-opus-5-5"],
      ["m2", s.id, "claude-haiku-4-5"],
    ]);
  });

  it("ignores files that are not transcripts", async () => {
    const home = tmp();
    const dir = join(home, "projects", slugFor(CWD));
    mkdirSync(join(dir, "not-a-uuid", "subagents"), { recursive: true });
    const c = { sessionId: randomUUID(), cwd: CWD };
    const body = line(L.assistant(c, "claude-opus-5-5", at(1)));
    writeFileSync(join(dir, "notes.jsonl"), body);
    writeFileSync(join(dir, `${randomUUID()}.json`), body);
    writeFileSync(join(dir, "not-a-uuid", "subagents", "agent-x.jsonl"), body);
    writeFileSync(join(home, "projects", `${randomUUID()}.jsonl`), body);
    expect((await indexed(home)).records()).toEqual([]);
  });

  it("never follows linked folders", async () => {
    const home = tmp();
    const dir = join(home, "projects", slugFor(CWD));
    const outside = join(home, "outside");
    mkdirSync(join(outside, "subagents"), { recursive: true });
    const c = { sessionId: randomUUID(), cwd: CWD };
    const body = line(L.assistant(c, "claude-opus-5-5", at(1)));
    writeFileSync(join(outside, `${randomUUID()}.jsonl`), body);
    writeFileSync(join(outside, "subagents", "agent-x.jsonl"), body);
    const session = randomUUID();
    mkdirSync(join(dir, session), { recursive: true });
    // "junction" needs no privileges on Windows and is a plain symlink elsewhere.
    symlinkSync(join(outside, "subagents"), join(dir, session, "subagents"), "junction");
    symlinkSync(join(outside, "subagents"), join(dir, randomUUID()), "junction");
    symlinkSync(outside, join(home, "projects", "linked-project"), "junction");
    const idx = await indexed(home);
    expect(idx.records()).toEqual([]);

    writeFileSync(join(dir, `${session}.jsonl`), body);
    await idx.update();
    expect(idx.records()).toHaveLength(1);
  });

  it("never follows a symlinked transcript", async (ctx) => {
    const home = tmp();
    if (!canSymlink(home)) ctx.skip();
    const dir = join(home, "projects", slugFor(CWD));
    mkdirSync(dir, { recursive: true });
    const c = { sessionId: randomUUID(), cwd: CWD };
    writeFileSync(join(home, "outside.jsonl"), line(L.assistant(c, "claude-opus-5-5", at(1))));
    symlinkSync(join(home, "outside.jsonl"), join(dir, `${randomUUID()}.jsonl`));
    expect((await indexed(home)).records()).toEqual([]);
  });

  it("reads only the appended bytes on the next update", async () => {
    const home = tmp();
    const s = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "m1" }),
    ]);
    const idx = await indexed(home);
    const size1 = statSync(s.file).size;
    expect(idx.state().files[s.file]!.offset).toBe(size1);

    // Blank out the bytes already read: if they were read again, m1 would vanish.
    writeFileSync(s.file, `${" ".repeat(size1 - 1)}\n`);
    appendFileSync(s.file, line(L.assistant(s.ctx, "claude-opus-5-5", at(2), { id: "m2" })));
    expect(await idx.update()).toEqual({ changed: true });
    expect(idx.records().map((r) => r.id)).toEqual(["m1", "m2"]);
    expect(idx.state().files[s.file]!.offset).toBe(statSync(s.file).size);
  });

  it("waits for a half-written last line, then counts it once", async () => {
    const home = tmp();
    const s = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "m1" }),
    ]);
    const idx = await indexed(home);
    const full = line(L.assistant(s.ctx, "claude-opus-5-5", at(2), { id: "m2" }));
    const cut = Math.floor(full.length / 2);

    appendFileSync(s.file, full.slice(0, cut));
    expect(await idx.update()).toEqual({ changed: false });
    expect(idx.records().map((r) => r.id)).toEqual(["m1"]);

    appendFileSync(s.file, full.slice(cut));
    expect(await idx.update()).toEqual({ changed: true });
    expect(idx.records().map((r) => r.id)).toEqual(["m1", "m2"]);
    expect(await idx.update()).toEqual({ changed: false });
    expect(idx.records()).toHaveLength(2);
  });

  it("keeps byte offsets right around multi-byte characters", async () => {
    const home = tmp();
    const s = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "m1", text: "héllo 世界 🙂 ".repeat(50) }),
    ]);
    const idx = await indexed(home);
    const full = Buffer.from(
      line(L.assistant(s.ctx, "claude-opus-5-5", at(2), { id: "m2", text: "ünïcödé 🙂🙂 中文" })),
    );
    // Cut in the middle of the emoji's four bytes.
    const cut = full.indexOf(Buffer.from("🙂")) + 2;
    appendFileSync(s.file, full.subarray(0, cut));
    await idx.update();
    expect(idx.state().files[s.file]!.offset).toBe(Buffer.byteLength(readFileSync(s.file)) - cut);

    appendFileSync(s.file, full.subarray(cut));
    appendFileSync(
      s.file,
      line(L.assistant(s.ctx, "claude-opus-5-5", at(3), { id: "m3", text: "ß" })),
    );
    await idx.update();
    expect(idx.records().map((r) => r.id)).toEqual(["m1", "m2", "m3"]);
    expect(idx.state().files[s.file]!.offset).toBe(statSync(s.file).size);
  });

  it("reindexes a file that shrank", async () => {
    const home = tmp();
    const s = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "m1" }),
      L.assistant(c, "claude-opus-5-5", at(2), { id: "m2" }),
    ]);
    const idx = await indexed(home);
    expect(idx.records()).toHaveLength(2);
    writeFileSync(s.file, line(L.assistant(s.ctx, "claude-opus-5-5", at(3), { id: "m3" })));
    expect(await idx.update()).toEqual({ changed: true });
    expect(idx.records().map((r) => r.id)).toEqual(["m3"]);
  });

  it("drops a deleted file", async () => {
    const home = tmp();
    const a = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "m1" }),
    ]);
    writeSession(home, CWD, (c) => [L.assistant(c, "claude-opus-5-5", at(2), { id: "m2" })]);
    const idx = await indexed(home);
    rmSync(a.file);
    expect(await idx.update()).toEqual({ changed: true });
    expect(idx.records().map((r) => r.id)).toEqual(["m2"]);
    expect(Object.keys(idx.state().files)).toHaveLength(1);
  });

  it("does nothing when nothing changed", async () => {
    const home = tmp();
    writeSession(home, CWD, (c) => [L.assistant(c, "claude-opus-5-5", at(1))]);
    const idx = await indexed(home);
    const first = idx.records();
    expect(await idx.update()).toEqual({ changed: false });
    expect(idx.records()).toBe(first);
  });

  it("resumes from saved state without reading again", async () => {
    const home = tmp();
    const s = writeSession(home, CWD, (c) => [
      L.assistant(c, "claude-opus-5-5", at(1), { id: "m1" }),
    ]);
    const saved = JSON.parse(JSON.stringify((await indexed(home)).state()));
    const idx = new UsageIndex(home, saved);
    expect(idx.records().map((r) => r.id)).toEqual(["m1"]);
    expect(await idx.update()).toEqual({ changed: false });

    appendFileSync(s.file, line(L.assistant(s.ctx, "claude-opus-5-5", at(1), { id: "m1" })));
    appendFileSync(s.file, line(L.assistant(s.ctx, "claude-opus-5-5", at(2), { id: "m2" })));
    expect(await idx.update()).toEqual({ changed: true });
    expect(idx.records().map((r) => r.id)).toEqual(["m1", "m2"]);
  });

  it("ignores saved state from another version", async () => {
    const home = tmp();
    writeSession(home, CWD, (c) => [L.assistant(c, "claude-opus-5-5", at(1), { id: "m1" })]);
    const bogus = { v: 1, files: { x: { size: 1, mtimeMs: 1, offset: 1, records: [] } } };
    const idx = new UsageIndex(home, bogus as never);
    expect(idx.state().files).toEqual({});
    await idx.update();
    expect(idx.records().map((r) => r.id)).toEqual(["m1"]);
  });

  it("serialises overlapping updates so nothing is read twice", async () => {
    const home = tmp();
    for (let i = 0; i < 5; i++) {
      writeSession(home, CWD, (c) => [L.assistant(c, "claude-opus-5-5", at(i), { id: `m${i}` })]);
    }
    const idx = new UsageIndex(home);
    const [a, b] = await Promise.all([idx.update(), idx.update()]);
    expect(a.changed).toBe(true);
    expect(b.changed).toBe(false);
    const st = idx.state();
    expect(Object.values(st.files).flatMap((f) => f.records)).toHaveLength(5);
  });
});
