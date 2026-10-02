import { useEffect, useRef, useState } from "preact/hooks";
import type { YearDay } from "../../../features/usage/aggregate";
import { formatTokens, heatBucket } from "./format";

const SIZE = 12;
const GAP = 3;
const TOP = 14;
const LEFT = 22;
const DAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

const date = (day: string) => new Date(`${day}T12:00:00`);
const longDate = (day: string) =>
  date(day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** What a day's square says. */
export function dayTip(d: YearDay): string {
  if (!d.messages && !d.tokens) return `No activity · ${longDate(d.day)}`;
  return `${formatTokens(d.tokens)} tokens · ${d.messages} repl${d.messages === 1 ? "y" : "ies"} · ${d.sessions} chat${d.sessions === 1 ? "" : "s"} · ${longDate(d.day)}`;
}

/**
 * A year of activity, GitHub-style: weeks are columns (Monday first), months are
 * labelled along the top, today is outlined, and it opens scrolled to now.
 */
export function YearMap({ days, today }: { days: YearDay[]; today: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map((d) => d.tokens);
  const weeks = Math.ceil(days.length / 7);
  const width = LEFT + weeks * (SIZE + GAP);
  const height = TOP + 7 * (SIZE + GAP);
  const thisYear = date(today).getFullYear();

  // Start at today's end of the year, also when the sidebar is resized.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const right = () => (el.scrollLeft = el.scrollWidth);
    requestAnimationFrame(right);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(right);
    ro.observe(el);
    return () => ro.disconnect();
  }, [days.length]);

  const months: { x: number; label: string }[] = [];
  let last = -1;
  for (let w = 0; w < weeks; w++) {
    const first = days[w * 7];
    if (!first) continue;
    const m = date(first.day).getMonth();
    if (m !== last) {
      const y = date(first.day).getFullYear();
      const name = date(first.day).toLocaleDateString(undefined, { month: "short" });
      months.push({
        x: LEFT + w * (SIZE + GAP),
        label: y === thisYear ? name : `${name} '${String(y).slice(2)}`,
      });
      last = m;
    }
  }
  const active = days.filter((d) => d.tokens > 0).length;
  const tip = hover !== null ? days[hover] : undefined;

  return (
    <figure class="chart year-map">
      <div class="year-scroll" ref={ref}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Activity over the last year: active on ${active} of ${days.length} days`}
        >
          {months.map((m) => (
            <text key={`${m.x}`} x={m.x} y={10} class="year-month">
              {m.label}
            </text>
          ))}
          {DAYS.map((d, i) =>
            d ? (
              <text key={d} x={0} y={TOP + i * (SIZE + GAP) + SIZE - 2} class="year-day">
                {d}
              </text>
            ) : null,
          )}
          {days.map((d, i) => {
            const step = heatBucket(d.tokens, values);
            return (
              <rect
                key={d.day}
                class={`heat-cell step-${step}${d.day === today ? " today" : ""}${hover === i ? " hover" : ""}`}
                x={LEFT + Math.floor(i / 7) * (SIZE + GAP)}
                y={TOP + (i % 7) * (SIZE + GAP)}
                width={SIZE}
                height={SIZE}
                rx={3}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <title>{dayTip(d)}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <p class="year-tip" aria-live="polite">
        {tip ? dayTip(tip) : `Active on ${active} of the last ${days.length} days`}
      </p>
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
