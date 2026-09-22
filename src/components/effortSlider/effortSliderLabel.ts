/**
 * The rolling value label: on a level change the old word lifts away with a
 * blur while the new one rises in (230ms, reference timing). Owns the slot's
 * children and their Web Animations so the element never tracks them.
 */

export function cancelValueLabelAnimations(slot: HTMLElement): void {
  for (const node of Array.from(slot.children)) {
    for (const animation of node.getAnimations()) animation.cancel();
  }
}

export function rollValueLabel(
  slot: HTMLElement,
  label: string,
  { ultra, animate, direction = 1 }: { ultra: boolean; animate: boolean; direction?: 1 | -1 },
): void {
  cancelValueLabelAnimations(slot);
  const previous = slot.lastElementChild as HTMLElement | null;
  slot.replaceChildren();
  const next = document.createElement('span');
  next.className = `value-layer${ultra ? ' ultra' : ''}`;
  next.textContent = label;
  if (!animate || !previous) {
    slot.append(next);
    return;
  }
  slot.append(previous, next);
  const options: KeyframeAnimationOptions = {
    duration: 230,
    easing: 'cubic-bezier(.22, 1, .36, 1)',
    fill: 'both',
  };
  const outgoing = previous.animate(
    [
      { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
      {
        opacity: 0,
        transform: `translateY(${String(-direction * 0.48)}em)`,
        filter: 'blur(.1em)',
      },
    ],
    options,
  );
  outgoing.onfinish = () => {
    previous.remove();
  };
  const incoming = next.animate(
    [
      { opacity: 0, transform: `translateY(${String(direction * 0.48)}em)`, filter: 'blur(.1em)' },
      { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
    ],
    options,
  );
  incoming.onfinish = () => {
    incoming.cancel();
  };
}
