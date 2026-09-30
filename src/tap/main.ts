// Entry point bundled to dist/statusline-tap.js. Reads stdin, prints the statusline.
import { dirname } from "node:path";
import { runInnerCommand, runTap } from "./statusline";

const chunks: Buffer[] = [];
process.stdin.on("data", (c: Buffer) => chunks.push(c));
process.stdin.on("end", () => {
  const out = runTap(Buffer.concat(chunks).toString("utf8"), dirname(__filename), {
    now: Date.now,
    runInner: runInnerCommand,
  });
  process.stdout.write(out);
});
process.stdin.on("error", () => process.exit(0));
