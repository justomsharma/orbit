import { useEffect, useRef, useState } from "preact/hooks";
import { BUILTIN_COMMANDS } from "../../features/setup/builtinCommands";
import { hookTitle } from "../../features/setup/hookEvents";
import { TABS } from "../../shared/tabs";
import { openDetails } from "../chats/open";
import { openChat as openCheckpoints } from "../checkpoints/CheckpointsView";
import { openTab } from "../nav";
import { openDetail } from "../setup/Detail";
import { mcpKey } from "../setup/McpSection";
import * as store from "../store";
import { Icon } from "../ui/Icon";

export interface PaletteItem {
  key: string;
  group: string;
  title: string;
  sub?: string;
  icon: string;
  run: () => void;
}

const MAX = 50;
const RECENT_CHATS = 6;

const detail = (page: Parameters<typeof openDetail>[0], key: string) => () => {
  openTab(page);
  openDetail(page, key);
};

/** Everything the palette can open, from what Orbit has read so far. */
function allItems(): PaletteItem[] {
  const out: PaletteItem[] = TABS.map((t) => ({
    key: `tab:${t.id}`,
    group: "Go to",
    title: t.label,
    sub: t.blurb,
    icon: t.icon,
    run: () => openTab(t.id),
  }));
  const renames = store.renames.value;
  for (const s of [...store.sessions.value].sort((a, b) => b.lastActiveAt - a.lastActiveAt))
    out.push({
      key: `chat:${s.id}`,
      group: "Chats",
      title: renames[s.id] || s.title,
      sub: s.project,
      icon: "comment-discussion",
      run: () => {
        openTab("chats");
        openDetails(s.id);
      },
    });
  const s = store.setup.value;
  if (s) {
    for (const k of s.skills)
      out.push({
        key: `skill:${k.file}`,
        group: "Skills",
        title: k.name,
        sub: k.description ?? undefined,
        icon: "sparkle",
        run: detail("skills", k.file),
      });
    for (const c of s.commands)
      out.push({
        key: `cmd:${c.file}`,
        group: "Commands",
        title: `/${c.name}`,
        sub: c.description ?? undefined,
        icon: "terminal",
        run: detail("commands", c.file),
      });
    for (const a of s.agents)
      out.push({
        key: `agent:${a.file}`,
        group: "Agents",
        title: a.name,
        sub: a.description ?? undefined,
        icon: "hubot",
        run: detail("agents", a.file),
      });
    for (const h of s.hooks)
      out.push({
        key: `hook:${h.id}`,
        group: "Hooks",
        title: hookTitle(h.command, h.url),
        sub: h.event,
        icon: "zap",
        run: detail("hooks", h.id),
      });
    for (const m of s.mcp)
      out.push({
        key: `mcp:${mcpKey(m)}`,
        group: "MCP servers",
        title: m.name,
        sub: m.url ?? m.command ?? undefined,
        icon: "plug",
        run: detail("mcp", mcpKey(m)),
      });
    for (const p of s.plugins)
      out.push({
        key: `plugin:${p.id}`,
        group: "Plugins",
        title: p.name,
        sub: p.description ?? undefined,
        icon: "package",
        run: detail("plugins", p.id),
      });
    for (const f of s.memory.auto.files)
      out.push({
        key: `memory:${f.path}`,
        group: "Memory",
        title: f.title ?? f.name,
        sub: f.description ?? undefined,
        icon: "book",
        run: detail("memory", f.path),
      });
  }
  for (const b of BUILTIN_COMMANDS)
    out.push({
      key: `builtin:${b.name}`,
      group: "Commands",
      title: `/${b.name}`,
      sub: b.description,
      icon: "terminal",
      run: detail("commands", `builtin:${b.name}`),
    });
  for (const p of store.prompts.value ?? [])
    out.push({
      key: `prompt:${p.id}`,
      group: "Prompts",
      title: p.text.length > 80 ? `${p.text.slice(0, 79)}…` : p.text,
      icon: "quote",
      run: () => {
        openTab("prompts");
        store.promptQuery.value = p.text.slice(0, 40);
      },
    });
  for (const c of store.checkpoints.value ?? []) {
    const chat = store.sessions.value.find((x) => x.id === c.id);
    out.push({
      key: `cp:${c.id}`,
      group: "Checkpoints",
      title: renames[c.id] || chat?.title || `Chat ${c.id.slice(0, 8)}`,
      sub: `${c.files} files`,
      icon: "history",
      run: () => {
        openTab("checkpoints");
        openCheckpoints(c.id);
      },
    });
  }
  return out;
}

/** Best matches first: name starts with it, then contains it, then the detail line does. */
export function paletteItems(query: string): PaletteItem[] {
  const all = allItems();
  const q = query.trim().toLowerCase();
  if (!q) {
    const tabs = all.filter((i) => i.group === "Go to");
    const chats = all.filter((i) => i.group === "Chats").slice(0, RECENT_CHATS);
    return [...tabs, ...chats];
  }
  const words = q.split(/\s+/);
  const score = (i: PaletteItem) => {
    const t = i.title.toLowerCase().replace(/^\//, "");
    const sub = (i.sub ?? "").toLowerCase();
    if (!words.every((w) => t.includes(w) || sub.includes(w))) return 0;
    if (t.startsWith(q.replace(/^\//, ""))) return 3;
    if (words.every((w) => t.includes(w))) return 2;
    return 1;
  };
  const best = all
    .map((i, n) => ({ i, s: score(i), n }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.n - b.n)
    .slice(0, MAX);
  // Each group once, in the order of its best match.
  const rank = new Map<string, number>();
  best.forEach((x, k) => {
    if (!rank.has(x.i.group)) rank.set(x.i.group, k);
  });
  return best
    .map((x, k) => ({ ...x, k }))
    .sort((a, b) => rank.get(a.i.group)! - rank.get(b.i.group)! || a.k - b.k)
    .map((x) => x.i);
}

/** Ctrl/Cmd+K: search tabs, chats, skills, commands, agents, hooks, servers and more. */
export function Palette() {
  const open = store.paletteOpen.value;
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        store.paletteOpen.value = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    setQ("");
    setAt(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  if (!open) return null;
  const items = paletteItems(q);
  const close = () => (store.paletteOpen.value = false);
  const choose = (i: PaletteItem | undefined) => {
    if (!i) return;
    close();
    i.run();
  };
  const onKey = (e: KeyboardEvent) => {
    const n = items.length;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((x) => (n ? (x + 1) % n : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((x) => (n ? (x + n - 1) % n : 0));
    } else if (e.key === "Home") {
      setAt(0);
    } else if (e.key === "End") {
      setAt(Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[at]);
    }
  };
  let lastGroup = "";
  const rows = items.flatMap((i, n) => {
    const head = i.group !== lastGroup ? i.group : null;
    lastGroup = i.group;
    const option = (
      <div
        key={i.key}
        id={`pal-${n}`}
        role="option"
        tabIndex={-1}
        aria-selected={n === at}
        class={`palette-item${n === at ? " on" : ""}`}
        onMouseMove={() => setAt(n)}
        // Mouse down, not click: the search box keeps focus, as in VS Code's own pickers.
        onMouseDown={(e) => {
          e.preventDefault();
          choose(i);
        }}
      >
        <Icon name={i.icon} />
        <span class="palette-title">{i.title}</span>
        {i.sub ? <span class="palette-sub">{i.sub}</span> : null}
      </div>
    );
    return head
      ? [
          <div key={`h:${head}`} class="palette-group" role="presentation">
            {head}
          </div>,
          option,
        ]
      : [option];
  });
  return (
    <div class="palette-backdrop" onMouseDown={close}>
      <div
        class="palette"
        role="dialog"
        aria-label="Search everything"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div class="search palette-search">
          <Icon name="search" />
          <input
            ref={input}
            role="combobox"
            aria-label="Search everything"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[at] ? `pal-${at}` : undefined}
            placeholder="Search chats, skills, commands, agents, servers…"
            value={q}
            onInput={(e) => {
              setQ((e.target as HTMLInputElement).value);
              setAt(0);
            }}
            onKeyDown={onKey}
          />
        </div>
        <div id="palette-list" class="palette-list" role="listbox" aria-label="Results">
          {items.length ? rows : <p class="palette-empty">Nothing matches "{q}".</p>}
        </div>
        <p class="palette-hint">↑↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  );
}
