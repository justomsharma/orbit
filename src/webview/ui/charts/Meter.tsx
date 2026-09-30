import { Icon } from "../Icon";
import { formatResetIn, meterLevel } from "./format";

interface Props {
  label: string;
  /** 0–100 (may exceed 100 on spend limits). */
  pct: number;
  resetsAt: number;
  now: number;
}

const WORDS = { ok: null, warn: "Getting close", critical: "Limit reached soon" } as const;

/** A plan-limit bar. Severity is carried by colour and by words, never colour alone. */
export function Meter({ label, pct, resetsAt, now }: Props) {
  const level = meterLevel(pct);
  const shown = Math.round(pct);
  const note = pct >= 100 ? "Limit reached" : WORDS[level];
  return (
    <div class={`meter ${level}`}>
      <div class="meter-head">
        <span class="meter-label">{label}</span>
        <span class="meter-value">{shown}%</span>
      </div>
      {/* Native meter for assistive tech; the styled bar below is visual only. */}
      <meter
        class="sr-only"
        aria-label={label}
        min={0}
        max={100}
        value={Math.min(100, Math.max(0, pct))}
        aria-valuenow={shown}
        aria-valuetext={`${shown}% used. ${formatResetIn(resetsAt, now)}`}
      />
      <div class="meter-track" aria-hidden="true">
        <div class="meter-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div class="meter-foot">
        {note ? (
          <span class="meter-note">
            <Icon name={level === "critical" ? "error" : "warning"} />
            {note}
          </span>
        ) : null}
        <span class="meter-reset">{formatResetIn(resetsAt, now)}</span>
      </div>
    </div>
  );
}
