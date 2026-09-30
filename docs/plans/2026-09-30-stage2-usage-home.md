# Stage 2 — Usage, Quota, Recap, Home

> Executor: superpowers:subagent-driven-development for Tasks 1–2 (independent, parallel worktrees), native for 3–6. Stage reviewer at the end.

**Goal:** Usage tab (cost/tokens/trends/heatmap), opt-in 5h/7-day quota, weekly recap, Home tab.
**Spec:** `docs/specs/2026-09-30-orbit-design.md`

## Global Constraints (in addition to stage 1)
- Only files in `test/guards.test.ts` WRITERS may write. New writers this stage: `src/core/safeWriter.ts`, `src/core/orbitStore.ts`, `src/tap/statusline.ts` (writes only its own cache in its own folder).
- Dedupe usage by `message.id` globally (real data: 27 830 lines → 13 281 messages). Skip model `<synthetic>`.
- Include subagent transcripts `projects/<slug>/<session>/subagents/*.jsonl`.
- Pricing from https://platform.claude.com/docs/en/about-claude/pricing (fetched 2026-09-30). Unknown model → tokens counted, cost `null` (shown as "—", never guessed).
- Index must be incremental (read only appended bytes) and persisted in Orbit storage — real data is 307 MB.

## Review Focus
1. Transcript appended while indexing / half-written last line → no double count, no lost record.
2. File truncated or replaced (size shrinks) → reindex that file, no stale records.
3. Same message id in several files (resume/fork copies history) → counted once.
4. Timezones/DST → "today" and day buckets use local time.
5. settings.json edited by the person (or Claude) between preview and apply → SafeWriter refuses; undo after a later edit → refuses.

---

### Task 1 (subagent A): SafeWriter + OrbitStore
Files: `src/core/safeWriter.ts`, `src/core/orbitStore.ts`, `src/core/json.ts`, tests in `src/core/__tests__/`.
```ts
// json.ts
detectIndent(text: string): string | number          // "\t" | 2 | 4 … default 2
stringifyLike(value: unknown, original: string | null): string  // same indent + trailing newline as original
parseJsonObject(text: string): Record<string, unknown> | null   // null if not a JSON object (comments → null)

// safeWriter.ts
export class ConflictError extends Error {}
export class UnparseableError extends Error {}
export interface EditPlan { file: string; before: string | null; after: string; beforeHash: string | null }
export interface UndoEntry { id: string; file: string; backup: string | null; afterHash: string; at: number; label: string }
export class SafeWriter {
  constructor(backupDir: string, opts?: { now?: () => number; maxEntries?: number /*100*/ })
  plan(file: string, transform: (before: string | null) => string): Promise<EditPlan>
  planJson(file: string, mutate: (obj: Record<string, unknown>) => void): Promise<EditPlan> // UnparseableError if existing text isn't a JSON object; missing/empty file = {}
  apply(plan: EditPlan, label: string): Promise<UndoEntry>   // ConflictError if file changed since plan; backup → atomic write (unique tmp in same dir + rename, Windows EPERM/EBUSY retry ×5, keep file mode)
  undo(id: string): Promise<void>                             // ConflictError if file changed since apply; restores bytes, or deletes the file if it did not exist before
  history(): Promise<UndoEntry[]>                            // newest first, persisted in backupDir/undo.json
}
// orbitStore.ts — Orbit's own JSON files under its storage dir only
export class OrbitStore { constructor(dir: string); read<T>(name: string, fallback: T): Promise<T>; write(name: string, value: unknown): Promise<void> } // name must match /^[a-z0-9-]+\.json$/
```
Tests: conflict on concurrent edit; undo restores exact bytes (CRLF, BOM, trailing spaces); undo of a created file deletes it; undo after later edit refuses; unparseable JSON refused; indent/newline preserved; history capped and persisted; backup files exist and contain original bytes; name validation in OrbitStore; parallel `apply` on two files OK.

### Task 2 (subagent B): pricing + usage index + aggregate + recap
Files: `src/core/pricing.ts`, `src/features/usage/{types,index,aggregate,recap}.ts`, tests.
```ts
// pricing.ts
export const PRICING_AS_OF = "2026-09-30";
export interface Price { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number } // $ per MTok
export function priceFor(model: string): Price | null     // by id prefix/regex, e.g. claude-opus-5-5, claude-opus-5-5-20260401, us.anthropic.claude-opus-5-5, claude-3-5-haiku-*
export function costOf(u: UsageRecord): number | null    // + fast mode ($8/$40 Opus 5.5; $10/$50 Opus 5/4.8), ×1.1 when geo "us" on 4.6+, web search $10/1000
// types.ts
export interface UsageRecord { id: string; t: number; model: string; session: string; cwd: string; input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number; webSearches: number; fast: boolean; usGeo: boolean }
// index.ts — incremental, persisted
export interface IndexState { v: 1; files: Record<string, { size: number; mtimeMs: number; offset: number; records: UsageRecord[] }> }
export class UsageIndex {
  constructor(home: string, state?: IndexState)
  update(): Promise<{ changed: boolean }>   // reads only appended complete lines; resets a file whose size shrank; drops files that disappeared
  records(): UsageRecord[]                  // globally deduped by id, sorted by t
  state(): IndexState
}
// aggregate.ts (pure)
export interface UsageSummary { range: {from:number;to:number}; cost: number|null; unpricedModels: string[]; tokens: {input;output;cacheRead;cacheWrite}; cacheHitRate: number; messages: number; sessions: number;
  daily: {day: string; cost: number; tokens: number}[]; byModel: {model; cost; tokens}[]; byProject: {cwd; cost; tokens}[]; topSessions: {session; cwd; cost; tokens}[] }
export function summarize(records: UsageRecord[], from: number, to: number): UsageSummary
export function heatmap(records: UsageRecord[], now: number, weeks = 26): { day: string; tokens: number }[]
export function dayKey(t: number): string                 // local YYYY-MM-DD
// recap.ts (pure)
export interface Recap { from: number; to: number; chats: number; prompts: number; cost: number|null; tokens: number; activeDays: number; busiestDay: string|null; topProjects: {name; chats}[]; prs: string[]; models: string[] }
export function weeklyRecap(records: UsageRecord[], sessions: Session[], now: number): Recap   // last 7 local days incl. today
export function recapMarkdown(r: Recap): string
```
Tests: dedupe across lines and files; `<synthetic>` skipped; partial last line then completed; truncation reindex; subagent files included; price table spot checks incl. fast/geo/web search and unknown model → null; local-day buckets; cache hit rate; recap numbers.

### Task 3: statusline tap + quota installer (native)
`src/tap/statusline.ts` → `dist/statusline-tap.js` (own esbuild entry). Copied into Orbit storage on enable/activation. Command: POSIX `"<abs node>" "<tap>"`; Windows `node "<tap with / separators>"` (works in Git Bash and PowerShell). Tap: read stdin, write `quota.json` (rate_limits, model, context %, cost, session_id, ts) atomically, then run the previous command (from `statusline-inner.json`) with the same stdin via the shell (exactly as Claude would) and print its output; no previous command → print `model · N% context`. Never throws. Installer (`features/usage/quotaInstall.ts`): enable = SafeWriter.planJson on `~/.claude/settings.json` setting `statusLine`, saving the previous value; disable = restore previous only if the current one is still ours. Node missing → clear message.

### Task 4: host services + protocol
`UsageService` (index persisted via OrbitStore, debounced), messages `usage` (summaries for today/7d/30d/all + heatmap + quota + recap), view→host `quota`{on}, `copyRecap`, `saveRecapImage`{dataUrl ≤ 5 MB png}, `newChat`.

### Task 5: Usage tab + Home tab UI
SVG bar chart, heatmap, model/project lists, quota bars, recap card (copy Markdown / save image). Home: continue last chat, running chats, today vs yesterday, quota, recap teaser. Preview screenshots light + dark.

### Task 6: stage review + fixes.
