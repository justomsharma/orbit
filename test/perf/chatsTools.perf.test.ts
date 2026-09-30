import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchMessages } from "../../src/features/chats/search";
import { transcriptMarkdown } from "../../src/features/chats/transcript";
import { PromptLibrary } from "../../src/features/prompts/library";
import { readTimeline } from "../../src/features/timeline/reader";
import { L, writeSession } from "../helpers/fakeHome";
import { useTmpDir } from "../helpers/tmp";

const tmp = useTmpDir();

describe("chats tools performance", () => {
  it("reads 50 000 prompts of history quickly, and only new lines after that", async () => {
    const home = tmp();
    const id = randomUUID();
    const lines = Array.from({ length: 50_000 }, (_, i) =>
      JSON.stringify({
        display: `prompt number ${i % 5000} about the checkout flow`,
        pastedContents: {},
        timestamp: i,
        project: "/code/shop",
        sessionId: id,
      }),
    );
    writeFileSync(join(home, "history.jsonl"), `${lines.join("\n")}\n`);
    const lib = new PromptLibrary(home);
    let t0 = performance.now();
    expect(await lib.update()).toHaveLength(5000);
    expect(performance.now() - t0).toBeLessThan(1500);
    t0 = performance.now();
    await lib.update();
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("reads a chat with 5 000 checkpoints quickly", async () => {
    const home = tmp();
    const cwd = "/code/shop";
    const s = writeSession(home, cwd, (c) =>
      Array.from({ length: 5000 }, (_, i) =>
        L.fileDelta(c, `src/f${i % 250}.ts`, {
          backupFileName: `${(i % 250).toString(16).padStart(16, "0")}@v${Math.floor(i / 250) + 1}`,
          version: Math.floor(i / 250) + 1,
          realParentDir: join(cwd, "src"),
        }),
      ),
    );
    const t0 = performance.now();
    const files = await readTimeline({ home, sessionId: s.id, transcript: s.file, cwd });
    expect(files).toHaveLength(250);
    expect(files[0]!.versions).toHaveLength(20);
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it("searches ~60 MB of chats and renders a large transcript within budget", async () => {
    const home = tmp();
    const sessions = [];
    const text = "We refactored the payment webhook handler and added retries. ".repeat(40);
    for (let i = 0; i < 60; i++) {
      sessions.push(
        writeSession(home, `/code/p${i % 6}`, (c) => {
          const out: Record<string, unknown>[] = [];
          for (let j = 0; j < 400; j++) {
            out.push(L.user(c, `question ${j}: ${text}`));
            out.push(L.assistant(c, "claude-opus-5-5", undefined, { text }));
          }
          if (i === 59) out.push(L.user(c, "where is the golden set kept?"));
          return out;
        }),
      );
    }
    const files = sessions.map((s) => ({ id: s.id, file: s.file }));
    let t0 = performance.now();
    const hits = await searchMessages(files, "golden set");
    expect(hits.map((h) => h.sessionId)).toEqual([sessions[59]!.id]);
    expect(performance.now() - t0).toBeLessThan(8000);

    t0 = performance.now();
    const md = await transcriptMarkdown(sessions[0]!.file, { title: "Big chat" });
    expect(md.startsWith("# Big chat")).toBe(true);
    expect(performance.now() - t0).toBeLessThan(2000);
  }, 120_000);
});
