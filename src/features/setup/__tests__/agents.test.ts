import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { readAgents } from "../agents";
import { OVERSIZED, put } from "./helpers";

const tmp = useTmpDir();

function setup() {
  const root = tmp();
  return { home: join(root, "claude"), ws: join(root, "ws"), plug: join(root, "plug") };
}

describe("readAgents", () => {
  it("reads agents from every root, with tools as a string or a list", async () => {
    const { home, ws, plug } = setup();
    put(
      home,
      "agents/reviewer.md",
      "---\nname: reviewer\ndescription: Reviews code\ntools: Read, Grep, Glob\nmodel: sonnet\n---\nYou review.\n",
    );
    put(
      ws,
      ".claude/agents/tester.md",
      "---\ndescription: Runs tests\ntools:\n  - Bash\n  - Read\nmodel: claude-opus-5-5\n---\n",
    );
    put(ws, ".claude/agents/nested/skip.md", "---\ndescription: not direct\n---\n");
    put(
      plug,
      "agents/scout.md",
      "---\nname: scout\ndescription: Looks around\nmodel: inherit\n---\n",
    );

    const agents = await readAgents(home, ws, [{ id: "crew@market", installPath: plug }]);
    expect(agents.map((a) => [a.scope, a.name])).toEqual([
      ["project", "tester"],
      ["user", "reviewer"],
      ["plugin", "scout"],
    ]);
    expect(agents[1]).toEqual({
      name: "reviewer",
      description: "Reviews code",
      tools: ["Read", "Grep", "Glob"],
      model: "sonnet",
      scope: "user",
      plugin: null,
      file: join(home, "agents", "reviewer.md"),
      problems: [],
    });
    expect(agents[0]).toMatchObject({
      tools: ["Bash", "Read"],
      model: "claude-opus-5-5",
      problems: [],
    });
    expect(agents[2]).toMatchObject({ plugin: "crew@market", problems: [] });
  });

  it("reports an unknown model, a missing description and bad YAML", async () => {
    const { home } = setup();
    put(home, "agents/fast.md", "---\ndescription: Quick\nmodel: gpt-4\n---\n");
    put(home, "agents/quiet.md", "---\nname: quiet\n---\nNo description here\n");
    put(home, "agents/broken.md", '---\nmodel: "x\n---\n');
    const agents = await readAgents(home, null, []);
    const by = (n: string) => agents.find((a) => a.name === n)!;
    expect(by("fast").problems).toEqual(["Unknown model 'gpt-4'"]);
    expect(by("quiet").problems).toEqual(["No description — Claude won't know when to use it"]);
    expect(by("quiet").tools).toEqual([]);
    expect(by("broken").problems[0]).toMatch(/^Frontmatter is not valid YAML/);
  });

  it("reports an unreadable agent file instead of dropping it", async () => {
    const { home } = setup();
    put(home, "agents/big.md", OVERSIZED);
    const [a] = await readAgents(home, null, []);
    expect(a).toMatchObject({ name: "big", problems: ["Could not read this file"] });
  });

  it("never throws when roots are missing", async () => {
    const { home, ws } = setup();
    expect(await readAgents(home, ws, [{ id: "p@m", installPath: "" }])).toEqual([]);
  });
});
