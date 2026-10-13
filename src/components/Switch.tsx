interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({ label, checked, onChange, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 ring-1 ring-inset transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-accent ring-accent' : 'bg-elevated ring-divider-strong'}`}
    >
      <span
        className={`h-5 w-5 rounded-full shadow-[0_1px_2px_0_rgb(0_0_0/0.05)] transition-[transform,background-color] duration-200 ${checked ? 'translate-x-4 bg-bg' : 'translate-x-0 bg-secondary'}`}
      />
    </button>
  );
}
