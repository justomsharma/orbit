import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { modelLabel } from "../../core/pricing";
import type { UsageSummary } from "../../features/usage/aggregate";
import { post } from "../bus";
import { duration } from "../chats/model";
import type { Range } from "../store";
import * as store from "../store";
import { BarChart } from "../ui/charts/BarChart";
import { formatCost, formatPct, formatTokens } from "../ui/charts/format";
import { StatTile } from "../ui/charts/StatTile";
import { YearMap } from "../ui/charts/YearMap";
import { Icon, IconButton } from "../ui/Icon";
import { dayKey, favourite, glance } from "./glance";
import { dailyBars, projectLabel } from "./model";
import { QuotaCard } from "./QuotaCard";
import { RecapCard } from "./RecapCard";
import { UsageGlance } from "./UsageGlance";
import { yearPng } from "./yearImage";

const RANGES: { id: Range; label: string; title: string }[] = [
  { id: "today", label: "Today", title: "today" },
  { id: "week", label: "7 days", title: "last 7 days" },
  { id: "month", label: "30 days", title: "last 30 days" },
  { id: "all", label: "All time", title: "all time" },
];

/** Opus blue, Sonnet amber, Haiku green, lighter for newer versions; grey for unknown. */
export function modelColor(model: string): string {
  const m = model.match(/(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?/i);
  if (!m) return "hsl(220 8% 55%)";
  const family = m[1]!.toLowerCase();
  const hue = family === "sonnet" ? 32 : family === "haiku" ? 155 : family === "fable" ? 280 : 220;
  const sat = family === "haiku" ? 60 : 75;
  const light = Math.min(70, Math.max(35, 40 + Number(m[3] ?? 0) * 3));
  return `hsl(${hue} ${sat}% ${light}%)`;
}

/** A section that opens and closes, remembering which are open. */
function Block({
  id,
  title,
  count,
  children,
  actions,
}: {
  id: string;
  title: string;
  count?: number;
  children: ComponentChildren;
  actions?: ComponentChildren;
}) {
  const open = !store.usageShut.value.includes(id);
  const toggle = () => {
    const s = new Set(store.usageShut.value);
    if (open) s.add(id);
    else s.delete(id);
    store.usageShut.value = [...s];
  };
  return (
    <section class={`card block${open ? " open" : ""}`} aria-labelledby={`b-${id}`}>
      <div class="block-head">
        <button type="button" class="block-toggle" aria-expanded={open} onClick={toggle}>
          <Icon name={open ? "chevron-down" : "chevron-right"} />
          <h3 id={`b-${id}`} class="section-title">
            {title}
          </h3>
          {count !== undefined ? <span class="block-count">{count}</span> : null}
        </button>
        {actions}
      </div>
      {open ? <div class="block-body">{children}</div> : null}
    </section>
  );
}

/** How much each model was used, as one bar with a legend. */
function Models({ s, asOf }: { s: UsageSummary; asOf: string }) {
  const total = s.byModel.reduce((a, m) => a + m.tokens, 0);
  if (!total) return null;
  // Every model stays visible (at least 1.5%), taking the room from the biggest.
  const raw = s.byModel.map((m) => (m.tokens / total) * 100);
  const floored = raw.map((p) => Math.max(1.5, p));
  const extra = floored.reduce((a, p) => a + p, 0) - 100;
  const biggest = raw.indexOf(Math.max(...raw));
  floored[biggest] = Math.max(1.5, floored[biggest]! - extra);
  return (
    <Block id="models" title="Cost & models" count={s.byModel.length}>
      <div class="models-head">
        <span>If billed via the API</span>
        <strong title="What these tokens would cost at Anthropic's API prices. Pro and Max plans pay a flat fee instead.">
          {formatCost(s.cost)}
        </strong>
      </div>
      <div
        class="share-bar"
        role="img"
        aria-label={`Tokens by model: ${s.byModel.map((m, i) => `${modelLabel(m.model)} ${Math.round(raw[i]!)}%`).join(", ")}`}
      >
        {s.byModel.map((m, i) => (
          <span
            key={m.model}
            class="share-seg"
            style={{ width: `${floored[i]}%`, background: modelColor(m.model) }}
            title={`${modelLabel(m.model)} · ${Math.round(raw[i]!)}%`}
          />
        ))}
      </div>
      <ul class="legend">
        {s.byModel.map((m, i) => (
          <li key={m.model} title={`${m.model} · ${formatCost(m.cost)}`}>
            <span class="legend-dot" style={{ background: modelColor(m.model) }} />
            <span class="legend-name">{modelLabel(m.model)}</span>
            <span class="legend-value">
              {m.cost === null ? "—" : formatCost(m.cost)} · {Math.round(raw[i]!)}%
            </span>
          </li>
        ))}
      </ul>
      <p class="card-hint">Prices as of {asOf}.</p>
    </Block>
  );
}

/** A ranked list that shows the top few and the rest on request. */
function TopList({
  id,
  title,
  rows,
  top,
}: {
  id: string;
  title: string;
  rows: {
    key: string;
    label: string;
    value: string;
    sub?: string;
    pills?: string[];
    title?: string;
    onClick?: () => void;
  }[];
  top: number;
}) {
  const [all, setAll] = useState(false);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, top);
  return (
    <Block id={id} title={title} count={rows.length}>
      <ul class="rank-list">
        {shown.map((r) => (
          <li key={r.key} title={r.title}>
            {r.onClick ? (
              <button type="button" class="rank-link" onClick={r.onClick}>
                <span class="rank-label">{r.label}</span>
                <span class="rank-value">{r.value}</span>
              </button>
            ) : (
              <div class="rank-row">
                <span class="rank-label">{r.label}</span>
                {r.pills?.map((p) => (
                  <span key={p} class="tag">
                    {p}
                  </span>
                ))}
                <span class="rank-value">{r.value}</span>
              </div>
            )}
            {r.sub ? <span class="rank-sub">{r.sub}</span> : null}
          </li>
        ))}
      </ul>
      {rows.length > top ? (
        <button type="button" class="link-btn" onClick={() => setAll(!all)}>
          {all ? "Show less" : `Show ${rows.length - top} more`}
        </button>
      ) : null}
    </Block>
  );
}

/** `mcp__github__create_issue` → "github: create_issue"; built-in tools as they are. */
const toolName = (n: string) => n.replace(/^mcp__(.+?)__/, "$1: ");

export function UsageView() {
  const u = store.usage.value;
  if (!u) {
    return (
      <div class="loading" role="status">
        Reading your usage… The first time reads every chat, so a long history takes a few seconds.
      </div>
    );
  }
  const r = RANGES.find((x) => x.id === store.range.value) ?? RANGES[2]!;
  const s = u[r.id];
  const own = s.tokens.input + s.tokens.output;
  const today = dayKey(store.now.value);
  const byId = new Map(store.sessions.value.map((c) => [c.id, c]));
  const renames = store.renames.value;

  const shareYear = () => {
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    const dataUrl = yearPng(
      {
        days: u.year,
        chats: u.all.sessions,
        tokens:
          u.all.tokens.input +
          u.all.tokens.output +
          u.all.tokens.cacheRead +
          u.all.tokens.cacheWrite,
        streak: glance(u.all.daily, today).streak,
        model: favourite(u.all.byModel)?.model ?? null,
      },
      font,
    );
    if (dataUrl) post({ type: "saveRecapImage", dataUrl, which: "year" });
  };

  return (
    <section class="usage scroll">
      <fieldset class="chips range-chips">
        <legend class="sr-only">Time range</legend>
        {RANGES.map((x) => (
          <button
            key={x.id}
            type="button"
            class={`chip${x.id === r.id ? " on" : ""}`}
            aria-pressed={x.id === r.id}
            onClick={() => (store.range.value = x.id)}
          >
            {x.label}
          </button>
        ))}
      </fieldset>

      <div class="hero">
        <span class="hero-label">API value · {r.title}</span>
        <span class="hero-value">{formatCost(s.cost)}</span>
        <span class="hero-note">
          What this usage would cost at API list prices ({u.pricingAsOf}). On a Pro or Max plan you
          pay your subscription, not this.
          {s.unpricedModels.length ? ` Not priced: ${s.unpricedModels.join(", ")}.` : ""}
        </span>
      </div>

      <div class="tiles four">
        <StatTile
          label="Tokens"
          value={formatTokens(own)}
          hint={`${formatTokens(s.tokens.input)} sent and ${formatTokens(s.tokens.output)} written by Claude. Another ${formatTokens(s.tokens.cacheRead)} were read from the prompt cache.`}
        />
        <StatTile label="Chats" value={s.sessions.toLocaleString()} />
        <StatTile label="Replies" value={s.messages.toLocaleString()} />
        <StatTile
          label="Cache read"
          value={formatTokens(s.tokens.cacheRead)}
          hint={`${formatPct(s.cacheHitRate)} of what Claude read came from its prompt cache (${formatTokens(s.tokens.cacheWrite)} written to it). Higher is cheaper and faster.`}
        />
      </div>

      <UsageGlance link={false} />
      {u.longest.all > 0 ? (
        <p class="glance-extra">
          <Icon name="watch" /> Longest chat:{" "}
          {duration(r.id === "all" ? u.longest.all : u.longest.month)}
          {r.id === "all" ? "" : " in the last 30 days"}
        </p>
      ) : null}

      {r.id === "today" ? null : (
        <BarChart
          title={`API value per ${s.daily.length > 90 ? "week" : "day"}`}
          data={dailyBars(s)}
          axis={(v) => formatCost(v)}
        />
      )}

      <QuotaCard />

      <Block
        id="activity"
        title="Activity · last year"
        actions={
          <IconButton
            icon="cloud-download"
            label="Save a shareable image of your year"
            onClick={shareYear}
          />
        }
      >
        <YearMap days={u.year} today={today} />
      </Block>

      <Models s={s} asOf={u.pricingAsOf} />
      {s.byProject.length > 1 ? (
        <TopList
          id="projects"
          title="Projects"
          top={5}
          rows={s.byProject.map((p) => ({
            key: p.cwd,
            label: projectLabel(p.cwd),
            value: formatCost(p.cost),
            sub: `${formatTokens(p.tokens)} tokens`,
            title: p.cwd,
          }))}
        />
      ) : null}
      <TopList
        id="tools"
        title="Tools Claude used"
        top={8}
        rows={s.tools.map((t) => ({
          key: t.name,
          label: toolName(t.name),
          value: `${t.count.toLocaleString()}×`,
        }))}
      />
      <TopList
        id="mcp"
        title="MCP servers"
        top={8}
        rows={s.mcp.map((m) => ({
          key: m.server,
          label: m.server,
          value: "",
          pills: [
            `${m.count.toLocaleString()} call${m.count === 1 ? "" : "s"}`,
            `${m.tools} tool${m.tools === 1 ? "" : "s"}`,
          ],
        }))}
      />
      <TopList
        id="chats"
        title="Biggest chats"
        top={5}
        rows={s.topSessions
          .filter((t) => byId.has(t.session))
          .map((t) => ({
            key: t.session,
            label: renames[t.session] ?? byId.get(t.session)!.title,
            value: formatCost(t.cost),
            onClick: () => post({ type: "openChat", id: t.session }),
          }))}
      />
      <RecapCard />
    </section>
  );
}
