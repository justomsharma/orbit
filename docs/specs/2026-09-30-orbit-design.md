# Orbit — design (v1)

*Working name. One page on purpose.*

## What it is
A VS Code extension (Marketplace + Open VSX) that is the **home screen for Claude Code**.
It shows everything around your Claude work — chats, usage, setup — and hands off to
Claude's own chat to actually talk to Claude. One sidebar, four tabs, zero risk.

**For:** people who use Claude Code a lot, in VS Code / Cursor / Windsurf.

## Rules we never break
1. **Claude keeps working exactly as before.** We never delete chats, never rewrite
   Claude's own files (`history.jsonl`, transcripts), never copy login tokens.
2. **Every change is safe:** preview → backup → write → one-click undo. We refuse to write
   a file we can't parse, or one that changed since we read it.
3. **Only official Claude settings keys.** No invented keys.
4. **Nothing is typed into a shell.** Chats open via Anthropic's documented link
   (`vscode://anthropic.claude-code/open?session=`) or by launching `claude` directly as the
   terminal program with arguments. Session IDs must be valid UUIDs.
5. **100% local.** No network calls. No telemetry.
6. **Windows, Mac, Linux are equal.** Tests run on all three.

## The four tabs
| Tab | What you get |
|---|---|
| **Home** | Today at a glance: continue last chat, live chats, today's cost, quota bars, setup warnings. |
| **Chats** | Every chat (CLI + extension) · search titles and full text · filter by project/branch/date · pin, rename, tag (stored in Orbit only) · continue in chat or terminal · fork · readable transcript view · export to Markdown · **Prompts**: search every prompt you ever typed, reuse it · **Timeline**: files Claude changed per chat, diff and safe restore. |
| **Usage** | Tokens + cost by day/week/month, by model and project · activity heatmap · 5h / 7-day quota (opt-in, reads Claude's official statusline data; your own statusline keeps working) · **Weekly recap** card to share (image or Markdown). |
| **Setup** | MCP servers (all scopes), skills, commands, agents, hooks, plugins, memory, CLAUDE.md, permissions, main settings — view **and edit** safely · **Health check** (broken JSON, missing commands, MCP needing login, broken memory links) · **Fix with Claude** button that opens Claude's chat with the fix pre-typed. |

## Look and feel
Uses VS Code's own theme colors (light/dark just work) · big, calm cards · one main action
per row · empty states that teach · keyboard first (`Ctrl+Alt+O` to open) · fast on huge
histories (lists virtualized, reads streamed, nothing blocks the editor).

## How it is built
- **TypeScript**, bundled with esbuild. **Preact + signals** for the webviews. Hand-made SVG charts.
- `core/` — paths (respects `CLAUDE_CONFIG_DIR`), streamed JSONL reader, safe file reads
  (size caps, no symlinks), **SafeWriter** (the only code allowed to write), file watcher.
- `features/<tab>/` — a pure **reader** (no VS Code imports, unit-tested on fixture data),
  **actions**, and a **view**. Messages between editor and UI are schema-checked (valibot).
- Orbit's own data (pins, tags, backups, undo) lives in VS Code's extension storage, never in `~/.claude`.
- Tests: vitest unit tests with fake `~/.claude` folders, VS Code integration test, CI on
  Windows + Mac + Linux.

## Not in v1 (and why)
- **Our own chat** — Anthropic's official chat does it best, and third-party apps may not use Claude subscription logins.
- **Account switching** — the old tool did this by copying login tokens. Revisit later with separate config folders (`CLAUDE_CONFIG_DIR`), no token copying.
- **"Temp" chats that auto-delete** — this is where the old tool deleted real chats.

## Build order
1. Foundation + **Chats** → test
2. **Usage** + quota + recap + **Home** → test
3. **Setup** (read, health, safe edit) → test
4. **Prompts** + **Timeline** + transcript view → test
5. Polish, performance on big data, packaging, full product test → release candidate
