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
        const items = rules.filter((r) => r.list === id);
        if (!items.length) return null;
        return (
          <div key={id} class="subgroup">
            <h4 class="subgroup-title">{label}</h4>
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
          </div>
        );
      })}
      <div class="form compact">
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
    </Section>
  );
}
