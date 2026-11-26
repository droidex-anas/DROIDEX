// One IntersectionObserver for the whole app. Elements registered through the
// ref callback carry `data-pause-animations` while no pixel of them intersects
// the viewport — scrolled past the edge of their scroll container, clipped
// away, or unlaid-out — and the rule beside the hidden-window pause in
// index.css freezes every CSS animation in their subtree. `isIntersecting` is
// true for even a sliver of visible area, so a half-visible element never
// freezes, and a resumed infinite animation reads exactly as if it had never
// paused. The observer owns the attribute on the elements it observes; React
// never renders it there, and covered or visibility-hidden subtrees (which
// geometric intersection cannot see) are marked by their owners instead.

const PAUSE_ATTRIBUTE = 'data-pause-animations';

let shared: IntersectionObserver | null = null;

function sharedObserver(): IntersectionObserver {
  shared ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) entry.target.removeAttribute(PAUSE_ATTRIBUTE);
      else entry.target.setAttribute(PAUSE_ATTRIBUTE, '');
    }
  });
  return shared;
}

// A ref callback: observe the element for as long as it is mounted. With no
// threshold or margin the observer reports any visible pixel as intersecting,
// which is the safe direction — worst case a covered sliver keeps animating.
export function pauseAnimationsWhenOffscreen(
  element: HTMLElement | null,
): (() => void) | undefined {
  if (element === null) return undefined;
  const observer = sharedObserver();
  observer.observe(element);
  return () => {
    observer.unobserve(element);
  };
}
