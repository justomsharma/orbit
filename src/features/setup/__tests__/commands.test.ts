import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { readCommands } from "../commands";
import { OVERSIZED, put } from "./helpers";

const tmp = useTmpDir();

function setup() {
  const root = tmp();
  return { home: join(root, "claude"), ws: join(root, "ws"), plug: join(root, "plug") };
}

describe("readCommands", () => {
  it("reads commands from every root with namespaces and plugin prefixes", async () => {
    const { home, ws, plug } = setup();
    put(
      home,
      "commands/review.md",
      "---\ndescription: Review the diff\nargument-hint: [file]\n---\nReview $ARGUMENTS\n",
    );
    put(
      ws,
      ".claude/commands/frontend/build.md",
      "---\ndescription: Build UI\n---\nnpm run build\n",
    );
    put(ws, ".claude/commands/a/b/c.md", "---\ndescription: Deep\n---\nx\n");
    put(ws, ".claude/commands/notes.txt", "not a command");
    put(plug, "commands/release.md", "---\ndescription: Cut a release\n---\nGo\n");

    const cmds = await readCommands(home, ws, [{ id: "shipit@market", installPath: plug }]);
    expect(cmds.map((c) => [c.scope, c.name])).toEqual([
      ["project", "a:b:c"],
      ["project", "frontend:build"],
      ["user", "review"],
      ["plugin", "shipit:release"],
    ]);
    expect(cmds.find((c) => c.name === "review")).toEqual({
      name: "review",
      description: "Review the diff",
      argumentHint: "[file]",
      scope: "user",
      plugin: null,
      file: join(home, "commands", "review.md"),
      problems: [],
    });
    expect(cmds.find((c) => c.scope === "plugin")!.plugin).toBe("shipit@market");
  });

  it("uses the first body line when there is no description", async () => {
    const { home } = setup();
    put(home, "commands/fix.md", "\n\n   Fix the failing tests carefully   \nmore\n");
    put(home, "commands/long.md", `---\nargument-hint: x\n---\n\n${"word ".repeat(60)}\n`);
    const cmds = await readCommands(home, null, []);
    const fix = cmds.find((c) => c.name === "fix")!;
    expect(fix.description).toBe("Fix the failing tests carefully");
    expect(fix.problems).toEqual([]);
    const long = cmds.find((c) => c.name === "long")!;
    expect(long.description!.length).toBeLessThanOrEqual(120);
    expect(long.argumentHint).toBe("x");
  });

  it("reports empty, broken and unreadable command files", async () => {
    const { home } = setup();
    put(home, "commands/empty.md", "  \n");
    put(home, "commands/broken.md", '---\ndescription: "oops\n---\nbody\n');
    put(home, "commands/big.md", OVERSIZED);
    const cmds = await readCommands(home, null, []);
    const by = (n: string) => cmds.find((c) => c.name === n)!;
    expect(by("empty").problems).toEqual(["Empty command"]);
    expect(by("empty").description).toBeNull();
    expect(by("broken").problems[0]).toMatch(/^Frontmatter is not valid YAML/);
    expect(by("big").problems).toEqual(["Could not read this file"]);
  });

  it("stops descending after four folder levels", async () => {
    const { home } = setup();
    put(home, "commands/1/2/3/4/ok.md", "x");
    put(home, "commands/1/2/3/4/5/deep.md", "x");
    expect((await readCommands(home, null, [])).map((c) => c.name)).toEqual(["1:2:3:4:ok"]);
  });

  it("accepts argument hints written the way Claude Code's docs show them", async () => {
    const { home } = setup();
    put(home, "commands/assign.md", "---\nargument-hint: [pr-number] [priority]\n---\nGo\n");
    const [c] = await readCommands(home, null, []);
    expect(c).toMatchObject({ argumentHint: "[pr-number] [priority]", problems: [] });
  });

  it("never throws when roots are missing", async () => {
    const { home, ws } = setup();
    expect(await readCommands(home, ws, [{ id: "p@m", installPath: join(ws, "x") }])).toEqual([]);
  });
});
