# Stage 1 — Foundation + Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native). A fresh reviewer checks each stage before the next starts. Steps use `- [ ]`.

**Goal:** An installable extension whose sidebar lists every Claude Code chat and opens any of them in Claude's chat or a terminal — safely.

**Architecture:** Pure readers in `src/core` + `src/features/*/reader.ts` (no `vscode` import, unit-tested against fake `~/.claude` trees). The extension host (`src/extension`) owns VS Code APIs and sends schema-checked messages to one Preact webview (`src/webview`).

**Tech Stack:** TypeScript 5 strict · esbuild · Preact 10 + @preact/signals · valibot · vitest + happy-dom · biome · @vscode/test-electron · @vscode/vsce.

**Spec:** `docs/specs/2026-09-30-orbit-design.md`

## Global Constraints
- VS Code engine `^1.94.0`; Node ≥ 20. Extension id `orbit`, display name `Orbit`.
- No network APIs anywhere in `src/` (enforced by a test that greps the bundle).
- Only `src/core/safeWriter.ts` may write outside Orbit's storage (enforced by a test that greps for `writeFile`/`rename`/`rm`/`unlink`).
- Never write `history.jsonl`, transcripts, credentials. Never `sendText` to a terminal.
- Session ids must match UUID v4-ish regex before use in any link/argument.
- All paths via `node:path`; tests assert behaviour with Windows-style (`C:\…`) and POSIX paths.
- Webview CSP: `default-src 'none'`, scripts by crypto nonce, `img-src ${cspSource} data:`, `connect-src 'none'`.

## Review Focus
1. **Huge histories** (thousands of chats, 100 MB transcripts) → list appears < 1 s, editor never freezes: head/tail bounded reads, mtime cache, async I/O. Test: 2 000 fixture sessions parse < 1 s.
2. **Corrupt / partial lines** (Claude mid-write) → line skipped, never crash. Test in `jsonl.test.ts`.
3. **Windows paths & drive-letter case** (`c:\` vs `C:\`) → project grouping and "this workspace" match. Test in `paths.test.ts`.
4. **Official extension not installed / `claude` not on PATH** → buttons degrade with a clear message, no silent failure. Test in `handoff.test.ts`.
5. **Hostile values in data** (session id `x; rm -rf /`, cwd with quotes) → rejected / passed only as argv. Test in `handoff.test.ts`.

---

## File structure
```
src/core/paths.ts        claudeHome(), projectsDir(), sessionsDir(), historyFile(), normPath()
src/core/fsSafe.ts       readTextSafe(), readHeadTail(), statSafe(), listDirSafe() — no symlinks, size caps
src/core/jsonl.ts        forEachJsonLine(text, fn), parseJsonLines()
src/core/cache.ts        MtimeCache<T>
src/core/uuid.ts         isSessionId()
src/features/chats/types.ts   Session, LiveStatus
src/features/chats/reader.ts  listSessions(opts) → Session[]
src/features/chats/live.ts    readLiveSessions() → Map<id, LiveStatus>
src/shared/protocol.ts   valibot schemas: HostMsg, ViewMsg
src/extension/extension.ts   activate/deactivate
src/extension/view.ts        OrbitViewProvider (webview view)
src/extension/html.ts        page html + CSP
src/extension/handoff.ts     openInChat(), openInTerminal(), resumeCommand()
src/extension/state.ts       OrbitState (pins, renames) in globalState
src/extension/watch.ts       debounced watchers → refresh
src/webview/main.tsx, app.tsx, bus.ts, ui/*.tsx, tabs/Chats.tsx, styles.css
test/fixtures/*               fake ~/.claude builders (test/helpers/fakeHome.ts)
```

## Tasks

### Task 1: Scaffold
Files: package.json, tsconfig.json, biome.json, vitest.config.ts, scripts/build.mjs, .vscodeignore, .gitignore, media/icon.svg.
- [ ] `npm run build` produces `dist/extension.js` + `dist/webview/main.js` + `main.css`; `npm test`, `npm run typecheck`, `npm run check` all pass on an empty test.
- [ ] Commit.

### Task 2: core — paths, fsSafe, jsonl, cache, uuid
Interfaces (produced):
```ts
claudeHome(env = process.env, home = os.homedir()): string   // CLAUDE_CONFIG_DIR ?? ~/.claude
normPath(p: string): string          // resolve + lower-case drive letter on win32, strip trailing sep
projectName(cwd: string): string     // last path segment
readTextSafe(p, maxBytes = 8 MiB): Promise<string | null>   // null if missing/symlink/too big
readHeadTail(p, head = 256 KiB, tail = 128 KiB): Promise<{ head: string; tail: string; size: number; mtimeMs: number } | null>
forEachJsonLine(text: string, fn: (obj: Record<string, unknown>) => void): void  // skips bad/partial lines
isSessionId(s: unknown): s is string // /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
class MtimeCache<T> { get(p, mtimeMs, size): T | undefined; set(p, mtimeMs, size, v: T): void; }  // LRU 5 000
```
Tests: CLAUDE_CONFIG_DIR override; `c:\A\` vs `C:\A` equal on win32 semantics; symlink refused (skip on Windows without privilege — use `it.skipIf`); partial last line skipped; head/tail on file smaller than head.

### Task 3: chats reader
```ts
interface Session {
  id: string; file: string; cwd: string; project: string; title: string; firstPrompt: string;
  branch: string | null; startedAt: number; lastActiveAt: number; messages: number;
  entrypoint: string | null; model: string | null; prLinks: string[]; sizeBytes: number;
  continuedIn: string | null;
}
listSessions(home: string, cache?: MtimeCache<Session>): Promise<Session[]>  // newest first
```
Source of truth = `projects/<slug>/<uuid>.jsonl` (top level only; `subagents/` ignored here).
Title priority: `agent-name.agentName` → last `ai-title.aiTitle` → first real user text (string content or first `text` block, not `isMeta`, not starting with `<`) → "Untitled chat". `cwd`/`gitBranch`/`timestamp` from first line that has them; `lastActiveAt` = last timestamp in tail, else mtime. Messages = user(non-meta, non-tool_result)+assistant lines in head+tail (estimate flagged when file > head+tail).
Tests: fixture builder writes realistic lines (copied shapes from real data: `ai-title`, `agent-name`, `pr-link`, `continued-in`, tool_result user lines, image blocks); title priority; bad lines; 2 000 sessions < 1 s; empty dir; missing projects dir.

### Task 4: live status
```ts
interface LiveStatus { sessionId: string; pid: number; status: 'busy' | 'idle' | 'unknown'; name: string | null; updatedAt: number }
readLiveSessions(home: string, isAlive = pidAlive): Promise<Map<string, LiveStatus>>
```
Reads `sessions/*.json`; keeps only entries whose pid is alive (`process.kill(pid, 0)`, EPERM = alive).
Tests: dead pid dropped, bad JSON ignored, non-UUID sessionId ignored.

### Task 5: protocol + state
valibot schemas. View→Host: `ready`, `refresh`, `openChat{id}`, `openTerminal{id}`, `copyResume{id}`, `pin{id,on}`, `rename{id,title}`. Host→View: `sessions{items, live, pins, renames, workspace}`, `toast{kind,text}`. Unknown messages dropped + logged.
`OrbitState` wraps `Memento`: pins `Set<string>`, renames `Record<string,string>` (max 200 chars).
Tests: schema rejects non-UUID ids and oversized strings; state round-trip with fake Memento.

### Task 6: handoff
```ts
chatUri(scheme: string, id: string): string   // `${scheme}://anthropic.claude-code/open?session=${id}`
resumeCommand(id: string, cwd: string, platform = process.platform): string  // for clipboard only, quoted per platform
terminalOptions(id, cwd, claudePath): { name; shellPath: claudePath; shellArgs: ['--resume', id]; cwd }
findClaude(): Promise<string | null>   // execFile('where'|'which', ['claude']) + common install dirs
```
openInChat: if `anthropic.claude-code` missing → toast with "Install" action; if session cwd ≠ workspace folder → offer "Open folder & continue" (vscode.openFolder then URI) or terminal.
Tests: hostile id throws; cwd with `"` and spaces stays one argv element; PowerShell/cmd/posix clipboard quoting.

### Task 7: webview shell + Chats tab
Tabs bar (Home · Chats · Usage · Setup; only Chats enabled in stage 1). Chats: search box (title, first prompt, project, branch), filter chips (This workspace · All · Pinned · Live), grouped by Today / Yesterday / This week / Older, virtualized list, row = title + project · branch · time ago + live dot; row actions: Continue (primary), Terminal, Copy command, Pin, Rename. Keyboard: ↑↓ Enter. Empty + error states.
Tests (happy-dom): renders 5 000 rows with < 60 DOM rows; search filters; Enter posts `openChat`.

### Task 8: extension wiring + watcher + integration smoke test
activate registers view, commands `orbit.open`, `orbit.refresh`, status bar item; watches `projects/**/*.jsonl` + `sessions/*.json` (debounced 500 ms, max once / 2 s while busy).
Integration test (@vscode/test-electron) with `CLAUDE_CONFIG_DIR` pointing at a fixture: extension activates, command runs, view resolves.
- [ ] Full test suite, typecheck, lint, build, `vsce package` succeed. Reviewer pass. Commit.

## Later stages (expanded when reached)
2. Usage (`features/usage`: per-message usage from transcripts + subagents, pricing table, day buckets, heatmap, quota via opt-in statusline tap that chains the user's command) + Home + Weekly recap.
3. Setup (`features/setup`: readers for MCP/skills/commands/agents/hooks/plugins/memory/permissions/settings, health checks, `core/safeWriter.ts` with preview/backup/undo, "Fix with Claude").
4. Prompts (history.jsonl search) + Timeline (file-history diff/restore through SafeWriter) + transcript viewer + Markdown export.
5. Polish, perf, accessibility, README/marketplace assets, CI matrix, release candidate.
