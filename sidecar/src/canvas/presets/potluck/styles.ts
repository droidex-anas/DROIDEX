// Potluck's own rules on top of the shared sheet: pill controls, soft cards,
// and the avatar, chip, tile and toast classes its screens are made of.
export const POTLUCK_CSS = `.ds-button {
  border-radius: var(--ds-radius-pill);
  padding: var(--ds-space-2) var(--ds-space-5);
  font-size: var(--ds-text-base);
  font-weight: var(--ds-weight-semibold);
}
.ds-button-primary {
  box-shadow: var(--ds-shadow-sm);
}
.ds-card {
  border-radius: var(--ds-radius-xl);
}
.ds-badge {
  padding: var(--ds-space-1) var(--ds-space-2-5);
  font-size: var(--ds-text-xs);
  font-weight: var(--ds-weight-semibold);
}
.ds-input {
  border-radius: var(--ds-radius-md);
  padding: var(--ds-space-2-5) var(--ds-space-4);
  font-size: var(--ds-text-base);
}
.ds-field label {
  font-weight: var(--ds-weight-semibold);
}
.ds-tablist {
  width: fit-content;
  padding: var(--ds-space-1);
  border-radius: var(--ds-radius-pill);
  background: var(--ds-elevated);
}
.ds-tab {
  min-height: var(--ds-control-sm);
  padding: var(--ds-space-1) var(--ds-space-4);
  border-radius: var(--ds-radius-pill);
  font-weight: var(--ds-weight-semibold);
}
.ds-tab[aria-selected='true'] {
  background: var(--ds-raised);
  box-shadow: var(--ds-shadow-sm);
}
.ds-dialog {
  border-radius: var(--ds-radius-2xl);
}
.ds-dialog[open] {
  animation: ds-arrive var(--ds-duration-slow) var(--ds-ease-spring);
}
.ds-avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: var(--ds-control-sm);
  height: var(--ds-control-sm);
  border-radius: var(--ds-radius-pill);
  font-size: var(--ds-text-xs);
  font-weight: var(--ds-weight-bold);
  color: var(--ds-fg);
}
.ds-avatars {
  display: flex;
}
.ds-avatars > * + * {
  margin-left: -8px;
}
.ds-avatars > * {
  box-shadow: 0 0 0 2px var(--ds-raised);
}
.ds-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--ds-space-1-5);
  min-height: var(--ds-control-sm);
  padding: 0 var(--ds-space-3);
  border: 0;
  border-radius: var(--ds-radius-pill);
  background: var(--ds-elevated);
  color: var(--ds-fg-secondary);
  font: inherit;
  font-size: var(--ds-text-sm);
  font-weight: var(--ds-weight-semibold);
  cursor: pointer;
  transition: background-color var(--ds-duration) var(--ds-ease);
}
.ds-chip:hover {
  background-image: linear-gradient(var(--ds-lift), var(--ds-lift));
}
.ds-chip[aria-pressed='true'] {
  background: var(--ds-accent-soft);
  color: var(--ds-fg);
}
.ds-tile {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: var(--ds-control-md);
  height: var(--ds-control-md);
  border-radius: var(--ds-radius-md);
  color: var(--ds-fg);
}
.ds-toast {
  display: flex;
  align-items: center;
  gap: var(--ds-space-3);
  padding: var(--ds-space-2-5) var(--ds-space-5) var(--ds-space-2-5) var(--ds-space-2-5);
  border-radius: var(--ds-radius-pill);
  background: var(--ds-fg);
  color: var(--ds-canvas);
  box-shadow: var(--ds-shadow-lg);
  animation: ds-arrive var(--ds-duration-slow) var(--ds-ease-spring);
}
@keyframes ds-arrive {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }
}
`;
