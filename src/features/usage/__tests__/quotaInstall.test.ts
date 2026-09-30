import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import { OrbitStore } from "../../../core/orbitStore";
import { SafeWriter } from "../../../core/safeWriter";
import { QuotaInstaller, tapCommand } from "../quotaInstall";

const tmp = useTmpDir();

function setup(
  opts: { node?: string | null; settings?: unknown; platform?: NodeJS.Platform } = {},
) {
  const root = tmp();
  const claude = join(root, "claude");
  mkdirSync(claude, { recursive: true });
  const settings = join(claude, "settings.json");
  if (opts.settings !== undefined) {
    writeFileSync(
      settings,
      typeof opts.settings === "string"
        ? opts.settings
        : `${JSON.stringify(opts.settings, null, 4)}\n`,
    );
  }
  const storage = join(root, "storage");
  const tapSource = join(root, "dist-tap.js");
  writeFileSync(tapSource, "// tap");
  const q = new QuotaInstaller({
    settingsPath: settings,
    tapDir: join(storage, "statusline"),
    tapSource,
    store: new OrbitStore(storage),
    writer: new SafeWriter(join(storage, "backups")),
    findNode: async () => (opts.node === undefined ? "/usr/bin/node" : opts.node),
    platform: opts.platform ?? "linux",
  });
  const read = () => JSON.parse(readFileSync(settings, "utf8"));
  return { q, settings, storage, read };
}

describe("tapCommand", () => {
  it("quotes paths for sh on macOS and Linux", () => {
    expect(tapCommand("/usr/bin/node", "/home/a/it's/tap.js", "linux")).toBe(
      `'/usr/bin/node' '/home/a/it'\\''s/tap.js'`,
    );
  });

  it("works in both Git Bash and PowerShell on Windows", () => {
    expect(
      tapCommand("C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\A B\\tap.js", "win32"),
    ).toBe(`node "C:/Users/A B/tap.js"`);
  });
});

describe("QuotaInstaller", () => {
  it("turns on: sets Orbit's statusline, copies the tap, keeps other settings and formatting", async () => {
    const { q, settings, storage, read } = setup({ settings: { model: "opus", theme: "dark" } });
    expect(await q.enable()).toEqual({ ok: true });
    const s = read();
    expect(s.model).toBe("opus");
    expect(s.statusLine.type).toBe("command");
    expect(s.statusLine.command).toContain("statusline-tap.js");
    expect(readFileSync(settings, "utf8")).toMatch(/^\{\n {4}"/);
    expect(existsSync(join(storage, "statusline", "statusline-tap.js"))).toBe(true);
    expect((await q.status()).enabled).toBe(true);
  });

  it("keeps the person's own statusline running through the tap, and restores it exactly", async () => {
    const mine = { type: "command", command: "~/bin/my-status.sh", padding: 2 };
    const { q, storage, read } = setup({ settings: { statusLine: mine } });
    await q.enable();
    const inner = JSON.parse(
      readFileSync(join(storage, "statusline", "statusline-inner.json"), "utf8"),
    );
    expect(inner.command).toBe("~/bin/my-status.sh");
    expect(read().statusLine.padding).toBe(2);
    expect(await q.disable()).toEqual({ ok: true });
    expect(read().statusLine).toEqual(mine);
  });

  it("removes the statusline entirely on turn-off when there was none before", async () => {
    const { q, read } = setup({ settings: { model: "opus" } });
    await q.enable();
    await q.disable();
    expect(read()).toEqual({ model: "opus" });
  });

  it("creates settings.json when Claude has none yet", async () => {
    const { q, read } = setup();
    expect(await q.enable()).toEqual({ ok: true });
    expect(read().statusLine.command).toContain("statusline-tap.js");
  });

  it("does not touch a statusline the person changed after turning Orbit's on", async () => {
    const { q, settings, read } = setup({ settings: {} });
    await q.enable();
    const theirs = { statusLine: { type: "command", command: "echo mine" } };
    writeFileSync(settings, JSON.stringify(theirs));
    expect(await q.disable()).toEqual({ ok: true });
    expect(read()).toEqual(theirs);
    expect((await q.status()).enabled).toBe(false);
  });

  it("is idempotent: turning on twice does not chain Orbit to itself", async () => {
    const { q, storage } = setup({ settings: {} });
    await q.enable();
    await q.enable();
    const innerPath = join(storage, "statusline", "statusline-inner.json");
    const inner = existsSync(innerPath) ? JSON.parse(readFileSync(innerPath, "utf8")) : {};
    expect(inner.command ?? "").not.toContain("statusline-tap.js");
  });

  it("explains instead of writing when Node.js is missing", async () => {
    const { q, settings } = setup({ node: null, settings: { a: 1 } });
    expect(await q.enable()).toEqual({ ok: false, reason: "no-node" });
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({ a: 1 });
  });

  it("refuses to edit a settings file that isn't plain JSON", async () => {
    const { q, settings } = setup({ settings: '{ "a": 1, // comment\n}' });
    expect(await q.enable()).toEqual({ ok: false, reason: "unparseable" });
    expect(readFileSync(settings, "utf8")).toBe('{ "a": 1, // comment\n}');
  });

  it("reads the latest plan-limit numbers the tap recorded", async () => {
    const { q, storage } = setup({ settings: {} });
    await q.enable();
    writeFileSync(
      join(storage, "statusline", "quota.json"),
      JSON.stringify({
        v: 1,
        updatedAt: 5,
        fiveHour: { pct: 30, resetsAt: 9 },
        sevenDay: null,
        spendLimit: null,
      }),
    );
    expect(await q.readQuota()).toMatchObject({ updatedAt: 5, fiveHour: { pct: 30, resetsAt: 9 } });
  });
});
