// The starting points Design offers wherever nothing has been designed yet.
// Each one seeds the composer without sending, so the user keeps typing.

import { SKETCH_INK as INK, SKETCH_MARK as MARK } from '../../components/StarterTile';

export const DESIGN_PLACEHOLDER = 'Describe a screen, a flow, or a component…';

type SketchKind = 'page' | 'component' | 'dashboard' | 'form';

export const DESIGN_STARTERS: readonly {
  label: string;
  hint: string;
  prompt: string;
  sketch: SketchKind;
}[] = [
  {
    label: 'Page',
    hint: 'a settings page with a theme toggle',
    prompt: 'Design a settings page with a theme toggle',
    sketch: 'page',
  },
  {
    label: 'Component',
    hint: 'a pricing card with three tiers',
    prompt: 'Design a pricing card with three tiers',
    sketch: 'component',
  },
  {
    label: 'Dashboard',
    hint: 'usage over time with filters',
    prompt: 'Design a dashboard that shows usage over time, with filters',
    sketch: 'dashboard',
  },
  {
    label: 'Form',
    hint: 'sign-in with inline errors',
    prompt: 'Design a sign-in form with inline errors',
    sketch: 'form',
  },
];

/** A wireframe of what the starter asks for, drawn in the board's quiet tones. */
export function StarterSketch({ kind }: { kind: SketchKind }) {
  switch (kind) {
    case 'page':
      return (
        <span className="flex w-24 flex-col gap-2">
          {['w-16', 'w-10', 'w-12'].map((width, index) => (
            <span key={width} className="flex items-center justify-between">
              <span className={`h-1.5 rounded-full ${width} ${INK}`} />
              {index === 0 ? (
                <span
                  className={`flex h-3 w-5 items-center justify-end rounded-full p-0.5 ${MARK}`}
                >
                  <span className="size-2 rounded-full bg-raised" />
                </span>
              ) : (
                <span className={`h-3 w-5 rounded-full ${INK}`} />
              )}
            </span>
          ))}
        </span>
      );
    case 'component':
      return (
        <span className="flex items-end gap-1.5">
          <span className={`h-10 w-6 rounded-md ${INK}`} />
          <span className={`h-14 w-7 rounded-md ${MARK}`} />
          <span className={`h-10 w-6 rounded-md ${INK}`} />
        </span>
      );
    case 'dashboard':
      return (
        <span className="flex h-12 items-end gap-1">
          {['h-5', 'h-8', 'h-6', 'h-10', 'h-7', 'h-12', 'h-9'].map((height) => (
            <span
              key={height}
              className={`w-2 rounded-xs ${height} ${height === 'h-12' ? MARK : INK}`}
            />
          ))}
        </span>
      );
    case 'form':
      return (
        <span className="flex w-24 flex-col gap-1.5">
          <span className={`h-3 rounded-md ${INK}`} />
          <span className={`h-3 rounded-md ${INK}`} />
          <span className={`mt-1 h-3 rounded-md ${MARK}`} />
        </span>
      );
  }
}
