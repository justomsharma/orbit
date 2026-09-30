import type { ComponentChildren } from "preact";
import { Icon } from "./Icon";

interface Props {
  icon: string;
  title: string;
  children?: ComponentChildren;
  action?: { label: string; onClick: () => void };
}

/** A calm, centred message that tells people what to do next. */
export function Empty({ icon, title, children, action }: Props) {
  return (
    <div class="empty" role="status">
      <div class="empty-icon">
        <Icon name={icon} />
      </div>
      <p class="empty-title">{title}</p>
      {children ? <p class="empty-text">{children}</p> : null}
      {action ? (
        <button type="button" class="btn secondary" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
