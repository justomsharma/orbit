import type { Issue } from "../../features/setup/health";
import { post } from "../bus";
import * as store from "../store";
import { Icon } from "../ui/Icon";
import { matches, Section } from "./parts";

const ICON = { error: "error", warning: "warning", info: "lightbulb" } as const;

function IssueRow({ i }: { i: Issue }) {
  return (
    <li class={`issue ${i.severity}`}>
      <Icon name={ICON[i.severity]} />
      <div class="issue-main">
        <span class="issue-title">{i.title}</span>
        <span class="issue-detail">{i.detail}</span>
        <div class="issue-actions">
          {i.fix?.kind === "approveMcp" ? (
            <button
              type="button"
              class="btn small"
              onClick={() =>
                post({ type: "setup:mcpApproval", name: i.fix!.name, state: "approved" })
              }
            >
              Approve
            </button>
          ) : null}
          {i.claudePrompt ? (
            <button
              type="button"
              class="btn small secondary"
              onClick={() => post({ type: "setup:fixWithClaude", issueId: i.id })}
            >
              <Icon name="sparkle" /> Fix with Claude
            </button>
          ) : null}
          {i.file ? (
            <button
              type="button"
              class="link-btn"
              onClick={() => post({ type: "setup:open", file: i.file! })}
            >
              Open file
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function HealthSection() {
  const s = store.setup.value!;
  const q = store.setupQuery.value;
  const issues = s.issues.filter((i) => matches(q, i.title, i.detail, i.area));
  const serious = s.issues.filter((i) => i.severity !== "info").length;
  return (
    <Section
      id="health"
      title="Health"
      icon="pulse"
      count={s.issues.length}
      note={serious ? `${serious} need attention` : undefined}
      hidden={q.trim() !== "" && issues.length === 0}
    >
      {s.issues.length === 0 ? (
        <p class="health-ok">
          <Icon name="pass-filled" /> Everything looks good. Claude can use your whole setup.
        </p>
      ) : (
        <ul class="issues">
          {issues.map((i) => (
            <IssueRow key={i.id} i={i} />
          ))}
        </ul>
      )}
    </Section>
  );
}
