import { useEffect, useState } from "preact/hooks";
import type { ViewMsg } from "../../shared/protocol";
import { post } from "../bus";

const SLOW = 5_000;
const STUCK = 15_000;

/**
 * "Reading…" that doesn't leave you guessing: after a few seconds it says it's
 * still working and offers Try again; much later it says it may be stuck.
 */
export function Loading({ text, retry }: { text: string; retry?: ViewMsg }) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    const a = setTimeout(() => setStage(1), SLOW);
    const b = setTimeout(() => setStage(2), STUCK);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  return (
    <div class="loading">
      <div role="status">{text}</div>
      {stage > 0 ? (
        <p class="muted loading-slow">
          {stage === 1
            ? "Still reading. Big setups take a moment."
            : "This is taking much longer than usual. Check Orbit's log if it doesn't finish."}
          {retry ? (
            <>
              {" "}
              <button type="button" class="link-btn" onClick={() => post(retry)}>
                Try again
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
