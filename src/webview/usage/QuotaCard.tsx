import { post } from "../bus";
import * as store from "../store";
import { Meter } from "../ui/charts/Meter";
import { Icon } from "../ui/Icon";
import { quotaFreshness } from "./model";

/** 5-hour and weekly plan limits: an opt-in explanation, a waiting state, or the meters. */
export function QuotaCard({ compact = false }: { compact?: boolean }) {
  const u = store.usage.value;
  if (!u) return null;
  const { enabled, data } = u.quota;
  const now = Date.now();

  if (!enabled) {
    return (
      <section class="card quota-card">
        <h3 class="section-title">Plan limits</h3>
        <p class="card-text">
          See how much of your 5-hour and weekly Claude limits you've used, and when they reset.
        </p>
        {compact ? null : (
          <p class="card-hint">
            Orbit adds a tiny helper to Claude Code's statusline. Your own statusline keeps working,
            and turning it off restores everything exactly.
          </p>
        )}
        <button type="button" class="btn" onClick={() => post({ type: "quota", on: true })}>
          Show my plan limits
        </button>
      </section>
    );
  }

  const windows = [
    data?.fiveHour ? { label: "5-hour limit", w: data.fiveHour } : null,
    data?.sevenDay ? { label: "Weekly limit", w: data.sevenDay } : null,
    data?.spendLimit ? { label: "Spend limit", w: data.spendLimit } : null,
  ].filter((x): x is { label: string; w: { pct: number; resetsAt: number } } => x !== null);

  return (
    <section class="card quota-card">
      <div class="card-head">
        <h3 class="section-title">Plan limits</h3>
        {data ? <span class="card-meta">{quotaFreshness(data.updatedAt, now)}</span> : null}
      </div>
      {windows.length ? (
        windows.map(({ label, w }) => (
          <Meter key={label} label={label} pct={w.pct} resetsAt={w.resetsAt} now={now} />
        ))
      ) : (
        <p class="card-text">
          <Icon name="info" /> Limits appear after your next message in a terminal session of Claude
          Code (they come from Claude's statusline, on Pro and Max plans).
        </p>
      )}
      {compact ? null : (
        <button type="button" class="link-btn" onClick={() => post({ type: "quota", on: false })}>
          Turn off plan limits
        </button>
      )}
    </section>
  );
}
