import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/** One check of Orbit's and Claude Code's health, in plain words. */
export interface Check {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  /** What to do when it isn't ok. */
  fix?: string;
}

export interface DiagnoseInput {
  home: string;
  claudeJson: string;
  userHome: string;
  workspace: string | null;
  platform: NodeJS.Platform;
  vscodeVersion: string;
  orbitVersion: string;
  claudeOnPath(): Promise<boolean>;
  /** Setup problems the health check already found (titles only). */
  problems: string[];
}

const exists = async (p: string) => (await stat(p).catch(() => null)) !== null;

/**
 * Checks what Orbit needs: Claude Code installed, its folder and config readable,
 * signed in, a folder open. Reads no tokens and no chats.
 */
export async function diagnose(i: DiagnoseInput): Promise<Check[]> {
  const out: Check[] = [];
  const onPath = await i.claudeOnPath().catch(() => false);
  out.push({
    id: "cli",
    title: "Claude Code is installed",
    ok: onPath,
    detail: onPath ? "The claude command is on your PATH." : "The claude command wasn't found.",
    fix: "Install Claude Code (npm install -g @anthropic-ai/claude-code), then restart VS Code.",
  });
  const home = await exists(i.home);
  out.push({
    id: "home",
    title: "Claude's folder (~/.claude) is there",
    ok: home,
    detail: home ? "Orbit can read it." : "It doesn't exist yet.",
    fix: "Run claude once in a terminal; it creates the folder.",
  });
  let config: Record<string, unknown> | null = null;
  let configError: string | null = null;
  try {
    const v: unknown = JSON.parse(await readFile(i.claudeJson, "utf8"));
    config = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch (e) {
    configError = (e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "broken";
  }
  out.push({
    id: "claudeJson",
    title: "Claude's config (~/.claude.json) reads",
    ok: config !== null,
    detail:
      config !== null
        ? "It's valid JSON."
        : configError === "missing"
          ? "It doesn't exist yet."
          : "It isn't valid JSON, so Claude may have lost your settings.",
    fix:
      configError === "missing"
        ? "Run claude once and sign in."
        : "Open Orbit's Account tab and use Restore from backup.",
  });
  const signedIn =
    !!config && typeof config.oauthAccount === "object" && config.oauthAccount !== null;
  out.push({
    id: "account",
    title: "Signed in",
    ok: signedIn,
    detail: signedIn ? "Claude Code has an account." : "No account found (an API key may be used).",
    fix: "Run claude and use /login, or Log in on Orbit's Account tab.",
  });
  const keyFile = join(i.home, ".credentials.json");
  const keys = i.platform === "darwin" || (await exists(keyFile));
  out.push({
    id: "credentials",
    title: "Sign-in saved",
    ok: keys || !signedIn,
    detail:
      i.platform === "darwin"
        ? "Kept in your macOS keychain."
        : keys
          ? "Claude's sign-in file is there (Orbit doesn't read it)."
          : "Claude's sign-in file is missing.",
    fix: "Run claude and use /login again.",
  });
  out.push({
    id: "setup",
    title: "Your setup has no problems",
    ok: i.problems.length === 0,
    detail: i.problems.length
      ? `${i.problems.length} to look at: ${i.problems.slice(0, 3).join("; ")}${i.problems.length > 3 ? "…" : ""}`
      : "Settings, hooks and MCP servers look fine.",
    fix: "Open Config: each problem there has its own fix.",
  });
  out.push({
    id: "workspace",
    title: "A folder is open",
    ok: !!i.workspace,
    detail: i.workspace
      ? "Project settings, memory and chats for it show up."
      : "No folder is open.",
    fix: "Open a folder to see its project settings and chats.",
  });
  return out;
}

/** The checks as Markdown for a report: no email, no folder names, no paths. */
export function reportMarkdown(
  checks: Check[],
  i: Pick<DiagnoseInput, "platform" | "vscodeVersion" | "orbitVersion" | "userHome">,
): string {
  const scrub = (s: string) => s.split(i.userHome).join("~");
  const lines = [
    "# Orbit diagnostics",
    "",
    `Orbit ${i.orbitVersion} · VS Code ${i.vscodeVersion} · ${i.platform} · ${new Date().toISOString().slice(0, 10)}`,
    "",
    ...checks.map(
      (c) =>
        `- ${c.ok ? "✅" : "⚠️"} **${c.title}**: ${scrub(c.detail)}${c.ok || !c.fix ? "" : `\n  - Fix: ${scrub(c.fix)}`}`,
    ),
    "",
    `${checks.filter((c) => !c.ok).length} of ${checks.length} need a look.`,
  ];
  return `${lines.join("\n")}\n`;
}
