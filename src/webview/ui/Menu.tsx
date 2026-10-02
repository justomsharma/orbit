import { signal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { Icon } from "./Icon";

export type MenuItem =
  | {
      kind?: "item";
      label: string;
      icon?: string;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    }
  | { kind: "separator" };

interface OpenMenu {
  items: MenuItem[];
  /** Where to open: a point (right-click) or below an element. */
  x: number;
  y: number;
  label: string;
  /** Focus goes back here when the menu closes. */
  returnTo: HTMLElement | null;
}

/** One menu at a time, for the whole view. */
export const openMenu = signal<OpenMenu | null>(null);

/** Opens a menu under a button, or at the pointer for a right-click. */
export function showMenu(
  items: MenuItem[],
  at: { x: number; y: number } | HTMLElement,
  label: string,
): void {
  const el = at instanceof HTMLElement ? at : null;
  const box = el?.getBoundingClientRect();
  openMenu.value = {
    items,
    x: box ? box.left : (at as { x: number }).x,
    y: box ? box.bottom + 2 : (at as { y: number }).y,
    label,
    returnTo: el ?? (document.activeElement as HTMLElement | null),
  };
}

export function closeMenu(): void {
  const m = openMenu.value;
  openMenu.value = null;
  m?.returnTo?.focus?.();
}

/** The open menu, if any. Render once near the app's root. */
export function MenuLayer() {
  const m = openMenu.value;
  const ref = useRef<HTMLDivElement>(null);

  // Keep it on screen: flip up or left when it would overflow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !m) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    el.style.left = `${Math.max(4, Math.min(m.x, vw - r.width - 4))}px`;
    el.style.top = `${m.y + r.height > vh - 4 ? Math.max(4, m.y - r.height - 4) : m.y}px`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [m]);

  useEffect(() => {
    if (!m) return;
    const away = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeMenu();
    };
    const blur = () => closeMenu();
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
    };
  }, [m]);

  if (!m) return null;
  const onKey = (e: KeyboardEvent) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => buttons[(n + buttons.length) % buttons.length]?.focus();
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(buttons.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") closeMenu();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      class="menu"
      role="menu"
      aria-label={m.label}
      ref={ref}
      onKeyDown={onKey}
      style={{ left: m.x, top: m.y }}
    >
      {m.items.map((it, i) =>
        it.kind === "separator" ? (
          <hr key={`sep-${i}`} class="menu-sep" />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            class={`menu-item${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              closeMenu();
              it.run();
            }}
          >
            {it.icon ? <Icon name={it.icon} /> : <span class="menu-pad" />}
            <span>{it.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
