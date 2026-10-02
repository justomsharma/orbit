import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { unzip, zip } from "../../../core/zip";
import { collectBrain, planImport, readBrain } from "../brain";

const tmp = useTmpDir();

const put = (root: string, rel: string, text: string | Buffer) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
};

function machine() {
  const root = tmp();
  const home = join(root, ".claude");
  const ws = join(root, "shop");
  const claudeJson = join(root, ".claude.json");
  put(home, "CLAUDE.md", "# Me\n");
  put(home, "settings.json", JSON.stringify({ model: "opus", env: { API_KEY: "sk-secret" } }));
  put(home, "skills/notes/SKILL.md", "---\nname: notes\n---\n");
  put(home, "skills/notes/scripts/run.sh", "echo hi\n");
  put(home, "skills/notes/logo.png", Buffer.from([0x89, 0x50, 0x00, 0xff]));
  put(home, "agents/reviewer.md", "agent\n");
  put(home, "commands/ship.md", "ship\n");
  put(home, ".credentials.json", '{"token":"never"}');
  put(home, "projects/x/chat.jsonl", "{}");
  writeFileSync(
    claudeJson,
    JSON.stringify({
      oauthAccount: { emailAddress: "a@b.c" },
      mcpServers: {
        gh: { type: "http", url: "https://x/mcp", headers: { Authorization: "Bearer t" } },
        fs: { command: "npx", args: ["srv"], env: { TOKEN: "t" } },
      },
    }),
  );
  put(ws, "CLAUDE.md", "# Shop\n");
  put(ws, ".mcp.json", JSON.stringify({ mcpServers: {} }));
  put(ws, ".claude/settings.json", JSON.stringify({ effortLevel: "high" }));
  put(ws, ".claude/settings.local.json", JSON.stringify({ env: { X: "1" } }));
  put(ws, ".claude/skills/deploy/SKILL.md", "deploy\n");
  return { root, home, ws, claudeJson };
}

const names = (e: { name: string }[]) => e.map((x) => x.name).sort();

describe("collectBrain", () => {
  it("packs your setup and leaves out secrets, chats and binary files", async () => {
    const m = machine();
    const b = await collectBrain({ ...m, workspace: m.ws, scope: "both" });
    expect(names(b.entries)).toEqual([
      "manifest.json",
      "project/.claude/settings.json",
      "project/.claude/skills/deploy/SKILL.md",
      "project/.mcp.json",
      "project/CLAUDE.md",
      "user/CLAUDE.md",
      "user/agents/reviewer.md",
      "user/commands/ship.md",
      "user/mcpServers.json",
      "user/settings.json",
      "user/skills/notes/SKILL.md",
      "user/skills/notes/scripts/run.sh",
    ]);
    const text = (n: string) => b.entries.find((e) => e.name === n)!.data.toString("utf8");
    expect(JSON.parse(text("user/settings.json"))).toEqual({ model: "opus" });
    expect(JSON.parse(text("user/mcpServers.json"))).toEqual({
      gh: { type: "http", url: "https://x/mcp", headers: { Authorization: "" } },
      fs: { command: "npx", args: ["srv"], env: { TOKEN: "" } },
    });
    const all = b.entries.map((e) => e.data.toString("utf8")).join("\n");
    for (const secret of ["sk-secret", "Bearer t", '"t"', "never", "a@b.c"])
      expect(all).not.toContain(secret);
    expect(b.left).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/env/),
        expect.stringMatching(/logo\.png/),
        expect.stringMatching(/gh, fs|fs, gh/),
      ]),
    );
  });

  it("masks keys in server arguments and addresses, and skips .env and key files", async () => {
    const m = machine();
    writeFileSync(
      m.claudeJson,
      JSON.stringify({
        mcpServers: {
          c7: { command: "npx", args: ["ctx-mcp", "--api-key", "sk-live-123456789abcdef"] },
          web: { type: "http", url: "https://mcp.x.com/mcp?token=abcdef1234567890" },
        },
      }),
    );
    put(
      m.ws,
      ".mcp.json",
      JSON.stringify({
        mcpServers: { db: { command: "pg", args: ["--password=hunter2hunter2"] } },
      }),
    );
    put(m.home, "skills/notes/.env", "API_KEY=sk-live-999");
    put(m.home, "skills/notes/server.pem", "-----BEGIN PRIVATE KEY-----");
    const b = await collectBrain({ ...m, workspace: m.ws, scope: "both" });
    const all = b.entries.map((e) => e.data.toString("utf8")).join("\n");
    for (const secret of [
      "sk-live-123456789abcdef",
      "abcdef1234567890",
      "hunter2hunter2",
      "sk-live-999",
      "PRIVATE KEY",
    ])
      expect(all).not.toContain(secret);
    expect(names(b.entries).some((n) => n.endsWith(".env") || n.endsWith(".pem"))).toBe(false);
  });

  it("packs only what you pick, and never follows links", async (ctx) => {
    const m = machine();
    try {
      symlinkSync(join(m.root), join(m.home, "skills", "loop"), "junction");
    } catch {
      ctx.skip();
    }
    const b = await collectBrain({ ...m, workspace: m.ws, scope: "user" });
    expect(names(b.entries).every((n) => n === "manifest.json" || n.startsWith("user/"))).toBe(
      true,
    );
    expect(names(b.entries).some((n) => n.includes("loop"))).toBe(false);
  });
});

describe("importing", () => {
  it("reads a brain, refusing names that leave its folders", () => {
    const good = zip([
      {
        name: "manifest.json",
        data: Buffer.from(JSON.stringify({ app: "orbit-brain", version: 1 })),
      },
      { name: "user/CLAUDE.md", data: Buffer.from("x") },
    ]);
    expect(readBrain(unzip(good)).files.map((f) => f.name)).toEqual(["user/CLAUDE.md"]);
    const bad = zip([
      {
        name: "manifest.json",
        data: Buffer.from(JSON.stringify({ app: "orbit-brain", version: 1 })),
      },
      { name: "user/../../evil.md", data: Buffer.from("x") },
    ]);
    expect(() => readBrain(unzip(bad))).toThrow(/isn't safe/);
    for (const name of [
      "project/.git/hooks/post-checkout",
      "project/.vscode/tasks.json",
      "user/.credentials.json",
      "user/skills/x/.env",
    ]) {
      const odd = zip([
        {
          name: "manifest.json",
          data: Buffer.from(JSON.stringify({ app: "orbit-brain", version: 1 })),
        },
        { name, data: Buffer.from("x") },
      ]);
      expect(() => readBrain(unzip(odd)), name).toThrow(/isn't something a backup holds/);
    }
    expect(() => readBrain(unzip(zip([{ name: "a.txt", data: Buffer.from("") }])))).toThrow(
      /isn't an Orbit brain/,
    );
  });

  it("maps each file to where it goes, saying which already exist", async () => {
    const m = machine();
    const b = await collectBrain({ ...m, workspace: m.ws, scope: "both" });
    const fresh = tmp();
    const target = { home: join(fresh, ".claude"), workspace: join(fresh, "shop") };
    put(target.home, "CLAUDE.md", "mine\n");
    const plan = planImport(readBrain(b.entries), target, ["user", "project"]);
    const claudeMd = plan.files.find((f) => f.name === "user/CLAUDE.md")!;
    expect(claudeMd).toMatchObject({ target: join(target.home, "CLAUDE.md"), exists: true });
    expect(plan.files.find((f) => f.name === "project/.mcp.json")!.target).toBe(
      join(target.workspace, ".mcp.json"),
    );
    expect(Object.keys(plan.mcpServers)).toEqual(["gh", "fs"]);
  });

  it("leaves out a whole part you didn't pick, and project files without a folder", async () => {
    const m = machine();
    const b = readBrain((await collectBrain({ ...m, workspace: m.ws, scope: "both" })).entries);
    const plan = planImport(b, { home: join(tmp(), ".claude"), workspace: null }, [
      "user",
      "project",
    ]);
    expect(plan.files.some((f) => f.name.startsWith("project/"))).toBe(false);
    expect(plan.skipped).toEqual(expect.arrayContaining([expect.stringMatching(/Open a folder/)]));
  });
});
