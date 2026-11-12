// A value the board's overlays draw from, held outside React. It changes as
// often as the pointer moves, and only the overlays that draw it subscribe,
// so the board around them does not render for it.

export class OverlayStore<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  read = (): T => this.value;

  set(next: T): void {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  }

  /** Calls `listener` whenever the value changes; the call returned stops it. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}
