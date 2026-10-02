import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../test/helpers/tmp";
import type { ConfirmHost } from "../../core/applyEdit";
import { SafeWriter } from "../../core/safeWriter";
import { unzip } from "../../core/zip";
import { type BrainDeps, exportBrain, importBrain } from "../brainHandler";

const tmp = useTmpDir();

const put = (root: string, rel: string, text: string) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
};

function deps(over: Partial<BrainDeps> & { root: string }) {
  const log: string[] = [];
  const undos: (() => Promise<boolean>)[] = [];
  const home = join(over.root, ".claude");
  const confirm: ConfirmHost = {
    confirm: async (s, w) => {
      log.push(`confirm ${s}${w ? ` ⚠ ${w}` : ""}`);
      return "apply";
    },
    showDiff: async () => {},
    done: async (label, undo) => {
      log.push(`done ${label}`);
      undos.push(undo);
    },
    warn: (m) => log.push(`warn ${m}`),
  };
  const d: BrainDeps = {
    home,
    claudeJson: join(over.root, ".claude.json"),
    workspace: () => null,
    writer: new SafeWriter(join(over.root, "backups")),
    confirm,
    pickScope: async () => "user",
    pickParts: async (has) => has,
    saveZip: async () => null,
    openZip: async () => null,
    info: (m) => log.push(`info ${m}`),
    refresh: async () => {},
    ...over,
  };
  return { d, log, undos, home };
}

describe("brain export", () => {
  it("saves a zip of your setup and says what was left out", async () => {
    const root = tmp();
    let saved: Buffer | null = null;
    const { d, log, home } = deps({
      root,
      saveZip: async (_n, b) => {
        saved = b;
        return join(root, "me.claudebrain.zip");
      },
    });
    put(home, "CLAUDE.md", "# Me\n");
    put(home, "settings.json", JSON.stringify({ env: { K: "v" } }));
    await exportBrain(d);
    expect(unzip(saved!).map((e) => e.name)).toContain("user/CLAUDE.md");
    expect(log[0]).toMatch(/^info Saved your brain .* Left out: .*env/);
  });
});

describe("brain import", () => {
  it("asks once, warns about what it replaces, backs everything up and undoes it all", async () => {
    const src = tmp();
    let bytes: Buffer | null = null;
    const a = deps({
      root: src,
      saveZip: async (_n, b) => {
        bytes = b;
        return "x";
      },
    });
    put(a.home, "CLAUDE.md", "# From backup\n");
    put(a.home, "skills/notes/SKILL.md", "notes\n");
    writeFileSync(a.d.claudeJson, JSON.stringify({ mcpServers: { gh: { url: "https://x" } } }));
    await exportBrain(a.d);

    const dst = tmp();
    const b = deps({ root: dst, openZip: async () => bytes });
    put(b.home, "CLAUDE.md", "mine\n");
    writeFileSync(b.d.claudeJson, JSON.stringify({ numStartups: 3 }));
    await importBrain(b.d);
    expect(b.log[0]).toMatch(
      /^confirm Import 3 items from this backup\?.* ⚠ .*Replaces 1: ~\/\.claude\/CLAUDE\.md/,
    );
    expect(readFileSync(join(b.home, "CLAUDE.md"), "utf8")).toBe("# From backup\n");
    expect(readFileSync(join(b.home, "skills", "notes", "SKILL.md"), "utf8")).toBe("notes\n");
    expect(JSON.parse(readFileSync(b.d.claudeJson, "utf8"))).toEqual({
      numStartups: 3,
      mcpServers: { gh: { url: "https://x" } },
    });
    expect(await b.undos[0]!()).toBe(true);
    expect(readFileSync(join(b.home, "CLAUDE.md"), "utf8")).toBe("mine\n");
    expect(existsSync(join(b.home, "skills", "notes", "SKILL.md"))).toBe(false);
    expect(JSON.parse(readFileSync(b.d.claudeJson, "utf8"))).toEqual({ numStartups: 3 });
  });

  it("merges settings and a project's servers, keeping the secrets you already have", async () => {
    const src = tmp();
    let bytes: Buffer | null = null;
    const ws = join(src, "shop");
    const a = deps({
      root: src,
      workspace: () => ws,
      pickScope: async () => "both",
      saveZip: async (_n, b) => {
        bytes = b;
        return "x";
      },
    });
    put(
      a.home,
      "settings.json",
      JSON.stringify({ model: "opus", env: { K: "from-backup-machine" } }),
    );
    put(
      ws,
      ".mcp.json",
      JSON.stringify({
        mcpServers: { db: { command: "pg", env: { PW: "old" } }, new: { command: "x" } },
      }),
    );
    await exportBrain(a.d);

    const dst = tmp();
    const ws2 = join(dst, "shop");
    const b = deps({ root: dst, workspace: () => ws2, openZip: async () => bytes });
    put(b.home, "settings.json", JSON.stringify({ theme: "dark", env: { K: "mine" } }));
    put(
      ws2,
      ".mcp.json",
      JSON.stringify({ mcpServers: { db: { command: "pg", env: { PW: "real" } } } }),
    );
    await importBrain(b.d);
    expect(JSON.parse(readFileSync(join(b.home, "settings.json"), "utf8"))).toEqual({
      theme: "dark",
      model: "opus",
      env: { K: "mine" },
    });
    expect(JSON.parse(readFileSync(join(ws2, ".mcp.json"), "utf8")).mcpServers).toEqual({
      db: { command: "pg", env: { PW: "real" } },
      new: { command: "x" },
    });
  });

  it("keeps an MCP server you already have", async () => {
    const src = tmp();
    let bytes: Buffer | null = null;
    const a = deps({
      root: src,
      saveZip: async (_n, b) => {
        bytes = b;
        return "x";
      },
    });
    writeFileSync(a.d.claudeJson, JSON.stringify({ mcpServers: { gh: { url: "https://new" } } }));
    await exportBrain(a.d);
    const b = deps({ root: tmp(), openZip: async () => bytes });
    writeFileSync(b.d.claudeJson, JSON.stringify({ mcpServers: { gh: { url: "https://mine" } } }));
    await importBrain(b.d);
    expect(JSON.parse(readFileSync(b.d.claudeJson, "utf8")).mcpServers.gh.url).toBe("https://mine");
    expect(b.log.some((l) => /kept your own: gh/.test(l))).toBe(true);
  });

  it("says so for a file that isn't a brain, and writes nothing", async () => {
    const b = deps({ root: tmp(), openZip: async () => Buffer.from("not a zip") });
    await importBrain(b.d);
    expect(b.log).toEqual([expect.stringMatching(/^warn /)]);
  });
});
