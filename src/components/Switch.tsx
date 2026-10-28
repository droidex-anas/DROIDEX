interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

// The track carries the state by fill alone (accent when on), with no
// outline; keyboard focus gets the global focus ring.
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
      className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-active'}`}
    >
      <span
        className={`size-5 rounded-full shadow-sm transition duration-200 ease-smooth-out ${checked ? 'translate-x-4 bg-bg' : 'translate-x-0 bg-secondary'}`}
      />
    </button>
  );
}
