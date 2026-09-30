import { post } from "../bus";
import * as store from "../store";
import { formatCost, formatTokens } from "../ui/charts/format";
import { Icon } from "../ui/Icon";
import { recapPng } from "./recapImage";

/** "Your week with Claude Code": a short, shareable summary. */
export function RecapCard() {
  const u = store.usage.value;
  if (!u) return null;
  const r = u.recap;
  const quiet = r.chats === 0;

  const saveImage = () => {
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    const dataUrl = recapPng(r, font, u.week.daily);
    if (dataUrl) post({ type: "saveRecapImage", dataUrl });
  };

  return (
    <section class="card recap-card" id="recap">
      <h3 class="section-title">Your week</h3>
      {quiet ? (
        <p class="card-text">A quiet week: no Claude Code chats in the last 7 days.</p>
      ) : (
        <>
          <div class="recap-stats">
            <div>
              <strong>{r.chats}</strong>
              <span>{r.chats === 1 ? "chat" : "chats"}</span>
            </div>
            <div>
              <strong>{r.prompts}</strong>
              <span>prompts</span>
            </div>
            <div>
              <strong>{formatTokens(r.tokens)}</strong>
              <span>tokens</span>
            </div>
            <div>
              <strong>{r.activeDays}/7</strong>
              <span>active days</span>
            </div>
          </div>
          <ul class="recap-lines">
            {r.topProjects.length ? (
              <li>Most time in {r.topProjects.map((p) => p.name).join(", ")}</li>
            ) : null}
            {r.busiestDay ? <li>Busiest day: {r.busiestDay}</li> : null}
            {r.prs.length ? (
              <li>
                {r.prs.length} pull request{r.prs.length === 1 ? "" : "s"} opened
              </li>
            ) : null}
            {r.cost !== null ? <li>{formatCost(r.cost)} of API value</li> : null}
          </ul>
        </>
      )}
      <div class="card-actions">
        <button type="button" class="btn secondary" onClick={() => post({ type: "copyRecap" })}>
          <Icon name="copy" /> Copy as Markdown
        </button>
        {quiet ? null : (
          <button type="button" class="btn secondary" onClick={saveImage}>
            <Icon name="device-camera" /> Save image
          </button>
        )}
      </div>
    </section>
  );
}
