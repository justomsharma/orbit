/** A decorative VS Code codicon (https://microsoft.github.io/vscode-codicons/). Label the control, not the icon. */
export function Icon({ name, spin }: { name: string; spin?: boolean }) {
  return <span class={`codicon codicon-${name}${spin ? " spin" : ""}`} aria-hidden="true" />;
}

interface IconButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  pressed?: boolean;
  /** Turns the icon while something is in progress. */
  spin?: boolean;
}

export function IconButton({ icon, label, onClick, pressed, spin }: IconButtonProps) {
  return (
    <button
      type="button"
      class="icon-btn"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name={icon} spin={spin} />
    </button>
  );
}
