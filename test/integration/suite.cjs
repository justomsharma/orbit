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
  const ext = vscode.extensions.getExtension("OmSharma.orbit-hq");
  let api;

  await check("extension is present and activates", async () => {
    assert.ok(ext, "OmSharma.orbit-hq not found");
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

  const until = async (what, fn) => {
    for (let i = 0; i < 50; i++) {
      const v = fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`timed out waiting for ${what}`);
  };

  await check("opens a chat's transcript as a read-only Markdown preview", async () => {
    await api.dispatch({ type: "chat:transcript", id: process.env.ORBIT_IT_HERE });
    const doc = await until("the transcript document", () =>
      vscode.workspace.textDocuments.find((d) => d.uri.scheme === "orbit-view"),
    );
    // Chat text is escaped so the preview shows it exactly: "(title)" is written "\(title\)".
    assert.ok(doc.getText().startsWith("# Fix checkout \\(title\\)"), doc.getText().slice(0, 80));
    assert.match(doc.getText(), /## You[\s\S]*Fix checkout/);
  });

  await check("compares a checkpoint with the file as it is now", async () => {
    await api.dispatch({
      type: "chat:diff",
      id: process.env.ORBIT_IT_HERE,
      path: process.env.ORBIT_IT_APP,
      version: 1,
    });
    const tab = await until("the diff editor", () =>
      vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .find((t) => t.input instanceof vscode.TabInputTextDiff),
    );
    assert.equal(tab.input.original.scheme, "orbit-view");
    assert.equal(tab.input.modified.fsPath.toLowerCase(), process.env.ORBIT_IT_APP.toLowerCase());
    const before = await vscode.workspace.openTextDocument(tab.input.original);
    assert.equal(before.getText(), "const total = 1;\n");
  });

  await check("refresh command runs without error", async () => {
    await vscode.commands.executeCommand("orbit.refresh");
  });
};
