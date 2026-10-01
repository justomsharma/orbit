import { post } from "../bus";
import { relativeTime } from "../chats/model";
import * as store from "../store";
import { formatCost, formatTokens } from "../ui/charts/format";
import { StatTile } from "../ui/charts/StatTile";
import { Empty } from "../ui/Empty";
import { Icon } from "../ui/Icon";
import { GettingStarted } from "./GettingStarted";
import { costDelta, greeting } from "./model";
import { QuotaCard } from "./QuotaCard";

const LIVE = { busy: "Working…", idle: "Waiting for you", unknown: "Running" } as const;

function Running() {
  const live = new Map(store.live.value.map((l) => [l.sessionId, l]));
  const chats = store.sessions.value.filter((s) => live.has(s.id));
  if (!chats.length) return null;
  const renames = store.renames.value;
  return (
    <section class="card">
      <h3 class="section-title">Running now</h3>
      <ul class="mini-list">
        {chats.map((s) => {
          const st = live.get(s.id)!.status;
          return (
            <li key={s.id}>
              <button
                type="button"
                class="mini-row"
                onClick={() => post({ type: "openChat", id: s.id })}
              >
                <span class={`live-dot ${st === "busy" ? "busy" : "idle"}`} aria-hidden="true" />
                <span class="mini-title">{renames[s.id] ?? s.title}</span>
                <span class={`mini-meta live-label ${st}`}>{LIVE[st]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LastChat() {
  const here = new Set(store.here.value);
  const all = store.sessions.value;
  const last = all.find((s) => here.has(s.id)) ?? all[0];
  if (!last) return null;
  const title = store.renames.value[last.id] ?? last.title;
  return (
    <section class="card continue-card">
      <h3 class="section-title">Pick up where you left off</h3>
      <p class="continue-title">{title}</p>
      <p class="card-meta">
        {[last.project, last.branch, relativeTime(last.lastActiveAt, Date.now())]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div class="card-actions">
        <button type="button" class="btn" onClick={() => post({ type: "openChat", id: last.id })}>
          Continue
        </button>
        <button
          type="button"
          class="btn secondary"
          onClick={() => post({ type: "openTerminal", id: last.id })}
        >
          <Icon name="terminal" /> Terminal
        </button>
      </div>
    </section>
  );
}

function Today() {
  const u = store.usage.value;
  if (!u) return null;
  const t = u.today;
  const tokens = t.tokens.input + t.tokens.output + t.tokens.cacheRead + t.tokens.cacheWrite;
  return (
    <section aria-label="Today">
      <div class="tiles">
        <StatTile
          label="API value today"
          value={formatCost(t.cost)}
          delta={costDelta(t.cost, u.yesterday.cost)}
          hint="What today's usage would cost at API list prices."
        />
        <StatTile label="Replies" value={t.messages.toLocaleString()} />
        <StatTile label="Tokens" value={formatTokens(tokens)} />
      </div>
      <p class="hero-note tiles-note">
        API value = what this usage would cost at API list prices. On a Pro or Max plan you pay your
        subscription instead.
      </p>
    </section>
  );
}

function WeekTeaser() {
  const u = store.usage.value;
  if (!u || u.recap.chats === 0) return null;
  const r = u.recap;
  return (
    <section class="card">
      <h3 class="section-title">This week</h3>
      <p class="card-text">
        {r.chats} chats · {r.prompts} prompts · {r.activeDays}/7 active days
        {r.busiestDay ? ` · busiest on ${r.busiestDay}` : ""}
      </p>
      <button
        type="button"
        class="link-btn"
        onClick={() => {
          store.tab.value = "usage";
          // Scroll only the Usage tab's own area (never the page) so the recap comes into view.
          requestAnimationFrame(() => {
            const recap = document.getElementById("recap");
            const area = recap?.closest(".scroll");
            if (recap && area) area.scrollTo({ top: recap.offsetTop - 12 });
          });
        }}
      >
        See your week
      </button>
    </section>
  );
}

export function HomeView() {
  const hour = new Date().getHours();
  const hasChats = store.sessions.value.length > 0;
  return (
    <section class="home scroll">
      <header class="home-head">
        <h1 class="home-title">{greeting(hour)}</h1>
        <button type="button" class="btn" onClick={() => post({ type: "newChat" })}>
          <Icon name="add" /> New chat
        </button>
      </header>
      <GettingStarted />
      {!store.loaded.value ? (
        <div class="loading" role="status">
          Loading…
        </div>
      ) : hasChats ? (
        <>
          <Running />
          <LastChat />
          <Today />
          <QuotaCard compact />
          <WeekTeaser />
        </>
      ) : (
        <Empty icon="sparkle" title="Start your first chat">
          Orbit shows every Claude Code chat here, with your usage and setup, as soon as you start
          one.
        </Empty>
      )}
    </section>
  );
}
