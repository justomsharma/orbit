import { useState } from "preact/hooks";
import { heatBucket } from "./format";

export interface Cell {
  day: string;
  label: string;
  value: number;
  display: string;
}

interface Props {
  title: string;
  /** Oldest first; a multiple of 7 so each column is one week. */
  cells: Cell[];
}

const SIZE = 10;
const GAP = 2;

/** GitHub-style activity grid: one hue, five light→dark steps, a tooltip per day. */
export function Heatmap({ title, cells }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const values = cells.map((c) => c.value);
  const weeks = Math.ceil(cells.length / 7);
  const width = weeks * (SIZE + GAP) - GAP;
  const height = 7 * (SIZE + GAP) - GAP;
  const active = values.filter((v) => v > 0).length;
  const tip = hover !== null ? cells[hover] : undefined;

  return (
    <figure class="chart heatmap">
      <div class="heatmap-plot">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${title}: active on ${active} of ${cells.length} days`}
          class="heatmap-svg"
        >
          {cells.map((c, i) => (
            <rect
              key={c.day}
              data-cell
              data-step={String(heatBucket(c.value, values))}
              class={`heat-cell step-${heatBucket(c.value, values)}${hover === i ? " hover" : ""}`}
              x={Math.floor(i / 7) * (SIZE + GAP)}
              y={(i % 7) * (SIZE + GAP)}
              width={SIZE}
              height={SIZE}
              rx={2}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {tip ? (
          <div role="tooltip" class="chart-tip static">
            {tip.label} · {tip.display}
          </div>
        ) : null}
      </div>
      <ul class="sr-only" aria-label={`${title}: active days`}>
        {cells
          .filter((c) => c.value > 0)
          .map((c) => (
            <li key={c.day}>
              {c.label}: {c.display}
            </li>
          ))}
      </ul>
      <div class="heat-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((s) => (
          <span key={s} class={`heat-swatch step-${s}`} />
        ))}
        <span>More</span>
      </div>
    </figure>
  );
}
