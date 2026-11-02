// Gridline's own rules on top of the shared sheet: 32px controls, squarer
// badges, and the table, figure and meter classes its data screens are made of.
export const GRIDLINE_CSS = `.ds-button,
.ds-input {
  padding: var(--ds-space-1-5) var(--ds-space-3);
}
.ds-badge {
  border-radius: var(--ds-radius-sm);
  padding: var(--ds-space-0-5) var(--ds-space-2);
  font-weight: var(--ds-weight-semibold);
}
.ds-card {
  border-radius: var(--ds-radius-lg);
}
.ds-dialog {
  border-radius: var(--ds-radius-xl);
}
.ds-tab {
  min-height: var(--ds-control-sm);
  padding: var(--ds-space-1) var(--ds-space-3);
}
.ds-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--ds-text-sm);
  font-variant-numeric: tabular-nums;
}
.ds-table th {
  height: var(--ds-control-md);
  padding: 0 var(--ds-space-3);
  text-align: left;
  font-size: var(--ds-text-2xs);
  font-weight: var(--ds-weight-semibold);
  letter-spacing: var(--ds-tracking-wide);
  text-transform: uppercase;
  color: var(--ds-fg-muted);
  white-space: nowrap;
}
.ds-table td {
  height: var(--ds-control-md);
  padding: 0 var(--ds-space-3);
  white-space: nowrap;
}
.ds-table tbody tr:nth-child(odd) td {
  background: var(--ds-surface);
}
.ds-table tbody tr:hover td {
  background-image: linear-gradient(var(--ds-lift), var(--ds-lift));
}
.ds-table tbody tr[aria-selected='true'] td {
  background: var(--ds-accent-soft);
}
.ds-table td:first-child,
.ds-table th:first-child {
  border-radius: var(--ds-radius-md) 0 0 var(--ds-radius-md);
}
.ds-table td:last-child,
.ds-table th:last-child {
  border-radius: 0 var(--ds-radius-md) var(--ds-radius-md) 0;
}
.ds-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.ds-table th.ds-num {
  text-align: right;
}
.ds-status {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-space-1-5);
  font-weight: var(--ds-weight-medium);
}
.ds-status::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: var(--ds-radius-pill);
  background: currentColor;
}
.ds-meter {
  height: 6px;
  border-radius: var(--ds-radius-pill);
  background: var(--ds-elevated);
  overflow: hidden;
}
.ds-meter > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ds-accent);
}
`;
