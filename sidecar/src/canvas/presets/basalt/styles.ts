// Basalt's own rules on top of the shared sheet: compact controls, keycaps,
// and the code, log, syntax and status classes its consoles are made of.
export const BASALT_CSS = `.ds-button {
  padding: var(--ds-space-1) var(--ds-space-3);
  font-size: var(--ds-text-base);
}
.ds-card {
  border-radius: var(--ds-radius-xl);
}
.ds-badge {
  border-radius: var(--ds-radius-sm);
  padding: var(--ds-space-0-5) var(--ds-space-1-5);
  font-size: var(--ds-text-2xs);
  font-weight: var(--ds-weight-semibold);
  letter-spacing: 0.02em;
}
.ds-tab {
  min-height: var(--ds-control-sm);
  padding: var(--ds-space-1) var(--ds-space-2-5);
  font-size: var(--ds-text-sm);
}
.ds-dialog {
  border-radius: var(--ds-radius-2xl);
}
.ds-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 var(--ds-space-1);
  border-radius: var(--ds-radius-sm);
  background: var(--ds-elevated);
  box-shadow: inset 0 -1px var(--ds-border-strong);
  font-size: var(--ds-text-2xs);
  font-weight: var(--ds-weight-medium);
  color: var(--ds-fg-muted);
}
.ds-codeblock {
  margin: 0;
  padding: var(--ds-space-3) var(--ds-space-4);
  border-radius: var(--ds-radius-lg);
  background: var(--ds-surface);
  font-family: var(--ds-font-mono);
  font-size: var(--ds-text-code);
  line-height: var(--ds-leading-relaxed);
  white-space: pre;
  overflow-x: auto;
}
.ds-log {
  display: grid;
  grid-template-columns: max-content 5ch 1fr;
  column-gap: var(--ds-space-3);
  font-family: var(--ds-font-mono);
  font-size: var(--ds-text-code);
  line-height: var(--ds-leading-relaxed);
}
.ds-log > * {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ds-syntax-keyword {
  color: var(--ds-syntax-keyword);
}
.ds-syntax-string {
  color: var(--ds-syntax-string);
}
.ds-syntax-number {
  color: var(--ds-syntax-number);
}
.ds-syntax-function {
  color: var(--ds-syntax-function);
}
.ds-syntax-comment {
  color: var(--ds-syntax-comment);
}
.ds-status {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-space-1-5);
}
.ds-status::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: var(--ds-radius-pill);
  background: currentColor;
}
.ds-status[data-state='running']::before {
  box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 25%, transparent);
}
.ds-row {
  display: flex;
  align-items: center;
  gap: var(--ds-space-3);
  min-height: var(--ds-control-lg);
  padding: var(--ds-space-1-5) var(--ds-space-3);
  border-radius: var(--ds-radius-md);
}
button.ds-row {
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ds-row:hover {
  background: var(--ds-lift);
}
.ds-row[aria-current='true'] {
  background: var(--ds-active);
}
`;
