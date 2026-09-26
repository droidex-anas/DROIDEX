import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DetailedHTMLProps,
  type Ref,
} from 'react';
import './effortSliderElement';
import EffortHelpCard from './EffortHelpCard';
import type {
  EffortSliderChangeDetail,
  EffortSliderElement,
  EffortSliderLevel,
} from './effortSliderElement';

declare module 'react' {
  // Augmenting React's intrinsic elements requires the JSX namespace form.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'effort-slider': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

/**
 * React host for the `<effort-slider>` custom element. The element owns its
 * springs while dragging; React only swaps levels or re-syncs a settled value,
 * so the two never fight over the thumb.
 */
export default function EffortSlider({
  levels,
  value,
  autoFocus = false,
  onCommit,
  style,
  helpAnchor = null,
  ref,
}: {
  levels: EffortSliderLevel[];
  /** Must be one of `levels`' values; the caller picks the fallback. */
  value: string;
  autoFocus?: boolean;
  /** Fires on a settled pick: pointer release, keyboard step, or `setValue(emit)`. */
  onCommit: (value: string) => void;
  style?: CSSProperties;
  /** The surface the help explanation floats above; without one it stays hidden. */
  helpAnchor?: HTMLElement | null;
  ref?: Ref<EffortSliderElement>;
}) {
  const inner = useRef<EffortSliderElement | null>(null);
  const [helpButton, setHelpButton] = useState<HTMLElement | null>(null);
  const attach = useCallback(
    (el: HTMLElement | null) => {
      inner.current = el as EffortSliderElement | null;
      setHelpButton(inner.current?.helpButton ?? null);
      if (typeof ref === 'function') ref(inner.current);
      else if (ref) ref.current = inner.current;
    },
    [ref],
  );
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    inner.current?.setLevels(levels);
  }, [levels]);

  useEffect(() => {
    const el = inner.current;
    if (el && el.value !== value) el.setValue(value, { animate: false });
  }, [value]);

  useEffect(() => {
    if (autoFocus) inner.current?.focusControl();
  }, [autoFocus]);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const onChange = (event: Event) => {
      onCommitRef.current((event as CustomEvent<EffortSliderChangeDetail>).detail.value);
    };
    el.addEventListener('change', onChange);
    return () => {
      el.removeEventListener('change', onChange);
    };
  }, []);

  return (
    <>
      <effort-slider ref={attach} style={style} />
      {helpAnchor && <EffortHelpCard button={helpButton} anchor={helpAnchor} />}
    </>
  );
}
