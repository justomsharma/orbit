import { useState } from "preact/hooks";
import { post } from "../bus";
import * as store from "../store";
import { IconButton } from "../ui/Icon";
import {
  Badge,
  type EditScope,
  LOCKED,
  matches,
  PRECEDENCE,
  Row,
  SCOPE_LABEL,
  ScopeSelect,
  Section,
  useSubmit,
} from "./parts";

const MODES: [string, string][] = [
  ["default", "Ask before acting (default)"],
  ["acceptEdits", "Edit files without asking"],
  ["plan", "Plan first"],
  ["auto", "Auto (Claude decides what's safe)"],
  ["dontAsk", "Don't ask (deny what isn't allowed)"],
  ["bypassPermissions", "Bypass all checks (sandboxes only)"],
];

/** Rules people add most, in Claude's own syntax. */
const COMMON: [string, string][] = [
  ["Read", "Read any file"],
  ["Edit", "Edit any file"],
  ["Write", "Create files"],
  ["Glob", "Find files by name"],
  ["Grep", "Search inside files"],
  ["WebSearch", "Search the web"],
  ["WebFetch", "Open web pages"],
  ["NotebookEdit", "Edit notebooks"],
  ["Bash(git status)", "git status"],
  ["Bash(git diff *)", "git diff"],
  ["Bash(git log *)", "git log"],
  ["Bash(git commit *)", "git commit"],
  ["Bash(git push *)", "git push"],
  ["Bash(npm run *)", "npm scripts"],
  ["Bash(npm test *)", "npm test"],
  ["Bash(rm *)", "Delete files (rm)"],
];

/** Lists longer than this show the rest on request. */
const SHOWN = 6;

const LISTS = [
  ["allow", "Allowed without asking"],
  ["ask", "Always ask"],
  ["deny", "Never allowed"],
] as const;

export function PermissionsSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const [rule, setRule] = useState("");
  const [list, setList] = useState<"allow" | "ask" | "deny">("allow");
  const [scope, setScope] = useState<EditScope>("user");
  const [more, setMore] = useState<string[]>([]);
  // The typed rule is cleared only once it was really added.
  const adding = useSubmit(() => setRule(""));
  const rules = s.permissions.rules.filter((r) => matches(q, r.rule, r.list));
  const byScope = (sc: string) => s.permissions.defaultMode.find((m) => m.scope === sc);
  const modeFrom = PRECEDENCE.map(byScope).find(Boolean);
  const mode = modeFrom?.mode ?? "";
  const locked = modeFrom?.scope === "managed";
  return (
    <Section
      id="permissions"
      title="Permissions"
      icon="shield"
      count={s.permissions.rules.length}
      hidden={q.trim() !== "" && rules.length === 0}
    >
      <label class="field">
        <span>Claude starts in</span>
        <select
          aria-label="Default permission mode"
          value={mode}
          disabled={locked}
          title={locked ? LOCKED : undefined}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            post({
              type: "setup:setSetting",
              scope: "auto",
              key: "permissions.defaultMode",
              value: v || null,
            });
          }}
        >
          <option value="">Claude's default</option>
          {MODES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {LISTS.map(([id, label]) => {
        const all = rules.filter((r) => r.list === id);
        if (!all.length) return null;
        const open = more.includes(id) || q.trim() !== "";
        const items = open ? all : all.slice(0, SHOWN);
        return (
          <div key={id} class="subgroup">
            <h4 class="subgroup-title">
              {label} <span class="muted">· {all.length}</span>
            </h4>
            <ul class="srows">
              {items.map((r) => (
                <Row
                  key={`${r.scope}:${r.list}:${r.rule}`}
                  title={r.rule}
                  badges={<Badge>{SCOPE_LABEL[r.scope]}</Badge>}
                  actions={
                    r.scope === "managed" ? null : (
                      <IconButton
                        icon="trash"
                        label={`Remove rule ${r.rule}`}
                        onClick={() =>
                          post({
                            type: "setup:rule",
                            op: "remove",
                            scope: r.scope as EditScope,
                            list: r.list,
                            rule: r.rule,
                          })
                        }
                      />
                    )
                  }
                />
              ))}
            </ul>
            {all.length > items.length ? (
              <button type="button" class="link-btn" onClick={() => setMore([...more, id])}>
                Show {all.length - items.length} more
              </button>
            ) : null}
          </div>
        );
      })}
      <div class="form compact">
        <label class="field">
          <span>Common rules</span>
          <select
            aria-label="Common rules"
            value=""
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v) setRule(v);
            }}
          >
            <option value="">Pick one to fill in…</option>
            {COMMON.map(([r, l]) => (
              <option key={r} value={r}>
                {l}: {r}
              </option>
            ))}
            {[...new Set(s.mcp.map((m) => m.name))].map((n) => (
              <option key={n} value={`mcp__${n}`}>
                Every tool of the {n} server: mcp__{n}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>New rule</span>
          <input
            class="mono"
            aria-label="New rule"
            value={rule}
            placeholder="Bash(npm test), Read(./src/**), mcp__github"
            onInput={(e) => setRule((e.target as HTMLInputElement).value)}
          />
        </label>
        <div class="form-row">
          <select
            aria-label="Rule list"
            value={list}
            onChange={(e) => setList((e.target as HTMLSelectElement).value as typeof list)}
          >
            <option value="allow">Allow</option>
            <option value="ask">Ask</option>
            <option value="deny">Deny</option>
          </select>
          <ScopeSelect value={scope} onChange={setScope} label="in" />
          <button
            type="button"
            class="btn small"
            disabled={!rule.trim() || rule.trim().length > 500 || adding.busy}
            onClick={() =>
              adding.submit({ type: "setup:rule", op: "add", scope, list, rule: rule.trim() })
            }
          >
            {adding.busy ? "Adding…" : "Add rule"}
          </button>
        </div>
      </div>
      <section class="subgroup" aria-label="Other folders Claude may use">
        <h4 class="subgroup-title">Other folders Claude may use</h4>
        {s.permissions.additionalDirectories.length ? (
          <ul class="srows">
            {s.permissions.additionalDirectories.map((d) => (
              <Row
                key={`${d.scope}:${d.dir}`}
                title={d.dir}
                badges={<Badge>{SCOPE_LABEL[d.scope]}</Badge>}
                actions={
                  d.scope === "managed" ? null : (
                    <IconButton
                      icon="trash"
                      label={`Remove ${d.dir}`}
                      onClick={() =>
                        post({
                          type: "setup:dir",
                          op: "remove",
                          scope: d.scope as EditScope,
                          dir: d.dir,
                        })
                      }
                    />
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <p class="sec-empty">
            Only the project's own folder. Add others Claude may read and edit.
          </p>
        )}
        <button
          type="button"
          class="btn secondary small"
          onClick={() => post({ type: "setup:dir", op: "add", scope: "user" })}
        >
          Add a folder…
        </button>
      </section>
    </Section>
  );
}
