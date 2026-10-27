// Make variants (spec §4): sibling frames seeded from the selected frame's
// pinned revision, placed below it, and a request in the chat's composer that
// pins them so the agent reworks those frames and nothing else.

import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useStoreApi, useStoreDispatch } from '../../hooks/useStore';
import { canvasClient } from './canvasClient';
import {
  CanvasDialog,
  FIELD_CLASS,
  PRIMARY_BUTTON_CLASS,
  QUIET_BUTTON_CLASS,
} from './CanvasDialog';
import { canvasMessage, CanvasRequestError } from './client';
import { addFramePins } from './framePins';
import {
  MAX_VARIANTS,
  variantFrames,
  variantPrompt,
  type VariantChoice,
  type VariantKind,
  type VariantSource,
} from './variantRequests';

const KINDS: { value: VariantKind; label: string; hint: string }[] = [
  { value: 'layout', label: 'Layout', hint: 'Rearrange its structure and hierarchy.' },
  { value: 'style', label: 'Style', hint: 'Change its type, shapes and texture.' },
  { value: 'colour', label: 'Colour', hint: 'Try another palette on the same layout.' },
];
const COUNTS = Array.from({ length: MAX_VARIANTS }, (_, index) => {
  const count = index + 1;
  return { value: count, label: String(count) };
});
const MAX_DIRECTION_LENGTH = 500;

export function CanvasVariants({
  appSessionId,
  source,
  onClose,
}: {
  /** The chat attached to the source's canvas, whose composer takes the request. */
  appSessionId: string;
  source: VariantSource;
  onClose: () => void;
}) {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  const [kind, setKind] = useState<VariantKind>('layout');
  const [count, setCount] = useState(2);
  const [direction, setDirection] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One mutation per set of frames until the sidecar answers, so confirming
  // again after a lost reply finds the frames that request reserved. The
  // direction only shapes the prompt, so editing it keeps the same frames.
  const attempt = useRef<{ key: string; mutationId: string } | null>(null);
  const mounted = useRef(true);
  const kindRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const directionId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const make = async () => {
    if (pending) return;
    const choice: VariantChoice = { kind, count, direction };
    const key = `${kind}:${String(count)}`;
    if (attempt.current?.key !== key) attempt.current = { key, mutationId: crypto.randomUUID() };
    setPending(true);
    setError(null);
    try {
      const created = await canvasClient.createFrames(
        appSessionId,
        source.canvasId,
        variantFrames(source, choice, attempt.current.mutationId),
      );
      if (!mounted.current) return;
      const state = store.getState();
      if (state.canvasAttachments[appSessionId] !== source.canvasId) {
        setError('This chat has left the canvas, so the variants were made but not requested.');
        setPending(false);
        return;
      }
      addFramePins(appSessionId, source.canvasId, created.frames);
      // Only the focused chat's composer takes a seed.
      if (state.activeAppSessionId !== appSessionId)
        dispatch({ type: 'SET_ACTIVE_SESSION', id: appSessionId });
      dispatch({ type: 'SEED_COMPOSER', text: variantPrompt(source.name, choice) });
      onClose();
    } catch (failure) {
      if (!mounted.current) return;
      // A refusal reserved nothing, so the next attempt is a new request.
      if (failure instanceof CanvasRequestError) attempt.current = null;
      setError(canvasMessage(failure));
      setPending(false);
    }
  };

  const selectedKind = KINDS.find((entry) => entry.value === kind) ?? KINDS[0];
  const frames = count === 1 ? 'a frame' : `${String(count)} frames`;
  let confirmLabel = count === 1 ? 'Make 1 variant' : `Make ${String(count)} variants`;
  if (error) confirmLabel = 'Try again';
  if (pending) confirmLabel = 'Making…';

  return (
    <CanvasDialog
      labelledBy={titleId}
      onClose={pending ? null : onClose}
      initialFocus={kindRef}
      className="w-full max-w-sm"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void make();
        }}
        className="flex flex-col gap-3 p-5"
      >
        <div>
          <h2 id={titleId} className="truncate text-[15px] font-semibold text-droid-text">
            Make variants of {source.name}
          </h2>
          <p className="mt-1 text-[12px] leading-5 text-droid-text-muted">
            Each starts as a copy of this revision and is placed below it. {source.name} stays as it
            is.
          </p>
        </div>
        <ChoiceGroup
          label="Change"
          options={KINDS}
          value={kind}
          disabled={pending}
          selectedRef={kindRef}
          onChange={setKind}
        />
        <p className="-mt-1.5 text-[11px] text-droid-text-muted">{selectedKind.hint}</p>
        <label htmlFor={directionId} className="text-[12px] font-medium text-droid-text">
          Direction <span className="font-normal text-droid-text-muted">(optional)</span>
        </label>
        <textarea
          id={directionId}
          value={direction}
          rows={3}
          maxLength={MAX_DIRECTION_LENGTH}
          disabled={pending}
          placeholder="More whitespace, a bolder headline…"
          onChange={(event) => {
            setDirection(event.target.value);
          }}
          className={`resize-none py-2 ${FIELD_CLASS}`}
        />
        <ChoiceGroup
          label="How many"
          options={COUNTS}
          value={count}
          disabled={pending}
          onChange={setCount}
        />
        {error ? (
          <p role="alert" className="text-[12px] text-droid-red">
            {error}
          </p>
        ) : (
          <p className="text-[11px] leading-4 text-droid-text-muted">
            Adds {frames} to the canvas, then puts the request in your composer to send.
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" disabled={pending} onClick={onClose} className={QUIET_BUTTON_CLASS}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASS}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </CanvasDialog>
  );
}

/** A labelled row of radio segments; arrow keys move the choice like native radios. */
function ChoiceGroup<T extends string | number>({
  label,
  options,
  value,
  disabled,
  selectedRef,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  disabled: boolean;
  /** Takes the selected segment, so the dialog can focus the group on open. */
  selectedRef?: RefObject<HTMLButtonElement | null>;
  onChange: (next: T) => void;
}) {
  const labelId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-[12px] font-medium text-droid-text">
        {label}
      </span>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="flex items-center gap-0.5 rounded-lg bg-droid-accent/[0.07] p-0.5"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={selected ? selectedRef : undefined}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={disabled}
              onClick={() => {
                onChange(option.value);
              }}
              className={`flex-1 cursor-pointer rounded-md px-2 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15 disabled:cursor-default ${
                selected
                  ? 'bg-droid-accent/15 text-droid-text'
                  : 'text-droid-text-muted hover:bg-droid-accent/10 hover:text-droid-text'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
