import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { diagnose, reportMarkdown } from "../diagnose";

const tmp = useTmpDir();

function machine(o: { signedIn?: boolean; badJson?: boolean } = {}) {
  const root = tmp();
  const home = join(root, ".claude");
  mkdirSync(home, { recursive: true });
  const claudeJson = join(root, ".claude.json");
  if (o.signedIn) writeFileSync(join(home, ".credentials.json"), "{}");
  writeFileSync(
    claudeJson,
    o.badJson
      ? "{ nope"
      : JSON.stringify(o.signedIn ? { oauthAccount: { emailAddress: "a@b.c" } } : {}),
  );
  return { root, home, claudeJson };
}

const base = (m: ReturnType<typeof machine>) => ({
  ...m,
  userHome: m.root,
  claudeOnPath: async () => true,
  vscodeVersion: "1.106.0",
  orbitVersion: "0.3.0",
  platform: "win32" as NodeJS.Platform,
  workspace: null,
  problems: [] as string[],
});

describe("diagnose", () => {
  it("passes a healthy setup", async () => {
    const m = machine({ signedIn: true });
    const checks = await diagnose(base(m));
    expect(checks.filter((c) => !c.ok)).toEqual([expect.objectContaining({ id: "workspace" })]);
  });

  it("explains each problem with how to fix it", async () => {
    const m = machine({ badJson: true });
    const checks = await diagnose({
      ...base(m),
      claudeOnPath: async () => false,
      problems: ["Hook script ~/bin/x.sh is missing"],
    });
    const bad = Object.fromEntries(checks.filter((c) => !c.ok).map((c) => [c.id, c.fix]));
    expect(bad.cli).toMatch(/Install Claude Code/);
    expect(bad.claudeJson).toMatch(/Account tab/);
    expect(bad.setup).toMatch(/Config/);
  });

  it("writes a report without your email, folders or name", async () => {
    const m = machine({ signedIn: true });
    const md = reportMarkdown(await diagnose(base(m)), base(m));
    expect(md).toMatch(/^# Orbit diagnostics/);
    expect(md).toContain("VS Code 1.106.0");
    expect(md).not.toContain("a@b.c");
    expect(md).not.toContain(m.root);
  });
});
