// A value that reads as text and edits in place (spec §6). Clicking it opens a
// field; Enter or leaving the field keeps the value, Escape puts the old one
// back. A value the check refuses stays in the field with why under it.

import {
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { Input } from '../../../components/ui/Field';
import { cn } from '../../../components/ui/cn';
import { pushEscapeLayer } from '../../../components/ui/escapeStack';

export interface InlineFieldHandle {
  edit: () => void;
}

export function InlineField({
  ref,
  value,
  label,
  check,
  onCommit,
  leading,
  initiallyEditing = false,
  className,
}: {
  ref?: Ref<InlineFieldHandle>;
  value: string;
  /** What the value is, such as "Light value of --ds-accent". */
  label: string;
  /** Why a value cannot be kept, or null when it can. */
  check: (text: string) => string | null;
  onCommit: (text: string) => void;
  /** Shown before the text while editing, such as a live colour swatch. */
  leading?: (text: string) => ReactNode;
  initiallyEditing?: boolean;
  /** The text's type style, shared by the value and its field. */
  className?: string;
}) {
  const [text, setText] = useState<string | null>(initiallyEditing ? value : null);
  const [problem, setProblem] = useState<string | null>(null);
  // Leaving the field after Escape must not keep what Escape threw away.
  const textRef = useRef(text);
  textRef.current = text;
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const problemId = useId();
  const editing = text !== null;

  const stop = (focusValue: boolean) => {
    textRef.current = null;
    returnFocus.current = focusValue;
    setText(null);
    setProblem(null);
  };

  useImperativeHandle(
    ref,
    () => ({
      edit: () => {
        setText(value);
      },
    }),
    [value],
  );

  useEffect(() => {
    if (!editing) {
      if (returnFocus.current) buttonRef.current?.focus();
      returnFocus.current = false;
      return;
    }
    // A frame later, after a menu that started this edit hands focus back to its button.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    const pop = pushEscapeLayer(() => {
      stop(true);
    });
    return () => {
      cancelAnimationFrame(frame);
      pop();
    };
  }, [editing]);

  const finish = (focusValue: boolean) => {
    const current = textRef.current;
    if (current === null) return;
    const next = current.trim();
    const why = next === value ? null : check(next);
    if (why !== null) {
      setProblem(why);
      return;
    }
    if (next !== value) onCommit(next);
    stop(focusValue);
  };

  if (!editing)
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setText(value);
        }}
        className={cn(
          '-mx-1 max-w-full cursor-text truncate rounded-sm px-1 text-left transition-colors duration-quick ease-out hover:bg-elevated',
          className,
        )}
      >
        <span className="sr-only">Edit {label}: </span>
        {value}
      </button>
    );
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <Input
        ref={inputRef}
        variant="compact"
        aria-label={label}
        aria-describedby={problem === null ? undefined : problemId}
        invalid={problem !== null}
        value={text}
        spellCheck={false}
        leading={leading?.(text)}
        className={className}
        onChange={(event) => {
          setText(event.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          finish(true);
        }}
        onBlur={() => {
          finish(false);
        }}
      />
      {problem !== null && (
        <span id={problemId} className="text-caption text-danger">
          {problem}
        </span>
      )}
    </span>
  );
}
