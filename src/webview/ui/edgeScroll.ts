import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

/** How close to an edge (px) the pointer starts scrolling, and the top speed (px per frame). */
export const EDGE_ZONE = 40;
export const MAX_SPEED = 7;

/**
 * The scroll speed for a pointer at `x` within a strip `width` px wide: faster the
 * deeper it is in an edge zone, zero in the middle. Negative scrolls left.
 */
export function edgeVelocity(x: number, width: number): number {
  if (width <= EDGE_ZONE * 2) return 0;
  if (x < EDGE_ZONE) return -MAX_SPEED * (1 - Math.max(x, 0) / EDGE_ZONE);
  const fromRight = width - x;
  if (fromRight < EDGE_ZONE) return MAX_SPEED * (1 - Math.max(fromRight, 0) / EDGE_ZONE);
  return 0;
}

/**
 * Scrolls an overflowing horizontal strip smoothly while the pointer rests near
 * either edge, and turns a vertical mouse wheel into sideways scrolling.
 * Does nothing for people who asked for reduced motion (the wheel still works).
 */
export function useEdgeScroll(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let velocity = 0;
    let frame = 0;
    const step = () => {
      const before = el.scrollLeft;
      el.scrollLeft += velocity;
      frame = velocity !== 0 && el.scrollLeft !== before ? requestAnimationFrame(step) : 0;
    };
    const onMove = (e: PointerEvent) => {
      if (still || el.scrollWidth <= el.clientWidth + 1) return;
      const box = el.getBoundingClientRect();
      velocity = edgeVelocity(e.clientX - box.left, box.width);
      if (velocity !== 0 && !frame) frame = requestAnimationFrame(step);
    };
    const stop = () => {
      velocity = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY, behavior: still ? "auto" : "smooth" });
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", stop);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stop();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", stop);
      el.removeEventListener("wheel", onWheel);
    };
  }, [ref]);
}

/** Scrolls `child` into view inside its strip only — never the page itself. */
export function revealInStrip(strip: HTMLElement, child: HTMLElement, margin = 24): void {
  const left = child.offsetLeft - strip.offsetLeft;
  const right = left + child.offsetWidth;
  const view = strip.scrollLeft;
  const smooth = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
  if (left - margin < view) strip.scrollTo({ left: Math.max(left - margin, 0), behavior });
  else if (right + margin > view + strip.clientWidth)
    strip.scrollTo({ left: right + margin - strip.clientWidth, behavior });
}
