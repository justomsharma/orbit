// Runs inside a real VS Code extension host.
const assert = require("node:assert/strict");
const vscode = require("vscode");

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

exports.run = async () => {
  const ext = vscode.extensions.getExtension("orbit-dev.orbit");
  let api;

  await check("extension is present and activates", async () => {
    assert.ok(ext, "orbit-dev.orbit not found");
    api = await ext.activate();
    assert.equal(typeof api.refresh, "function");
  });

  await check("commands are registered", async () => {
    const cmds = await vscode.commands.getCommands(true);
    for (const c of ["orbit.open", "orbit.refresh"]) assert.ok(cmds.includes(c), `${c} missing`);
  });

  await check("Orbit opens its sidebar", async () => {
    await vscode.commands.executeCommand("orbit.open");
  });

  await check(
    "reads chats from CLAUDE_CONFIG_DIR and knows which belong to this folder",
    async () => {
      await api.refresh();
      const snap = api.lastSnapshot();
      assert.ok(snap, "no snapshot");
      const ids = snap.items.map((s) => s.id).sort();
      assert.deepEqual(ids, [process.env.ORBIT_IT_HERE, process.env.ORBIT_IT_AWAY].sort());
      assert.deepEqual(snap.here, [process.env.ORBIT_IT_HERE]);
      const here = snap.items.find((s) => s.id === process.env.ORBIT_IT_HERE);
      assert.equal(here.title, "Fix checkout (title)");
      assert.equal(here.model, "claude-opus-5-5");
    },
  );

  await check("reads token usage and prices it", async () => {
    await api.refresh();
    const u = api.lastUsage();
    assert.ok(u, "no usage snapshot");
    assert.equal(u.all.messages, 2);
    assert.ok(u.all.cost > 0, "expected a priced cost");
    assert.equal(u.quota.enabled, false);
  });

  await check("refresh command runs without error", async () => {
    await vscode.commands.executeCommand("orbit.refresh");
  });
};
