import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Orbit's safety promises, enforced on the source itself:
 *  - 100% local: no network APIs.
 *  - Nothing is typed into a shell.
 *  - Only the files listed in WRITERS may touch the file system for writing.
 */

const ROOT = join(__dirname, "..", "src");
/** Files allowed to write. Each one is reviewed and tested for backup/undo behaviour. */
const WRITERS: string[] = [
  "core/safeWriter.ts",
  "core/orbitStore.ts",
  // The statusline tap writes only quota.json in its own folder (Orbit storage).
  "tap/statusline.ts",
];
/**
 * Files allowed to start a shell. The tap runs the person's own previous
 * statusline command, in the same shell Claude Code would have used.
 */
const SHELL_ALLOWED = ["tap/statusline.ts"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

const files = sources(ROOT).map((p) => ({
  path: relative(ROOT, p).split(sep).join("/"),
  text: readFileSync(p, "utf8"),
}));

const NETWORK = [
  /\bfetch\s*\(/,
  /from\s+["'](node:)?(http|https|http2|net|tls|dgram|dns)["']/,
  /require\(["'](node:)?(http|https|http2|net|tls|dgram|dns)["']\)/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /navigator\.sendBeacon/,
];

const WRITES = [
  /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\b/,
  /\b(rename|renameSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|copyFile|copyFileSync|mkdir|mkdirSync|truncate|truncateSync|symlink|symlinkSync|chmod|chmodSync)\s*\(/,
  /workspace\.fs\.(writeFile|delete|rename|copy|createDirectory)/,
];

describe("safety guards", () => {
  it("found the source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(NETWORK.map((re) => [re.source, re]))("no network API: %s", (_, re) => {
    const hits = files.filter((f) => re.test(f.text)).map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it("never types into a terminal", () => {
    expect(files.filter((f) => /\bsendText\b/.test(f.text)).map((f) => f.path)).toEqual([]);
  });

  it("never runs a command through a shell (except the reviewed statusline tap)", () => {
    const hits = files
      .filter((f) => !SHELL_ALLOWED.includes(f.path))
      .filter((f) => /\b(exec|execSync|spawnSync|spawn)\s*\(|shell:\s*true/.test(f.text))
      .map((f) => f.path);
    expect(hits).toEqual([]);
  });

  it("only approved files write to disk", () => {
    const hits = files
      .filter((f) => !WRITERS.includes(f.path) && WRITES.some((re) => re.test(f.text)))
      .map((f) => f.path);
    expect(hits).toEqual([]);
  });
});

describe("safety guards on the built bundles", () => {
  const bundles = ["dist/extension.js", "dist/statusline-tap.js", "dist/webview/main.js"].map((p) =>
    join(__dirname, "..", p),
  );

  for (const p of bundles)
    it(`${p} loads no network module`, (ctx) => {
      let text: string;
      try {
        text = readFileSync(p, "utf8");
      } catch {
        ctx.skip(); // not built yet; `npm run build` first
        return;
      }
      expect(text).not.toMatch(/require\(["'](node:)?(http|https|http2|net|tls|dgram|dns)["']\)/);
      expect(text).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|new WebSocket|EventSource\(|sendBeacon/,
      );
    });
});
