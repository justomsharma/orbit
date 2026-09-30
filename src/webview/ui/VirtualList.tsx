import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

interface Props<T> {
  items: T[];
  itemKey: (item: T) => string;
  height: (item: T) => number;
  render: (item: T, index: number) => ComponentChildren;
  /** Index to keep scrolled into view (keyboard navigation). */
  activeIndex?: number;
  overscan?: number;
  label?: string;
  id?: string;
}

const FALLBACK_VIEWPORT = 600;

/** Renders only the rows in view, so 10 000 chats scroll as smoothly as 10. */
export function VirtualList<T>({
  items,
  itemKey,
  height,
  render,
  activeIndex,
  overscan = 6,
  label,
  id,
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(FALLBACK_VIEWPORT);

  const offsets = useMemo(() => {
    const o = new Array<number>(items.length + 1);
    o[0] = 0;
    for (let i = 0; i < items.length; i++) o[i + 1] = o[i]! + height(items[i]!);
    return o;
  }, [items, height]);
  const total = offsets[items.length] ?? 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight || FALLBACK_VIEWPORT));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || activeIndex === undefined || activeIndex < 0 || activeIndex >= items.length) return;
    const top = offsets[activeIndex]!;
    const bottom = offsets[activeIndex + 1]!;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [activeIndex, offsets, items.length]);

  // Binary search for the first row that ends below the top edge.
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1]! <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  const start = Math.max(0, lo - overscan);
  let end = lo;
  while (end < items.length && offsets[end]! < scrollTop + viewport) end++;
  end = Math.min(items.length, end + overscan);

  const rows = [];
  for (let i = start; i < end; i++) {
    const it = items[i]!;
    rows.push(
      <div
        key={itemKey(it)}
        class="vrow"
        style={{ top: `${offsets[i]}px`, height: `${height(it)}px` }}
      >
        {render(it, i)}
      </div>,
    );
  }

  return (
    <div
      ref={ref}
      id={id}
      class="vlist"
      role="listbox"
      aria-label={label}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}
    >
      <div class="vspacer" style={{ height: `${total}px` }}>
        {rows}
      </div>
    </div>
  );
}
