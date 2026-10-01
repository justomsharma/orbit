import { describe, expect, it } from "vitest";
import { L, writeSession } from "../../../../test/helpers/fakeHome";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { mcpServerOf, summarize } from "../aggregate";
import { UsageIndex } from "../index";
import { mergeTools } from "../parse";
import type { UsageRecord } from "../types";

const tmp = useTmpDir();
const CWD = "/work/shop";
let n = 0;
const rec = (tools?: string[]): UsageRecord => ({
  id: `m${n++}`,
  t: 1000 + n,
  model: "claude-opus-5-5",
  session: "s1",
  cwd: CWD,
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  webSearches: 0,
  fast: false,
  usGeo: false,
  ...(tools ? { tools } : {}),
});

describe("tools in usage", () => {
  it("names the MCP server of a tool, even when the server name has underscores", () => {
    expect(mcpServerOf("mcp__github__create_issue")).toBe("github");
    expect(mcpServerOf("mcp__claude_ai_Slack__send")).toBe("claude_ai_Slack");
    expect(mcpServerOf("Read")).toBeNull();
  });

  it("counts built-in tools and MCP servers separately, most used first", () => {
    const s = summarize(
      [
        rec(["Read", "Edit"]),
        rec(["Read"]),
        rec(["mcp__github__get_pr", "mcp__github__list"]),
        rec(),
      ],
      0,
      Number.POSITIVE_INFINITY,
    );
    expect(s.tools).toEqual([
      { name: "Read", count: 2 },
      { name: "Edit", count: 1 },
    ]);
    expect(s.mcp).toEqual([{ server: "github", count: 2, tools: 2 }]);
  });

  it("merges tool names without repeats", () => {
    expect(mergeTools(["Read"], ["Read", "Edit"])).toEqual(["Read", "Edit"]);
    const a = ["Read"];
    expect(mergeTools(a, ["Read"])).toBe(a);
    expect(mergeTools(undefined, ["Bash"])).toEqual(["Bash"]);
  });

  it("collects every tool a reply called across its transcript lines", async () => {
    const home = tmp();
    writeSession(home, CWD, (c) => [
      L.toolUse(c, "Read", { file_path: "a.ts" }, { id: "msg_1", output: 5 }),
      L.toolUse(c, "Edit", { file_path: "a.ts" }, { id: "msg_1", output: 9 }),
      L.toolUse(c, "mcp__github__get_pr", {}, { id: "msg_2" }),
    ]);
    const idx = new UsageIndex(home);
    await idx.update();
    const byId = new Map(idx.records().map((r) => [r.id, r]));
    expect(byId.get("msg_1")?.tools).toEqual(["Read", "Edit"]);
    expect(byId.get("msg_1")?.output).toBe(9);
    expect(byId.get("msg_2")?.tools).toEqual(["mcp__github__get_pr"]);
  });
});
