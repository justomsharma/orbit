/** A decorative VS Code codicon (https://microsoft.github.io/vscode-codicons/). Label the control, not the icon. */
export function Icon({ name }: { name: string }) {
  return <span class={`codicon codicon-${name}`} aria-hidden="true" />;
}

interface IconButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  pressed?: boolean;
}

export function IconButton({ icon, label, onClick, pressed }: IconButtonProps) {
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
      <Icon name={icon} />
    </button>
  );
}
