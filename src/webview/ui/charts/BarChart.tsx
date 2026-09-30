import { useState } from "preact/hooks";

export interface Bar {
  key: string;
  label: string;
  value: number;
  /** Formatted value for the tooltip and table, e.g. "$3.20". */
  display: string;
}

interface Props {
  title: string;
  data: Bar[];
  height?: number;
  /** Formats the top gridline value. */
  axis?: (v: number) => string;
}

const GAP = 2;
const MAX_BAR = 24;
const RADIUS = 4;

/** Clean ceiling for the axis: 1, 2, 2.5, 5 × 10^n. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** A column with a 4 px rounded top and a square base, as an SVG path. */
function column(x: number, w: number, top: number, base: number): string {
  const h = base - top;
  if (h <= 0) return "";
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
}

/** Single-series column chart (one hue, no legend) with per-bar tooltips and a table fallback. */
export function BarChart({ title, data, height = 96, axis = String }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const n = Math.max(1, data.length);
  const slot = 10;
  const width = n * slot;
  const bw = Math.min(MAX_BAR, slot - GAP);
  const top = 8;
  const base = height - 2;
  const empty = data.every((d) => d.value <= 0);
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? 0) ? i : best), 0);

  const summary = empty
    ? `${title}: no usage in this period`
    : `${title}: highest ${data[peak]!.display} on ${data[peak]!.label}`;

  return (
    <figure class="chart card">
      <figcaption class="section-title">{title}</figcaption>
      <div class="chart-plot" style={{ height: `${height}px` }}>
        {empty ? (
          <div class="chart-empty">No usage in this period</div>
        ) : (
          <>
            <span class="chart-axis-label">{axis(max)}</span>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={summary}
              class="chart-svg"
            >
              <line class="chart-grid" x1="0" x2={width} y1={top} y2={top} />
              <line class="chart-base" x1="0" x2={width} y1={base} y2={base} />
              {data.map((d, i) => {
                const x = i * slot + (slot - bw) / 2;
                const y = base - (d.value / max) * (base - top);
                return (
                  <g key={d.key}>
                    <path
                      data-bar
                      class={`chart-bar${hover === i ? " hover" : ""}`}
                      d={column(x, bw, y, base)}
                    />
                    <rect
                      data-hit
                      class="chart-hit"
                      x={i * slot}
                      y={0}
                      width={slot}
                      height={height}
                      onMouseEnter={() => setHover(i)}
                      onMouseLeave={() => setHover(null)}
                    />
                  </g>
                );
              })}
            </svg>
            {hover !== null && data[hover] ? (
              <div
                role="tooltip"
                class="chart-tip"
                style={{ left: `${((hover + 0.5) / n) * 100}%` }}
              >
                <strong>{data[hover].display}</strong>
                <span>{data[hover].label}</span>
              </div>
            ) : null}
          </>
        )}
      </div>
      {empty || data.length < 2 ? null : (
        <div class="chart-x" aria-hidden="true">
          <span>{data[0]!.label}</span>
          <span>{data[data.length - 1]!.label}</span>
        </div>
      )}
      <table class="sr-only" aria-label={title}>
        <thead>
          <tr>
            <th>Day</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <td>{d.label}</td>
              <td>{d.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
