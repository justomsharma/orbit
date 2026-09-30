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

function copyCss() {
  mkdirSync("dist/webview", { recursive: true });
  copyFileSync("src/webview/styles.css", "dist/webview/main.css");
}

if (watch) {
  const a = await esbuild.context(extension);
  const b = await esbuild.context(webview);
  await Promise.all([a.watch(), b.watch()]);
  copyCss();
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
  copyCss();
}
