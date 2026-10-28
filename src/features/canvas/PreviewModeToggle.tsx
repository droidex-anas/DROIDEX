// Light or dark: which of a kit's two token sets the dialog and the picker show.

export type PreviewMode = 'light' | 'dark';

export function PreviewModeToggle({
  mode,
  onChange,
}: {
  mode: PreviewMode;
  onChange: (mode: PreviewMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Preview mode"
      className="ml-auto flex items-center gap-0.5 rounded-lg bg-active/60 p-0.5"
    >
      {(['light', 'dark'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={mode === option}
          onClick={() => {
            onChange(option);
          }}
          className={`cursor-pointer rounded-md px-2 py-0.5 text-caption font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
            mode === option ? 'bg-accent/15 text-primary' : 'text-muted hover:text-primary'
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
