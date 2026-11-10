import { useEffect, useRef, useState } from 'react';
import { toast } from '../../lib/toast';
import { canvasMessage } from './client';
import type { CanvasFrame } from './protocol';
import { MAX_FRAME_NAME_LENGTH } from './wireValidation';

/**
 * A frame's name while it is renamed, on its board label or its layers row.
 * Enter or leaving the field saves the name unless someone else renamed the
 * frame meanwhile; Escape keeps the old one.
 */
export function FrameNameField({
  frame,
  className,
  onRename,
  onDone,
}: {
  frame: CanvasFrame;
  className: string;
  onRename: (frame: CanvasFrame, name: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [originalName] = useState(frame.name);
  const [name, setName] = useState(frame.name);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    field.current?.select();
  }, []);

  const finish = () => {
    finished.current = true;
    onDone();
  };
  const save = async () => {
    if (pending || finished.current) return;
    const trimmed = name.trim();
    if (trimmed === '' || trimmed === originalName) {
      finish();
      return;
    }
    if (frame.name !== originalName) {
      toast.error(`This frame was renamed to “${frame.name}” meanwhile.`);
      finish();
      return;
    }
    setPending(true);
    try {
      // The live frame: writes and builds move its manifest version too, and
      // only another rename should stop this one.
      await onRename(frame, trimmed);
      finish();
    } catch (error) {
      toast.error(canvasMessage(error));
      setPending(false);
      field.current?.focus();
    }
  };

  return (
    <input
      ref={field}
      aria-label={`Name of ${originalName}`}
      value={name}
      maxLength={MAX_FRAME_NAME_LENGTH}
      readOnly={pending}
      aria-busy={pending}
      autoFocus
      spellCheck={false}
      className={className}
      onChange={(event) => {
        setName(event.target.value);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void save();
        } else if (event.key === 'Escape' && !pending) {
          event.preventDefault();
          event.stopPropagation();
          finish();
        }
      }}
      onBlur={() => {
        void save();
      }}
    />
  );
}
