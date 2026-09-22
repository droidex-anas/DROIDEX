import {
  useEffect,
  useRef,
  type CSSProperties,
  type DetailedHTMLProps,
  type HTMLAttributes,
  type Ref,
} from 'react';
import './effortSliderElement';
import type {
  EffortSliderChangeDetail,
  EffortSliderElement,
  EffortSliderLevel,
} from './effortSliderElement';

interface EffortSliderTagProps extends DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> {
  /** Reflects to the element's `disabled` property (a real setter on it). */
  disabled?: boolean;
}

declare module 'react' {
  // Augmenting React's intrinsic elements requires the JSX namespace form.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'effort-slider': EffortSliderTagProps;
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
  disabled = false,
  autoFocus = false,
  onCommit,
  style,
  ref,
}: {
  levels: EffortSliderLevel[];
  /** Must be one of `levels`' values; the caller picks the fallback. */
  value: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Fires on a settled pick: pointer release, keyboard step, or `setValue(emit)`. */
  onCommit: (value: string) => void;
  style?: CSSProperties;
  ref?: Ref<EffortSliderElement>;
}) {
  const inner = useRef<EffortSliderElement | null>(null);
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
    <effort-slider
      ref={(el: HTMLElement | null) => {
        inner.current = el as EffortSliderElement | null;
        if (typeof ref === 'function') ref(inner.current);
        else if (ref) ref.current = inner.current;
      }}
      style={style}
      disabled={disabled}
    />
  );
}
