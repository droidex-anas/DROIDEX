// The New menu's two forms: a DESIGN.md to write, paste or upload, or CSS
// variables or a Tailwind config to paste. The sidecar maps what it can onto
// the shared primitives and keeps the rest, so the form only collects text.

import { useId, useRef, useState } from 'react';
import { Upload } from '@droidex/icons';
import { canvasMessage, CanvasRequestError } from './client';
import type { DesignSystemSource } from './protocol';
import { MAX_KIT_NAME_LENGTH } from './wireValidation';

// The sidecar's own bound on kit guidance; a larger file cannot be a DESIGN.md.
const MAX_DESIGN_MD_BYTES = 16 * 1024;

const COPY = {
  designMd: {
    title: 'New from DESIGN.md',
    hint: 'Write, paste or upload a DESIGN.md. Its css blocks set the tokens, and the whole text guides the agent.',
    field: 'DESIGN.md',
    placeholder:
      '# Paper and ink\n\nQuiet warm surfaces, one confident accent.\n\n```css\n:root {\n  --background: #fbf8f3;\n  --primary: #8a5a1f;\n}\n.dark {\n  --background: #171513;\n}\n```',
  },
  cssOrTailwind: {
    title: 'New from CSS or Tailwind config',
    hint: 'Paste CSS variables from :root, @theme and light or dark rules, or a Tailwind config. Familiar names map onto the shared primitives; the rest are kept as unmapped.',
    field: 'CSS variables or Tailwind config',
    placeholder:
      ':root {\n  --background: #fbf8f3;\n  --foreground: #241f1a;\n  --primary: #8a5a1f;\n  --radius: 10px;\n}\n.dark {\n  --background: #171513;\n  --foreground: #efe9e1;\n}',
  },
} as const;

const FIELD_CLASS =
  'w-full rounded-lg bg-droid-accent/[0.07] px-2.5 text-[12px] text-droid-text placeholder:text-droid-text-muted transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15';
const QUIET_BUTTON_CLASS =
  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-droid-text-secondary transition-colors hover:bg-droid-accent/10 hover:text-droid-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15';

export function NewDesignSystemForm({
  kind,
  onCreate,
  onCancel,
}: {
  kind: DesignSystemSource['kind'];
  onCreate: (mutationId: string, name: string, source: DesignSystemSource) => Promise<void>;
  onCancel: () => void;
}) {
  const copy = COPY[kind];
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept until the sidecar answers, so resubmitting the same text after a lost
  // reply finds the kit that save made; an edit is a new kit.
  const mutationId = useRef(crypto.randomUUID());
  const edited = () => {
    mutationId.current = crypto.randomUUID();
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const nameId = useId();
  const textId = useId();
  const canSubmit = !pending && name.trim() !== '' && text.trim() !== '';

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await onCreate(mutationId.current, name.trim(), { kind, text });
    } catch (failure) {
      // A refusal saved nothing, so the next attempt is a new kit.
      if (failure instanceof CanvasRequestError) mutationId.current = crypto.randomUUID();
      setError(canvasMessage(failure));
      setPending(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_DESIGN_MD_BYTES) {
      setError('That file is larger than a DESIGN.md can be (16 KiB).');
      return;
    }
    try {
      setText(await file.text());
      edited();
      setError(null);
      if (name.trim() === '') setName(file.name.replace(/\.(?:md|markdown|txt)$/i, ''));
    } catch {
      setError('That file could not be read. Choose it again.');
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-labelledby={`${nameId}-title`}
      className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-5 pt-5"
    >
      <div className="pr-8">
        <h3 id={`${nameId}-title`} className="text-[15px] font-semibold text-droid-text">
          {copy.title}
        </h3>
        <p className="mt-1 text-[12px] leading-5 text-droid-text-muted">{copy.hint}</p>
      </div>
      <label htmlFor={nameId} className="text-[12px] font-medium text-droid-text">
        Name
      </label>
      <input
        id={nameId}
        value={name}
        maxLength={MAX_KIT_NAME_LENGTH}
        autoFocus
        placeholder="My design system"
        onChange={(event) => {
          setName(event.target.value);
          edited();
        }}
        className={`h-8 ${FIELD_CLASS}`}
      />
      <label htmlFor={textId} className="text-[12px] font-medium text-droid-text">
        {copy.field}
      </label>
      <textarea
        id={textId}
        value={text}
        spellCheck={false}
        placeholder={copy.placeholder}
        onChange={(event) => {
          setText(event.target.value);
          edited();
        }}
        className={`min-h-0 flex-1 resize-none py-2 leading-5 ${FIELD_CLASS}`}
      />
      {error && (
        <p role="alert" className="text-[12px] text-droid-red">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        {kind === 'designMd' && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              className="hidden"
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={QUIET_BUTTON_CLASS}
            >
              <Upload aria-hidden className="h-3.5 w-3.5" />
              Upload .md
            </button>
          </>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onCancel} className={QUIET_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-droid-accent/15 px-3 py-1.5 text-[12px] font-semibold text-droid-text transition-colors hover:bg-droid-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15 disabled:cursor-default disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create design system'}
        </button>
      </div>
    </form>
  );
}
