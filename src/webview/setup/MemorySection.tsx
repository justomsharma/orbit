import { useContext } from "preact/hooks";
import type { MemoryFile } from "../../features/setup/memory";
import { post } from "../bus";
import { exactTime, relativeTime } from "../chats/model";
import { formatBytes } from "../checkpoints/CheckpointsView";
import * as store from "../store";
import { Icon } from "../ui/Icon";
import { Segmented } from "../ui/Segmented";
import { DetailPage, FileText, Gone, Info, openDetail } from "./Detail";
import { Badge, decided, matches, PageMode, Row, Section, Switch } from "./parts";

const MD_LABEL: Record<string, string> = {
  user: "Your instructions (all projects)",
  project: "Project instructions (shared)",
  "project-dir": "Project instructions in .claude/",
  local: "Your notes for this folder",
  managed: "Organisation instructions",
};

export type MemoryLens = "all" | "orphans" | "broken";

/** A readable project name for a folder in ~/.claude/projects, from the chats Orbit knows. */
function projectName(slug: string): string {
  for (const s of store.sessions.value) {
    const parts = s.file.split(/[\\/]/);
    if (parts[parts.length - 2] === slug) return s.project;
  }
  return slug.replace(/^-+/, "").split("-").filter(Boolean).pop() ?? slug;
}

/** The memories on show: this project's, or the project picked in the list. */
function shownFiles(): { files: MemoryFile[] | null; other: boolean } {
  const pick = store.memoryProject.value;
  if (!pick) return { files: store.setup.value?.memory.auto.files ?? [], other: false };
  const o = store.memoryOther.value;
  return { files: o?.slug === pick ? o.files : null, other: true };
}

const brokenText = (n: number) => `${n} broken link${n === 1 ? "" : "s"}`;

function MemoryBadges({ f }: { f: MemoryFile }) {
  return (
    <>
      {f.type ? <Badge>{f.type}</Badge> : null}
      {f.orphan ? (
        <Badge title="Not linked from MEMORY.md or another memory">Unlinked</Badge>
      ) : null}
      {f.brokenLinks.length ? <Badge tone="warn">{brokenText(f.brokenLinks.length)}</Badge> : null}
      {f.frontmatter ? null : (
        <Badge title="No name or description at the top of the file">No frontmatter</Badge>
      )}
    </>
  );
}

function AutoMemory() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const page = useContext(PageMode);
  const autoBy = decided("autoMemoryEnabled");
  const autoOn = autoBy?.value !== false;
  const lens = page ? store.memoryLens.value : "all";
  const { files, other } = page ? shownFiles() : { files: s.memory.auto.files, other: false };
  const all = files ?? [];
  const searched = all.filter((f) => matches(q, f.title, f.description, f.name, f.type));
  const list = searched.filter((f) =>
    lens === "orphans" ? f.orphan : lens === "broken" ? f.brokenLinks.length > 0 : true,
  );
  const here = s.memoryProjects.find((p) => p.dir === s.memory.auto.dir);
  const others = s.memoryProjects.filter((p) => p.dir !== s.memory.auto.dir);
  return (
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
      {!autoOn ? (
        <p class="sec-empty">
          Auto memory is off, so Claude won't save new memories. The ones it kept are still here.
        </p>
      ) : null}
      {page && others.length ? (
        <select
          class="page-filter"
          aria-label="Project"
          value={store.memoryProject.value}
          onChange={(e) => {
            const slug = (e.target as HTMLSelectElement).value;
            store.memoryProject.value = slug;
            if (slug) post({ type: "setup:memoryOf", slug });
          }}
        >
          <option value="">This project ({here?.count ?? s.memory.auto.files.length})</option>
          {others.map((p) => (
            <option key={p.slug} value={p.slug} title={p.slug}>
              {projectName(p.slug)} ({p.count})
            </option>
          ))}
        </select>
      ) : null}
      {page && all.length ? (
        <Segmented<MemoryLens>
          legend="Show memories"
          value={lens}
          onChange={(v) => (store.memoryLens.value = v)}
          options={[
            { value: "all", label: "All", count: all.length },
            { value: "orphans", label: "Unlinked", count: all.filter((f) => f.orphan).length },
            {
              value: "broken",
              label: "Broken",
              count: all.filter((f) => f.brokenLinks.length).length,
            },
          ]}
        />
      ) : null}
      {files === null ? (
        <p class="muted" role="status">
          Reading…
        </p>
      ) : list.length ? (
        <ul class="srows">
          {list.map((f) => (
            <Row
              key={f.path}
              title={f.title ?? f.name}
              sub={f.description}
              mono={page ? f.name : null}
              badges={<MemoryBadges f={f} />}
              onSelect={page ? () => openDetail("memory", f.path) : undefined}
              onOpen={() => post({ type: "setup:open", file: f.path })}
            />
          ))}
        </ul>
      ) : (
        <p class="sec-empty">
          {all.length
            ? "No memories here. Try another filter."
            : other
              ? "That project has no memories."
              : s.workspace
                ? "Claude hasn't saved memories for this project yet."
                : "Open a folder to see its memories."}
        </p>
      )}
    </div>
  );
}

export function MemorySection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const m = s.memory;
  const mdFiles = m.claudeMd.filter(
    (f) => (f.exists || f.scope !== "managed") && matches(q, MD_LABEL[f.scope], f.path),
  );
  const memFiles = m.auto.files.filter((f) => matches(q, f.title, f.description, f.name));
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
      <AutoMemory />
    </Section>
  );
}

/** One memory: what it says, where it links, and who links to it. */
export function MemoryDetail({ id }: { id: string }) {
  const s = store.setup.value!;
  const pool = [...s.memory.auto.files, ...(store.memoryOther.value?.files ?? [])];
  const f = pool.find((x) => x.path === id);
  if (!f) return <Gone back="All memories" what="memory" />;
  const siblings = pool.filter((x) => x.path !== f.path && sameDir(x.path, f.path));
  const byName = (n: string) =>
    siblings.find((x) =>
      [x.title, x.name, x.name.replace(/\.md$/i, "")].some(
        (k) => k?.toLowerCase() === n.toLowerCase(),
      ),
    );
  const pick = store.memoryProject.value;
  const project = pick ? projectName(pick) : "This project";
  return (
    <DetailPage
      back="All memories"
      title={f.title ?? f.name}
      sub={f.description}
      badges={<MemoryBadges f={f} />}
      actions={
        <>
          <button
            type="button"
            class="btn small secondary"
            onClick={() => post({ type: "setup:open", file: f.path })}
          >
            <Icon name="go-to-file" /> Open file
          </button>
          <button
            type="button"
            class="btn small secondary"
            onClick={() => post({ type: "setup:revealFile", file: f.path })}
          >
            <Icon name="folder-opened" /> Show in folder
          </button>
          <button
            type="button"
            class="btn small secondary danger"
            title="Moves the file to Orbit's trash; Undo puts it back"
            onClick={() => post({ type: "setup:trash", file: f.path })}
          >
            <Icon name="trash" /> Delete…
          </button>
        </>
      }
    >
      <Info
        label="About this memory"
        rows={[
          ["Project", project],
          ["Type", f.type],
          [
            "Changed",
            f.modified ? (
              <span title={exactTime(f.modified)}>{relativeTime(f.modified, store.now.value)}</span>
            ) : null,
          ],
          ["Size", formatBytes(f.bytes)],
          [
            "In MEMORY.md",
            f.indexEntry ? <code class="srow-mono wrap">{f.indexEntry}</code> : "Not listed",
          ],
          [
            "File",
            <code key="f" class="srow-mono">
              {f.path}
            </code>,
          ],
        ]}
      />
      <LinkList
        label="Links to"
        names={f.links}
        find={byName}
        empty="It doesn't link to other memories."
      />
      <LinkList
        label="Linked from"
        names={f.linksIn}
        find={byName}
        empty="No other memory links here."
      />
      <FileText file={f.path} />
    </DetailPage>
  );
}

const sameDir = (a: string, b: string) =>
  a.replace(/[\\/][^\\/]*$/, "") === b.replace(/[\\/][^\\/]*$/, "");

function LinkList({
  label,
  names,
  find,
  empty,
}: {
  label: string;
  names: string[];
  find: (n: string) => MemoryFile | undefined;
  empty: string;
}) {
  return (
    <section class="detail-block" aria-label={label}>
      <h4 class="subgroup-title">{label}</h4>
      {names.length ? (
        <ul class="link-list">
          {names.map((n) => {
            const t = find(n);
            return (
              <li key={n}>
                {t ? (
                  <button
                    type="button"
                    class="link-btn"
                    onClick={() => openDetail("memory", t.path)}
                  >
                    {n}
                  </button>
                ) : (
                  <span class="muted">
                    <Icon name="warning" /> {n} (not found)
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="muted">{empty}</p>
      )}
    </section>
  );
}
