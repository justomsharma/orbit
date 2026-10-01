import { STEPS, type Step } from "../../shared/onboarding";
import { post } from "../bus";
import * as store from "../store";
import { Icon } from "../ui/Icon";

const COPY: Record<Step, { title: string; hint: string }> = {
  continue: {
    title: "Pick up a chat",
    hint: "Continue any chat right where Claude stopped.",
  },
  find: {
    title: "Find an old chat",
    hint: "Search titles, or tick “In messages” to search everything said.",
  },
  details: {
    title: "See what Claude changed",
    hint: "Open a chat's files to compare or restore any version.",
  },
  setup: {
    title: "Check your setup",
    hint: "A health check spots broken settings and missing tools.",
  },
  limits: {
    title: "Turn on plan limits",
    hint: "Watch your 5-hour and weekly limits fill up.",
  },
};

/** Where "Show me" takes you for each step. */
function showMe(step: Step): void {
  store.details.value = null;
  if (step === "continue") {
    const btn = document.querySelector<HTMLButtonElement>(".continue-card .btn");
    if (btn) {
      btn.focus();
      return;
    }
  }
  if (step === "setup") store.tab.value = "setup";
  else if (step === "limits") store.tab.value = "usage";
  else {
    store.chatsMode.value = "chats";
    store.focusSearch.value = step === "find";
    store.tab.value = "chats";
  }
}

/** A short, self-ticking list of the things worth trying first. Hidden for good once dismissed. */
export function GettingStarted() {
  const o = store.onboarding.value;
  if (o.dismissed) return null;
  const done = new Set(o.done);
  const all = STEPS.every((s) => done.has(s));
  return (
    <section class="guide" aria-labelledby="guide-title">
      <div class="guide-head">
        <h2 id="guide-title" class="section-title">
          Get started
        </h2>
        <span class="guide-count">{all ? "Done" : `${done.size} of ${STEPS.length}`}</span>
        <button
          type="button"
          class="link-btn"
          onClick={() => post({ type: "onboarding", action: "dismiss" })}
        >
          Hide
        </button>
      </div>
      <div
        class="guide-bar"
        role="progressbar"
        aria-label="Get started progress"
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={done.size}
      >
        <span style={{ width: `${(done.size / STEPS.length) * 100}%` }} />
      </div>
      {all ? (
        <p class="guide-done">You're all set. Orbit will keep everything here up to date.</p>
      ) : (
        <ul class="guide-steps">
          {STEPS.map((s) => {
            const ok = done.has(s);
            return (
              <li
                key={s}
                class={`guide-step${ok ? " ok" : ""}`}
                aria-label={ok ? `${COPY[s].title}, done` : COPY[s].title}
              >
                <Icon name={ok ? "pass-filled" : "circle-large-outline"} />
                <div class="guide-text">
                  <span class="guide-title">{COPY[s].title}</span>
                  {ok ? null : <span class="guide-hint">{COPY[s].hint}</span>}
                </div>
                {ok ? null : (
                  <button
                    type="button"
                    class="link-btn"
                    aria-label={`Show me: ${COPY[s].title}`}
                    onClick={() => showMe(s)}
                  >
                    Show me
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
