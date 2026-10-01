import { modelLabel } from "../../core/pricing";
import type { UsageSummary } from "../../features/usage/aggregate";
import { post } from "../bus";
import type { Range } from "../store";
import * as store from "../store";
import { BarChart } from "../ui/charts/BarChart";
import { formatCost, formatPct, formatTokens } from "../ui/charts/format";
import { Heatmap } from "../ui/charts/Heatmap";
import { RankList } from "../ui/charts/RankList";
import { StatTile } from "../ui/charts/StatTile";
import { dailyBars, projectLabel } from "./model";
import { QuotaCard } from "./QuotaCard";
import { RecapCard } from "./RecapCard";
import { UsageGlance } from "./UsageGlance";

const RANGES: { id: Range; label: string; title: string }[] = [
  { id: "today", label: "Today", title: "today" },
  { id: "week", label: "7 days", title: "last 7 days" },
  { id: "month", label: "30 days", title: "last 30 days" },
  { id: "all", label: "All time", title: "all time" },
];

const totalTokens = (s: UsageSummary) =>
  s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheWrite;

function TopChats({ s }: { s: UsageSummary }) {
  const byId = new Map(store.sessions.value.map((c) => [c.id, c]));
  const rows = s.topSessions.filter((t) => byId.has(t.session)).slice(0, 5);
  if (!rows.length) return null;
  const renames = store.renames.value;
  return (
    <section class="rank card" aria-label="Most expensive chats">
      <h3 class="section-title">Biggest chats</h3>
      <ul class="rank-list">
        {rows.map((t) => {
          const c = byId.get(t.session)!;
          return (
            <li key={t.session}>
              <button
                type="button"
                class="rank-link"
                onClick={() => post({ type: "openChat", id: t.session })}
              >
                <span class="rank-label">{renames[c.id] ?? c.title}</span>
                <span class="rank-value">{formatCost(t.cost)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function UsageView() {
  const u = store.usage.value;
  if (!u) {
    return (
      <div class="loading" role="status">
        Reading your usage… The first time can take a few seconds for a long history.
      </div>
    );
  }
  const r = RANGES.find((x) => x.id === store.range.value) ?? RANGES[2]!;
  const s = u[r.id];
  const heat = u.heat.map((h) => ({
    day: h.day,
    label: new Date(`${h.day}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    value: h.tokens,
    display: `${formatTokens(h.tokens)} tokens`,
  }));

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

      <div class="tiles">
        <StatTile label="Tokens" value={formatTokens(totalTokens(s))} />
        <StatTile label="Replies" value={s.messages.toLocaleString()} />
        <StatTile
          label="Cache hits"
          value={formatPct(s.cacheHitRate)}
          hint="Share of input Claude read from its prompt cache. Higher is cheaper and faster."
        />
      </div>

      <UsageGlance link={false} />

      {r.id === "today" ? null : (
        <BarChart
          title={`API value per ${s.daily.length > 90 ? "week" : "day"}`}
          data={dailyBars(s)}
          axis={(v) => formatCost(v)}
        />
      )}

      <QuotaCard />

      <section class="card">
        <h3 class="section-title">Activity · last 26 weeks</h3>
        <Heatmap title="Daily activity" cells={heat} />
      </section>

      {s.byModel.length ? (
        <RankList
          title="By model"
          items={s.byModel.map((m) => ({
            key: m.model,
            label: modelLabel(m.model),
            value: m.cost ?? 0,
            display: formatCost(m.cost),
            sub: m.model,
          }))}
        />
      ) : null}
      {s.byProject.length ? (
        <RankList
          title="By project"
          items={s.byProject.slice(0, 8).map((p) => ({
            key: p.cwd,
            label: projectLabel(p.cwd),
            value: p.cost,
            display: formatCost(p.cost),
            sub: p.cwd,
          }))}
        />
      ) : null}
      {s.tools.length ? (
        <RankList
          title="Tools Claude used"
          items={s.tools.map((t) => ({
            key: t.name,
            label: t.name,
            value: t.count,
            display: `${t.count.toLocaleString()}×`,
          }))}
        />
      ) : null}
      {s.mcp.length ? (
        <RankList
          title="MCP servers"
          items={s.mcp.map((m) => ({
            key: m.server,
            label: m.server,
            value: m.count,
            display: `${m.count.toLocaleString()}×`,
            sub: `${m.tools} tool${m.tools === 1 ? "" : "s"}`,
          }))}
        />
      ) : null}
      <TopChats s={s} />
      <RecapCard />
    </section>
  );
}
