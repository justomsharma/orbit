import { copyFileSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const prod = !watch;

const extension = {
  entryPoints: ["src/extension/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: !prod,
  minify: prod,
  logLevel: "info",
};

const webview = {
  entryPoints: ["src/webview/main.tsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  outfile: "dist/webview/main.js",
  jsx: "automatic",
  jsxImportSource: "preact",
  sourcemap: !prod,
  minify: prod,
  logLevel: "info",
};

// Standalone statusline tap, run by Claude Code with the person's own Node.
const tap = {
  entryPoints: ["src/tap/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: "dist/statusline-tap.js",
  minify: prod,
  logLevel: "info",
};

function copyCss() {
  mkdirSync("dist/webview", { recursive: true });
  copyFileSync("src/webview/styles.css", "dist/webview/main.css");
  // VS Code's own icon font, so Orbit looks native in every theme.
  for (const f of ["codicon.css", "codicon.ttf"]) {
    copyFileSync(`node_modules/@vscode/codicons/dist/${f}`, `dist/webview/${f}`);
  }
}

if (watch) {
  const a = await esbuild.context(extension);
  const b = await esbuild.context(webview);
  const c = await esbuild.context(tap);
  await Promise.all([a.watch(), b.watch(), c.watch()]);
  copyCss();
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview), esbuild.build(tap)]);
  copyCss();
}
