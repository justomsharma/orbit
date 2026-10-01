import { modelLabel } from "../../core/pricing";
import * as store from "../store";
import { Icon } from "../ui/Icon";
import { dayKey, favourite, glance } from "./glance";

/** Streak, active days and favourite model in one line, with a way to the full Usage tab. */
export function UsageGlance({ link = true }: { link?: boolean }) {
  const u = store.usage.value;
  if (!u || u.all.messages === 0) return null;
  const g = glance(u.all.daily, dayKey(store.now.value));
  const fav = favourite(u.month.byModel);
  return (
    <section class={`glance${link ? " card" : ""}`} aria-label="Your usage at a glance">
      {link ? <h3 class="section-title">Your usage</h3> : null}
      <ul class="glance-list">
        <li title={`Best: ${g.best} day${g.best === 1 ? "" : "s"} in a row`}>
          <Icon name="flame" />
          <span>
            <b>{g.streak}</b>-day streak
          </span>
        </li>
        <li>
          <Icon name="calendar" />
          <span>
            <b>{g.active}</b> of {g.of} days active
          </span>
        </li>
        {fav ? (
          <li>
            <Icon name="star-full" />
            <span>
              Mostly <b>{modelLabel(fav.model)}</b>
            </span>
          </li>
        ) : null}
        <li>
          <Icon name="milestone" />
          <span>
            Best streak <b>{g.best}</b> days
          </span>
        </li>
      </ul>
      {link ? (
        <button type="button" class="link-btn" onClick={() => (store.tab.value = "usage")}>
          See all usage
        </button>
      ) : null}
    </section>
  );
}
