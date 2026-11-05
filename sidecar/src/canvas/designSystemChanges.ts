// Who hears that a kit changed. Kits are global, and both the pane's commands
// and the agent's canvas_theme save them, so their owner announces every
// successful write here and the bridge forwards each one to the renderer.

type DesignSystemChangeListener = (id: string) => void;

const listeners = new Set<DesignSystemChangeListener>();

export function onDesignSystemChange(listener: DesignSystemChangeListener): void {
  listeners.add(listener);
}

/** The write already happened, so a listener that throws costs only its own notice. */
export function announceDesignSystemChange(id: string): void {
  for (const listener of listeners) {
    try {
      listener(id);
    } catch (error) {
      console.error(`A design system ${id} change listener failed:`, error);
    }
  }
}
