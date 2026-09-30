import { post } from "../bus";
import * as store from "../store";
import { Badge, decided, matches, Row, Section, Switch } from "./parts";

const MD_LABEL: Record<string, string> = {
  user: "Your instructions (all projects)",
  project: "Project instructions (shared)",
  "project-dir": "Project instructions in .claude/",
  local: "Your notes for this folder",
  managed: "Organisation instructions",
};

export function MemorySection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const m = s.memory;
  const mdFiles = m.claudeMd.filter(
    (f) => (f.exists || f.scope !== "managed") && matches(q, MD_LABEL[f.scope], f.path),
  );
  const memFiles = m.auto.files.filter((f) => matches(q, f.title, f.description, f.name));
  const autoBy = decided("autoMemoryEnabled");
  const autoOn = autoBy?.value !== false;
  return (
    <Section
      id="memory"
      title="Memory"
      icon="notebook"
      count={m.claudeMd.filter((f) => f.exists).length + m.auto.files.length}
      hidden={q.trim() !== "" && mdFiles.length === 0 && memFiles.length === 0}
    >
      <div class="subgroup">
        <h4 class="subgroup-title">CLAUDE.md</h4>
        <ul class="srows">
          {mdFiles.map((f) =>
            f.exists ? (
              <Row
                key={f.path}
                title={MD_LABEL[f.scope] ?? f.scope}
                sub={`${Math.max(1, Math.round(f.bytes / 1024))} KB${f.imports.length ? ` · imports ${f.imports.length}` : ""}`}
                onOpen={() => post({ type: "setup:open", file: f.path })}
              />
            ) : f.scope === "project-dir" || f.scope === "managed" ? null : (
              <Row
                key={f.path}
                title={MD_LABEL[f.scope] ?? f.scope}
                sub="Not created yet"
                actions={
                  <button
                    type="button"
                    class="btn small secondary"
                    onClick={() =>
                      post({
                        type: "setup:createClaudeMd",
                        scope: f.scope as "user" | "project" | "local",
                      })
                    }
                  >
                    Create
                  </button>
                }
              />
            ),
          )}
        </ul>
      </div>
      <div class="subgroup">
        <div class="sec-toolbar">
          <h4 class="subgroup-title">Auto memory</h4>
          <Switch
            on={autoOn}
            disabled={autoBy?.scope === "managed"}
            label="Auto memory"
            onChange={(on) =>
              post({ type: "setup:setSetting", scope: "auto", key: "autoMemoryEnabled", value: on })
            }
          />
        </div>
        {memFiles.length ? (
          <ul class="srows">
            {memFiles.map((f) => (
              <Row
                key={f.path}
                title={f.title ?? f.name}
                sub={f.description}
                badges={
                  <>
                    {f.brokenLinks.length ? <Badge tone="warn">Broken links</Badge> : null}
                    {f.orphan ? (
                      <Badge title="Not linked from MEMORY.md or another memory">Unlinked</Badge>
                    ) : null}
                  </>
                }
                onOpen={() => post({ type: "setup:open", file: f.path })}
              />
            ))}
          </ul>
        ) : (
          <p class="sec-empty">
            {s.workspace
              ? "Claude hasn't saved memories for this project yet."
              : "Open a folder to see its memories."}
          </p>
        )}
      </div>
    </Section>
  );
}
