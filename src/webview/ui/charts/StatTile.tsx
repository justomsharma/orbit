interface Props {
  label: string;
  value: string;
  /** Optional change vs a named period. `up` only sets the arrow; it isn't judged good or bad. */
  delta?: { text: string; up: boolean } | null;
  hint?: string;
}

export function StatTile({ label, value, delta, hint }: Props) {
  return (
    <div class="stat" title={hint}>
      <span class="stat-label">{label}</span>
      <span class="stat-value">{value}</span>
      {delta ? (
        <span class="stat-delta">
          <span aria-hidden="true">{delta.up ? "↑ " : "↓ "}</span>
          {delta.text}
        </span>
      ) : null}
    </div>
  );
}
