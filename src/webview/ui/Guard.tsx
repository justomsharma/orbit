import type { ComponentChildren } from "preact";
import { useErrorBoundary } from "preact/hooks";
import { post } from "../bus";
import { Icon } from "./Icon";

/**
 * Keeps one tab's error from blanking the whole view: says what happened, lets
 * you try again, and sends a short note to Orbit's log (no stack, capped).
 */
export function Guard({ name, children }: { name: string; children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    post({ type: "viewError", where: name, message: message.slice(0, 500) });
  });
  if (!error) return <>{children}</>;
  return (
    <div class="guard" role="alert">
      <Icon name="warning" />
      <p class="guard-title">{name} hit a problem.</p>
      <p class="muted">The rest of Orbit still works. Try again, or tell us so we can fix it.</p>
      <div class="q-actions">
        <button type="button" class="btn small" onClick={() => reset()}>
          Try again
        </button>
        <button
          type="button"
          class="btn small secondary"
          onClick={() => post({ type: "orbitCommand", id: "reportProblem" })}
        >
          Report a problem
        </button>
      </div>
    </div>
  );
}
