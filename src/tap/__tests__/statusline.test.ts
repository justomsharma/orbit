import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import { defaultLine, innerShell, mergeQuota, parseStatusInput, runTap } from "../statusline";

const tmp = useTmpDir();

const INPUT = {
  session_id: "0b95bc0d-e0c0-4c77-9ad4-c2b7fd22d24a",
  cwd: "/code/shop",
  model: { id: "claude-opus-5-5", display_name: "Opus 5.5" },
  cost: { total_cost_usd: 1.25 },
  context_window: { used_percentage: 42.4 },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1790760000 },
    seven_day: { used_percentage: 41.2, resets_at: 1791200000 },
  },
};

describe("parseStatusInput", () => {
  it("extracts the fields Orbit shows", () => {
    expect(parseStatusInput(JSON.stringify(INPUT))).toEqual({
      sessionId: INPUT.session_id,
      model: "Opus 5.5",
      contextPct: 42.4,
      costUsd: 1.25,
      fiveHour: { pct: 23.5, resetsAt: 1790760000 * 1000 },
      sevenDay: { pct: 41.2, resetsAt: 1791200000 * 1000 },
      spendLimit: null,
    });
  });

  it("tolerates missing windows, nulls and junk", () => {
    const r = parseStatusInput(JSON.stringify({ model: {}, context_window: { used_percentage: null } }));
    expect(r).toMatchObject({ model: null, contextPct: null, fiveHour: null, sevenDay: null });
    expect(parseStatusInput("not json")).toBeNull();
  });
});

describe("mergeQuota", () => {
  it("keeps the last known windows when a render has none (e.g. right after /clear)", () => {
    const prev = { v: 1 as const, updatedAt: 1, fiveHour: { pct: 10, resetsAt: 5 }, sevenDay: { pct: 20, resetsAt: 6 }, spendLimit: null, model: "Opus 5.5", contextPct: 3, costUsd: 0, sessionId: null };
    const next = mergeQuota(prev, { sessionId: null, model: "Opus 5.5", contextPct: 9, costUsd: 0.1, fiveHour: null, sevenDay: { pct: 21, resetsAt: 6 }, spendLimit: null }, 100);
    expect(next.fiveHour).toEqual({ pct: 10, resetsAt: 5 });
    expect(next.sevenDay).toEqual({ pct: 21, resetsAt: 6 });
    expect(next.updatedAt).toBe(100);
  });
});

describe("defaultLine", () => {
  it("shows model and context", () => {
    expect(defaultLine(parseStatusInput(JSON.stringify(INPUT)))).toBe("Opus 5.5 · 42% context");
    expect(defaultLine(null)).toBe("");
  });
});

describe("innerShell", () => {
  it("uses sh on macOS and Linux", () => {
    expect(innerShell("darwin", {})).toEqual({ file: "/bin/sh", args: ["-c"] });
  });

  it("uses Git Bash on Windows when Claude launched us from it", () => {
    expect(innerShell("win32", { MSYSTEM: "MINGW64" })).toEqual({ file: "bash", args: ["-c"] });
    expect(innerShell("win32", { SHELL: "/usr/bin/bash" })).toEqual({ file: "bash", args: ["-c"] });
  });

  it("uses PowerShell on Windows otherwise", () => {
    expect(innerShell("win32", {})).toEqual({
      file: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command"],
    });
  });
});

describe("runTap", () => {
  it("records quota, then prints the person's own statusline output", () => {
    const dir = tmp();
    writeFileSync(join(dir, "statusline-inner.json"), JSON.stringify({ command: "my-status" }));
    const seen: { cmd: string; input: string }[] = [];
    const out = runTap(JSON.stringify(INPUT), dir, {
      now: () => 777,
      runInner: (cmd, input) => {
        seen.push({ cmd, input });
        return "custom line\n";
      },
    });
    expect(out).toBe("custom line\n");
    expect(seen).toEqual([{ cmd: "my-status", input: JSON.stringify(INPUT) }]);
    const q = JSON.parse(readFileSync(join(dir, "quota.json"), "utf8"));
    expect(q).toMatchObject({ v: 1, updatedAt: 777, fiveHour: { pct: 23.5 } });
  });

  it("prints a default line when there is no previous statusline", () => {
    const out = runTap(JSON.stringify(INPUT), tmp(), { now: () => 1, runInner: () => "x" });
    expect(out).toBe("Opus 5.5 · 42% context");
  });

  it("never throws: bad input, unwritable folder, failing inner command", () => {
    expect(runTap("{", join(tmp(), "missing", "deeper"), { now: () => 1, runInner: () => "" })).toBe("");
    const dir = tmp();
    writeFileSync(join(dir, "statusline-inner.json"), JSON.stringify({ command: "boom" }));
    const out = runTap(JSON.stringify(INPUT), dir, {
      now: () => 1,
      runInner: () => {
        throw new Error("boom");
      },
    });
    expect(out).toBe("Opus 5.5 · 42% context");
  });
});
