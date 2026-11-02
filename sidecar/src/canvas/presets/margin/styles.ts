// Margin's own rules on top of the shared sheet: grotesk controls with small
// corners, underlined tabs, and the kicker, byline, rule, drop cap, pull quote,
// sidenote and link classes its pages are made of.
export const MARGIN_CSS = `.ds-button {
  border-radius: var(--ds-radius-sm);
  font-weight: var(--ds-weight-medium);
  letter-spacing: 0.01em;
}
.ds-card {
  border-radius: var(--ds-radius-lg);
  box-shadow: var(--ds-shadow-sm);
}
.ds-badge {
  border-radius: var(--ds-radius-xs);
  padding: var(--ds-space-0-5) var(--ds-space-1-5);
  font-size: var(--ds-text-2xs);
  font-weight: var(--ds-weight-semibold);
  letter-spacing: var(--ds-tracking-wide);
  text-transform: uppercase;
}
.ds-tablist {
  gap: var(--ds-space-5);
  box-shadow: inset 0 -1px var(--ds-border);
}
.ds-tab {
  padding: 0;
  border-radius: 0;
  font-size: var(--ds-text-sm);
}
.ds-tab[aria-selected='true'] {
  background: transparent;
  box-shadow: inset 0 -2px var(--ds-fg);
}
.ds-tab:disabled {
  background: transparent;
  color: var(--ds-fg-quiet);
}
.ds-dialog {
  border-radius: var(--ds-radius-xl);
}
.ds-kicker {
  font-family: var(--ds-font-sans);
  font-size: var(--ds-text-2xs);
  line-height: var(--ds-leading-snug);
  font-weight: var(--ds-weight-semibold);
  letter-spacing: var(--ds-tracking-wide);
  text-transform: uppercase;
  color: var(--ds-accent);
}
.ds-dek {
  font-family: var(--ds-font-prose);
  font-size: var(--ds-text-lg);
  font-style: italic;
  line-height: var(--ds-leading-snug);
  color: var(--ds-fg-secondary);
  text-wrap: pretty;
}
.ds-byline {
  font-family: var(--ds-font-sans);
  font-size: var(--ds-text-sm);
  color: var(--ds-fg-muted);
}
.ds-byline strong {
  font-weight: var(--ds-weight-semibold);
  color: var(--ds-fg);
}
.ds-rule {
  border: 0;
  border-top: 1px solid var(--ds-border-strong);
}
.ds-rule-thin {
  border: 0;
  border-top: 1px solid var(--ds-border);
}
.ds-prose p {
  margin: 0;
}
.ds-prose p + p {
  margin-top: var(--ds-space-5);
}
.ds-dropcap::first-letter {
  float: left;
  margin: 0.08em var(--ds-space-2) 0 0;
  font-family: var(--ds-font-heading);
  font-size: 3.6em;
  line-height: 0.8;
  font-weight: var(--ds-weight-heading);
}
.ds-pullquote {
  margin: 0;
  padding-left: var(--ds-space-5);
  border-left: 2px solid var(--ds-accent);
  font-family: var(--ds-font-heading);
  font-size: var(--ds-text-xl);
  font-style: italic;
  line-height: var(--ds-leading-snug);
  text-wrap: balance;
}
.ds-sidenote {
  font-family: var(--ds-font-sans);
  font-size: var(--ds-text-xs);
  line-height: var(--ds-leading-normal);
  color: var(--ds-fg-muted);
}
.ds-noteref {
  border: 0;
  padding: 0 0.15em;
  background: none;
  font-family: var(--ds-font-sans);
  font-size: 0.6em;
  font-weight: var(--ds-weight-semibold);
  vertical-align: super;
  line-height: 0;
  color: var(--ds-accent);
  cursor: pointer;
}
.ds-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--ds-accent);
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
  transition: text-decoration-thickness var(--ds-duration) var(--ds-ease);
}
.ds-link:hover {
  text-decoration-thickness: 2px;
}
`;
