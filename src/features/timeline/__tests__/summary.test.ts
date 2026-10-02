import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { checkpointSummaries } from "../summary";

const tmp = useTmpDir();
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe("checkpointSummaries", () => {
  it("counts files, versions and bytes per chat, ignoring anything that isn't a checkpoint", async () => {
    const home = tmp();
    const a = join(home, "file-history", A);
    mkdirSync(a, { recursive: true });
    writeFileSync(join(a, "0123456789abcdef@v1"), "12345");
    writeFileSync(join(a, "0123456789abcdef@v2"), "123");
    writeFileSync(join(a, "fedcba9876543210@v1"), "1");
    utimesSync(join(a, "0123456789abcdef@v1"), 1000, 1000);
    utimesSync(join(a, "fedcba9876543210@v1"), 1000, 1000);
    writeFileSync(join(a, "notes.txt"), "not a checkpoint");
    mkdirSync(join(home, "file-history", B), { recursive: true });
    mkdirSync(join(home, "file-history", "not-a-chat-id"), { recursive: true });
    writeFileSync(join(home, "file-history", "not-a-chat-id", "0123456789abcdef@v1"), "x");

    utimesSync(join(a, "0123456789abcdef@v2"), 2_000_000, 2_000_000);
    expect(await checkpointSummaries(home)).toEqual([
      { id: A, files: 2, versions: 3, bytes: 9, newest: 2_000_000_000 },
    ]);
  });

  it("is empty when Claude has no checkpoints folder", async () => {
    expect(await checkpointSummaries(tmp())).toEqual([]);
  });
});
