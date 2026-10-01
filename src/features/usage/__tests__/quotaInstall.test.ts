import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTmpDir } from "../../../../test/helpers/tmp";
import type { ConfirmHost } from "../../../core/applyEdit";
import { OrbitStore } from "../../../core/orbitStore";
import { SafeWriter } from "../../../core/safeWriter";
import { QuotaInstaller, restoreOnUninstall, tapCommand } from "../quotaInstall";

const tmp = useTmpDir();

function autoHost(answer: "apply" | "cancel" = "apply") {
  const log: string[] = [];
  const host: ConfirmHost = {
    confirm: async (s) => {
      log.push(`confirm ${s}`);
      return answer;
    },
    showDiff: async () => {},
    done: async (l) => {
      log.push(`done ${l}`);
    },
    warn: (m) => {
      log.push(`warn ${m}`);
    },
  };
  return { host, log };
}

function setup(
  opts: {
    node?: string | null;
    settings?: unknown;
    platform?: NodeJS.Platform;
    answer?: "apply" | "cancel";
    storageName?: string;
  } = {},
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
  const storage = join(root, opts.storageName ?? "omsharma.orbit");
  const tapSource = join(root, "dist-tap.js");
  writeFileSync(tapSource, "// tap");
  const { host, log } = autoHost(opts.answer);
  const q = new QuotaInstaller({
    settingsPath: settings,
    tapDir: join(storage, "statusline"),
    tapSource,
    store: new OrbitStore(storage),
    writer: new SafeWriter(join(storage, "backups")),
    findNode: async () => (opts.node === undefined ? "/usr/bin/node" : opts.node),
    platform: opts.platform ?? "linux",
    confirm: host,
    workspace: () => null,
  });
  const read = () => JSON.parse(readFileSync(settings, "utf8"));
  return { q, root, settings, storage, read, log };
}

describe("tapCommand", () => {
  it("runs node from PATH each time, so a Node upgrade or nvm switch can't break it", () => {
    expect(tapCommand("/home/a/it's/tap.js", "linux")).toBe(`node '/home/a/it'\\''s/tap.js'`);
  });

  it("works in both Git Bash and PowerShell on Windows", () => {
    expect(tapCommand("C:\\Users\\A B\\tap.js", "win32")).toBe(`node "C:/Users/A B/tap.js"`);
  });
});

describe("QuotaInstaller.enable", () => {
  it("asks first, then sets Orbit's statusline, keeping other settings and formatting", async () => {
    const { q, settings, storage, read, log } = setup({
      settings: { model: "opus", theme: "dark" },
    });
    expect(await q.enable()).toEqual({ ok: true });
    expect(log[0]).toMatch(/^confirm .*statusline/i);
    const s = read();
    expect(s.model).toBe("opus");
    expect(s.statusLine).toMatchObject({ type: "command" });
    expect(s.statusLine.command).toContain(
      join(storage, "statusline").replace(/\\/g, "/").split("/").pop(),
    );
    expect(readFileSync(settings, "utf8")).toMatch(/^\{\n {4}"/);
    expect(existsSync(join(storage, "statusline", "statusline-tap.js"))).toBe(true);
    expect((await q.status()).enabled).toBe(true);
  });

  it("changes nothing when the person cancels", async () => {
    const { q, settings } = setup({ settings: { a: 1 }, answer: "cancel" });
    expect(await q.enable()).toEqual({ ok: false, reason: "not-applied" });
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({ a: 1 });
    expect((await q.status()).enabled).toBe(false);
  });

  it("keeps the person's own statusline running through the tap, and puts it back on turn-off", async () => {
    const mine = { type: "command", command: "~/bin/my-status.sh", padding: 2 };
    const { q, storage, read } = setup({ settings: { statusLine: mine } });
    await q.enable();
    const tapDir = join(storage, "statusline");
    expect(JSON.parse(readFileSync(join(tapDir, "statusline-inner.json"), "utf8")).command).toBe(
      "~/bin/my-status.sh",
    );
    expect(JSON.parse(readFileSync(join(tapDir, "previous.json"), "utf8")).statusLine).toEqual(
      mine,
    );
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

  it("is idempotent: turning on twice does not chain Orbit to itself", async () => {
    const mine = { type: "command", command: "echo mine" };
    const { q, storage } = setup({ settings: { statusLine: mine } });
    await q.enable();
    await q.enable();
    const inner = JSON.parse(
      readFileSync(join(storage, "statusline", "statusline-inner.json"), "utf8"),
    );
    expect(inner.command).toBe("echo mine");
  });

  it("takes over another editor's Orbit tap without losing the person's statusline", async () => {
    const mine = { type: "command", command: "echo mine" };
    const a = setup({ settings: { statusLine: mine }, storageName: "omsharma.orbit" });
    await a.q.enable();
    // A second editor (e.g. Cursor) has its own storage folder but shares ~/.claude.
    const b = new QuotaInstaller({
      settingsPath: a.settings,
      tapDir: join(a.root, "cursor", "omsharma.orbit", "statusline"),
      tapSource: join(a.root, "dist-tap.js"),
      store: new OrbitStore(join(a.root, "cursor", "omsharma.orbit")),
      writer: new SafeWriter(join(a.root, "cursor", "backups")),
      findNode: async () => "/usr/bin/node",
      platform: "linux",
      confirm: autoHost().host,
      workspace: () => null,
    });
    await b.enable();
    const inner = JSON.parse(
      readFileSync(
        join(a.root, "cursor", "omsharma.orbit", "statusline", "statusline-inner.json"),
        "utf8",
      ),
    );
    expect(inner.command).toBe("echo mine");
    await b.disable();
    expect(a.read().statusLine).toEqual(mine);
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

  it("explains instead of writing when Node.js is missing", async () => {
    const { q, settings } = setup({ node: null, settings: { a: 1 } });
    expect(await q.enable()).toEqual({ ok: false, reason: "no-node" });
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({ a: 1 });
  });

  it("refuses to edit a settings file that isn't plain JSON, and says why", async () => {
    const { q, settings, log } = setup({ settings: '{ "a": 1, // comment\n}' });
    expect(await q.enable()).toEqual({ ok: false, reason: "not-applied" });
    expect(log.some((l) => /^warn .*not a plain JSON object/.test(l))).toBe(true);
    expect(readFileSync(settings, "utf8")).toBe('{ "a": 1, // comment\n}');
  });
});

describe("QuotaInstaller maintenance", () => {
  it("refreshes the installed tap after an Orbit update, only while turned on", async () => {
    const { q, root, storage } = setup({ settings: {} });
    const tapFile = join(storage, "statusline", "statusline-tap.js");
    await q.syncTap();
    expect(existsSync(tapFile)).toBe(false);
    await q.enable();
    writeFileSync(join(root, "dist-tap.js"), "// tap v2");
    await q.syncTap();
    expect(readFileSync(tapFile, "utf8")).toBe("// tap v2");
  });

  it("reports when a project's own statusline hides Orbit's there", async () => {
    const { q, root } = setup({ settings: {} });
    await q.enable();
    const ws = join(root, "ws");
    mkdirSync(join(ws, ".claude"), { recursive: true });
    writeFileSync(
      join(ws, ".claude", "settings.json"),
      JSON.stringify({ statusLine: { type: "command", command: "x" } }),
    );
    (q as unknown as { d: { workspace: () => string } }).d.workspace = () => ws;
    expect((await q.status()).shadowed).toBe(true);
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

describe("restoreOnUninstall", () => {
  it("puts the person's statusline back when Orbit is uninstalled", async () => {
    const mine = { type: "command", command: "echo mine" };
    const { q, settings, read } = setup({ settings: { statusLine: mine, model: "opus" } });
    await q.enable();
    await restoreOnUninstall(settings, join(tmp(), "bk"));
    expect(read()).toEqual({ statusLine: mine, model: "opus" });
  });

  it("removes Orbit's statusline when there was none before, and ignores others", async () => {
    const { q, settings, read } = setup({ settings: { model: "opus" } });
    await q.enable();
    await restoreOnUninstall(settings, join(tmp(), "bk"));
    expect(read()).toEqual({ model: "opus" });
    writeFileSync(
      settings,
      JSON.stringify({ statusLine: { type: "command", command: "echo mine" } }),
    );
    await restoreOnUninstall(settings, join(tmp(), "bk"));
    expect(read().statusLine.command).toBe("echo mine");
  });
});
