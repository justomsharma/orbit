import { useState } from "preact/hooks";
import { FIVE_HOURS, pace, paceText, WEEK } from "../../features/usage/pace";
import type { CacheInfo, QuotaFile, Window } from "../../tap/statusline";
import { post } from "../bus";
import * as store from "../store";
import { formatResetIn, formatTokens } from "../ui/charts/format";
import { Icon, IconButton } from "../ui/Icon";
import { quotaFreshness } from "./model";

/** Numbers older than this are "idle": Claude hasn't replied since. */
const LIVE_FOR = 10 * 60_000;

/** An (i) that explains on hover, and shows the explanation when clicked or tapped. */
function Why({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        class="qbar-info"
        aria-label={text}
        aria-expanded={open}
        title={text}
        onClick={() => setOpen(!open)}
      >
        <Icon name="info" />
      </button>
      {open ? <span class="qbar-why">{text}</span> : null}
    </>
  );
}

const tone = (pct: number) => (pct >= 80 ? "high" : pct >= 50 ? "mid" : "low");

function WindowRow({
  label,
  span,
  w,
  capturedAt,
  now,
}: {
  label: string;
  span: "week" | "5 hours";
  w: Window;
  capturedAt: number;
  now: number;
}) {
  const reset = w.resetsAt <= now;
  const pct = Math.min(100, Math.max(0, w.pct));
  const p = reset ? null : pace(w, capturedAt, span === "week" ? WEEK : FIVE_HOURS);
  const t = p ? paceText(p, span, now) : null;
  const ghost = p ? Math.min(100, Math.max(0, p.projected)) : 0;
  const shown = Math.round(w.pct);
  return (
    <div class={`qbar ${reset ? "reset" : tone(w.pct)}${p?.verdict === "ahead" ? " ahead" : ""}`}>
      <div class="qbar-head">
        <span class="qbar-label">{label}</span>
        <span class="qbar-value">{reset ? "reset" : `${shown}%`}</span>
      </div>
      <meter
        class="sr-only"
        aria-label={label}
        min={0}
        max={100}
        value={reset ? 0 : pct}
        aria-valuenow={reset ? 0 : shown}
        aria-valuetext={
          reset ? `${label} reset` : `${shown}% used. ${formatResetIn(w.resetsAt, now)}`
        }
      />
      <div class="qbar-track" aria-hidden="true">
        {ghost ? <div class="qbar-ghost" style={{ width: `${ghost}%` }} /> : null}
        {reset ? null : <div class="qbar-fill" style={{ width: `${pct}%` }} />}
      </div>
      <div class="qbar-sub">
        <span>{reset ? "outdated · open Claude to refresh" : formatResetIn(w.resetsAt, now)}</span>
        {t?.outIn ? <span class="qbar-out">{t.outIn}</span> : null}
      </div>
      {t ? (
        <p class="qbar-verdict">
          {t.sentence}
          <Why text={t.detail} />
        </p>
      ) : null}
    </div>
  );
}

const CAUSE: Record<string, string> = {
  system_prompt_changed: "the system prompt changed",
  tools_changed: "the tool set changed",
  model_changed: "the model changed",
  messages_rewritten: "earlier messages were rewritten",
  ttl_expired_5m: "the 5m cache expired",
  ttl_expired_1h: "the 1h cache expired",
  likely_server_side: "a server-side eviction",
  unknown: "an undiagnosed change",
};

/** "a, b and c" */
const and = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

export function missCause(c: CacheInfo): string | null {
  if (!c.lastMiss.length) return null;
  return and(
    c.lastMiss.map((k) => {
      const base = CAUSE[k] ?? k.replace(/_/g, " ");
      return k === "tools_changed" && (c.toolsAdded || c.toolsRemoved)
        ? `${base} (+${c.toolsAdded} / -${c.toolsRemoved} tools)`
        : base;
    }),
  );
}

function CacheRow({ c }: { c: CacheInfo }) {
  if (!c.requests || c.hitRatio === null || c.hitRatio >= 0.95) return null;
  const parts = [
    `${c.requests} request${c.requests === 1 ? "" : "s"}`,
    c.misses ? `${c.misses} missed` : null,
    c.rebuilds ? `${c.rebuilds} rebuilt` : null,
    c.recached ? `${formatTokens(c.recached)} tokens re-cached` : null,
  ].filter(Boolean);
  const cause = missCause(c);
  const why = `How much of each request Claude read from its prompt cache instead of sending it again. Higher is cheaper; a miss re-sends the whole cached start of the chat, and those tokens count towards your limits.${cause ? ` Last miss: ${cause}.` : ""}`;
  return (
    <div class="qcache">
      <div class="qcache-head">
        <span>Prompt cache{c.ttl ? ` (${c.ttl})` : ""}</span>
        <span class="qcache-hit">{Math.round(c.hitRatio * 100)}% hit</span>
        <Why text={why} />
      </div>
      <p class="qcache-detail">{parts.join(" · ")}</p>
    </div>
  );
}

function Facts({ q }: { q: QuotaFile }) {
  const { repo, worktree, pr } = q;
  if (!repo && !worktree && !pr) return null;
  return (
    <dl class="qfacts">
      {repo ? (
        <>
          <dt>Repo</dt>
          <dd>
            {repo.host && repo.host !== "github.com" ? `${repo.host}/` : ""}
            {`${repo.owner}/${repo.name}`}
          </dd>
        </>
      ) : null}
      {worktree ? (
        <>
          <dt>Worktree</dt>
          <dd title={worktree.path ?? undefined}>
            <span class="tag">
              <Icon name="git-branch" /> {worktree.name}
              {worktree.branch ? <span class="tag-dim"> · {worktree.branch}</span> : null}
            </span>
            {worktree.originalBranch ? ` was on ${worktree.originalBranch}` : null}
          </dd>
        </>
      ) : null}
      {pr ? (
        <>
          <dt>{pr.kind === "mr" ? "Merge request" : "Pull request"}</dt>
          <dd>
            {pr.url ? (
              <button
                type="button"
                class="link-btn"
                aria-label={`${pr.kind === "mr" ? "Merge request !" : "Pull request #"}${pr.number}`}
                onClick={() => post({ type: "openLink", url: pr.url! })}
              >
                {pr.kind === "mr" ? "!" : "#"}
                {pr.number}
              </button>
            ) : (
              `${pr.kind === "mr" ? "!" : "#"}${pr.number}`
            )}
            {pr.review ? (
              <span
                class={`badge ${pr.review === "approved" ? "ok" : pr.review === "changes_requested" ? "error" : ""}`}
              >
                {pr.review.replace(/_/g, " ")}
              </span>
            ) : null}
          </dd>
        </>
      ) : null}
    </dl>
  );
}

/** 5-hour and weekly plan limits: an opt-in explanation, a waiting state, or the bars. */
export function QuotaCard({ compact = false }: { compact?: boolean }) {
  const u = store.usage.value;
  const [spin, setSpin] = useState(false);
  if (!u) return null;
  const { enabled, data } = u.quota;
  const now = store.now.value;

  if (!enabled) {
    return (
      <section class="card quota-card">
        <h3 class="section-title">Plan limits</h3>
        <p class="card-text">
          See how much of your 5-hour and weekly Claude limits you've used, whether they'll last,
          and when they reset. Read on your computer from Claude Code, no network.
        </p>
        {compact ? null : (
          <p class="card-hint">
            Orbit adds a tiny helper to Claude Code's statusline. Your own statusline keeps working,
            and turning it off puts your previous statusline back.
          </p>
        )}
        <button type="button" class="btn" onClick={() => post({ type: "quota", on: true })}>
          Show my plan limits
        </button>
      </section>
    );
  }

  const acct = store.account.value;
  if (data && acct?.switchedAt && data.updatedAt < acct.switchedAt) {
    const seen = acct.saved.find((a) => a.id === acct.profile?.id)?.lastSeen;
    return (
      <section class="card quota-card">
        <h3 class="section-title">Plan limits</h3>
        <p class="card-text">
          <b>{seen ? `Last seen ${seen}` : "Switched account"}</b>
        </p>
        <p class="card-hint">Open Claude Code with this account to load its limits.</p>
        <button type="button" class="btn secondary small" onClick={() => post({ type: "refresh" })}>
          Refresh
        </button>
      </section>
    );
  }
  const live = data ? now - data.updatedAt < LIVE_FOR : false;
  const age = data ? quotaFreshness(data.updatedAt, now) : "";
  const near = [data?.fiveHour, data?.sevenDay].some((w) => w && w.resetsAt > now && w.pct >= 90);
  const reread = () => {
    setSpin(true);
    setTimeout(() => setSpin(false), 500);
    post({ type: "refresh" });
  };

  return (
    <section class="card quota-card">
      <div class="card-head">
        <h3 class="section-title">Plan limits</h3>
        {data ? (
          <span class="quota-fresh" aria-live="polite">
            {age}
            <span
              class={`quota-dot${live ? " live" : ""}`}
              role="img"
              aria-label={
                live
                  ? `Live · last reply ${age.replace(/^Updated /, "")}`
                  : `Idle · last reply ${age.replace(/^Updated /, "")}. Updates when Claude replies.`
              }
              title={live ? "Live: Claude replied recently" : "Idle: updates when Claude replies"}
            />
            <span class={spin ? "spin" : undefined}>
              <IconButton icon="refresh" label="Re-read latest" onClick={reread} />
            </span>
          </span>
        ) : null}
      </div>
      {data && (data.fiveHour || data.sevenDay) ? (
        <>
          {data.fiveHour ? (
            <WindowRow
              label="5-hour limit"
              span="5 hours"
              w={data.fiveHour}
              capturedAt={data.updatedAt}
              now={now}
            />
          ) : null}
          {data.sevenDay ? (
            <WindowRow
              label="Weekly limit"
              span="week"
              w={data.sevenDay}
              capturedAt={data.updatedAt}
              now={now}
            />
          ) : null}
          {near ? (
            <div class="qreset">
              <span class="qreset-label">Limit reset</span>
              <button
                type="button"
                class="btn secondary small"
                aria-label="Open claude.ai usage settings"
                onClick={() => post({ type: "openOrbitLink", link: "claudeUsage" })}
              >
                claude.ai usage <Icon name="link-external" />
              </button>
              <p class="qreset-note">
                Your plan may offer a free reset there. Claude Code can't apply one.
              </p>
            </div>
          ) : null}
          {data.cache ? <CacheRow c={data.cache} /> : null}
          {compact ? null : <Facts q={data} />}
        </>
      ) : (
        <p class="card-text">
          <Icon name="info" /> Limits appear after your next message in a terminal session of Claude
          Code (they come from Claude's statusline, on Pro and Max plans).
        </p>
      )}
      {u.quota.shadowed ? (
        <p class="card-hint">
          This project sets its own statusline, so limits only update from chats in other folders.
        </p>
      ) : null}
      {compact ? null : (
        <button type="button" class="link-btn" onClick={() => post({ type: "quota", on: false })}>
          Turn off plan limits
        </button>
      )}
    </section>
  );
}
