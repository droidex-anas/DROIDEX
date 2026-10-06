export const KIT_CSS = `html,
body {
  min-height: 100%;
}
body {
  margin: 0;
  background: var(--ds-canvas);
  color: var(--ds-fg);
  font-family: var(--ds-font-sans);
  font-size: var(--ds-text-base);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
h1,
h2 {
  font-family: var(--ds-font-heading);
  line-height: 1.25;
}
h1 {
  font-size: var(--ds-text-xl);
  font-weight: 600;
}
h2 {
  font-size: var(--ds-text-lg);
  font-weight: 600;
}
::selection {
  background: var(--ds-accent-soft);
  color: var(--ds-fg);
}
.ds-button,
.ds-input,
.ds-tab {
  border: 0;
  border-radius: var(--ds-radius-md);
  font: inherit;
  transition:
    background-color var(--ds-duration),
    box-shadow var(--ds-duration);
}
.ds-button,
.ds-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ds-space-2);
  padding: var(--ds-space-2) var(--ds-space-4);
  font-size: var(--ds-text-sm);
  font-weight: 500;
  cursor: pointer;
}
.ds-button-primary {
  background: var(--ds-accent);
  color: var(--ds-accent-fg);
}
.ds-button-primary:hover:not(:disabled) {
  background: var(--ds-accent-strong);
}
.ds-button-secondary {
  background: var(--ds-elevated);
  color: var(--ds-fg);
}
.ds-button-secondary:hover:not(:disabled) {
  background: var(--ds-active);
}
.ds-button-quiet {
  background: transparent;
  color: var(--ds-fg-muted);
}
.ds-button-quiet:hover:not(:disabled) {
  background: var(--ds-elevated);
}
.ds-button:disabled,
.ds-input:disabled,
.ds-tab:disabled {
  cursor: not-allowed;
  color: var(--ds-fg-muted);
  background: var(--ds-elevated);
}
:where(button, input, a, [tabindex]):focus-visible {
  outline: 2px solid transparent;
  outline-offset: 3px;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ds-focus) 55%, transparent);
}
.ds-card {
  border-radius: var(--ds-radius-lg);
  background: var(--ds-raised);
  color: var(--ds-fg);
  box-shadow: var(--ds-shadow-md);
}
.ds-badge {
  display: inline-flex;
  width: fit-content;
  padding: var(--ds-space-1) var(--ds-space-2);
  border-radius: var(--ds-radius-pill);
  font-size: var(--ds-text-xs);
  font-weight: 500;
  background: var(--ds-accent-soft);
  color: var(--ds-fg);
}
.ds-field {
  display: flex;
  flex-direction: column;
  gap: var(--ds-space-2);
}
.ds-field label {
  font-size: var(--ds-text-sm);
  font-weight: 500;
}
.ds-input {
  width: 100%;
  padding: var(--ds-space-2) var(--ds-space-3);
  background: var(--ds-elevated);
  color: var(--ds-fg);
}
.ds-input:hover:not(:disabled) {
  background: var(--ds-active);
}
.ds-input::placeholder {
  color: var(--ds-fg-muted);
  opacity: 1;
}
.ds-input[aria-invalid='true'] {
  box-shadow: inset 0 -2px var(--ds-danger);
}
.ds-hint,
.ds-error {
  margin: 0;
  font-size: var(--ds-text-sm);
}
.ds-hint {
  color: var(--ds-fg-muted);
}
.ds-error {
  color: var(--ds-danger);
}
.ds-tablist {
  display: flex;
  gap: var(--ds-space-1);
  flex-wrap: wrap;
}
.ds-tab {
  color: var(--ds-fg-muted);
  background: transparent;
}
.ds-tab:hover:not(:disabled) {
  background: var(--ds-elevated);
}
.ds-tab[aria-selected='true'] {
  color: var(--ds-fg);
  background: var(--ds-active);
  font-weight: 600;
}
.ds-tabpanel {
  padding-top: var(--ds-space-4);
}
.ds-dialog {
  margin: auto;
  width: min(32rem, calc(100% - 2rem));
  max-height: calc(100% - 2rem);
  overflow: auto;
  border: 0;
  padding: var(--ds-space-6);
  border-radius: var(--ds-radius-lg);
  background: var(--ds-raised);
  color: var(--ds-fg);
  box-shadow: var(--ds-shadow-md);
}
.ds-dialog::backdrop {
  background: var(--ds-backdrop);
}
.ds-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ds-space-4);
  margin-bottom: var(--ds-space-4);
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
  }
}
`;

export const GEOMETRY_TOKENS = {
  '--ds-radius-sm': '6px',
  '--ds-radius-md': '10px',
  '--ds-radius-lg': '18px',
  '--ds-radius-pill': '999px',
  '--ds-space-1': '0.25rem',
  '--ds-space-2': '0.5rem',
  '--ds-space-3': '0.75rem',
  '--ds-space-4': '1rem',
  '--ds-space-6': '1.5rem',
  '--ds-text-xs': '0.75rem',
  '--ds-text-sm': '0.875rem',
  '--ds-text-base': '1rem',
  '--ds-text-lg': '1.25rem',
  '--ds-text-xl': '1.75rem',
  '--ds-font-sans': 'Inter, ui-sans-serif, system-ui, sans-serif',
  '--ds-font-heading': 'Inter, ui-sans-serif, system-ui, sans-serif',
  '--ds-font-mono': 'ui-monospace, monospace',
  '--ds-duration': '140ms',
};
