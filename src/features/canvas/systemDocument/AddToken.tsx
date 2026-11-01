// The form under a token group that adds a token to it (spec §6). The name is
// typed bare, as the document shows it; the kit's --ds- prefix is added back.

import { useEffect, useRef, useState } from 'react';
import { Plus } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { pushEscapeLayer } from '../../../components/ui/escapeStack';
import type { TokenKind } from '../designSystemDocumentProtocol';
import { isTokenName } from '../designSystemDocumentValidation';
import type { DraftChange } from './documentDraft';
import { fullTokenName } from './documentSections';
import { tokenValueProblem } from './specimenStyle';

export function AddToken({
  groupId,
  kind,
  tokenNames,
  initiallyOpen = false,
  onChange,
}: {
  groupId: string;
  kind: TokenKind;
  /** Every token name in the draft, which a new token may not reuse. */
  tokenNames: ReadonlySet<string>;
  /** A new group opens with its first token's row ready. */
  initiallyOpen?: boolean;
  onChange: (change: DraftChange) => void;
}) {
  const [adding, setAdding] = useState(initiallyOpen);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const stop = () => {
    setAdding(false);
    setProblem(null);
  };

  // Escape closes the form before it reaches the document.
  useEffect(() => {
    if (!adding) return;
    nameRef.current?.focus();
    return pushEscapeLayer(() => {
      setAdding(false);
      setProblem(null);
    });
  }, [adding]);

  if (!adding)
    return (
      <div className="pt-1">
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={() => {
            setAdding(true);
          }}
          className="-ml-2.5"
        >
          Add token
        </Button>
      </div>
    );

  const add = () => {
    const trimmed = name.trim();
    const why = newTokenProblem(kind, trimmed, value, tokenNames);
    if (why !== null) {
      setProblem(why);
      return;
    }
    onChange({
      kind: 'addToken',
      groupId,
      token: { name: fullTokenName(trimmed), value: value.trim() },
    });
    setName('');
    setValue('');
    setProblem(null);
    nameRef.current?.focus();
  };

  return (
    <form
      className="flex flex-col gap-1.5 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          ref={nameRef}
          variant="compact"
          aria-label="New token name"
          placeholder="Name"
          value={name}
          spellCheck={false}
          invalid={problem !== null}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(null);
          }}
          className="w-1/3"
        />
        <Input
          variant="compact"
          aria-label="New token value"
          placeholder="Value"
          value={value}
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value);
            setProblem(null);
          }}
          className="flex-1 tabular-nums"
        />
        <Button type="submit" variant="secondary" size="sm">
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={stop}>
          Cancel
        </Button>
      </div>
      {problem !== null && (
        <p role="alert" className="text-caption text-danger">
          {problem}
        </p>
      )}
    </form>
  );
}

function newTokenProblem(
  kind: TokenKind,
  bare: string,
  value: string,
  tokenNames: ReadonlySet<string>,
): string | null {
  const name = fullTokenName(bare);
  if (!isTokenName(name))
    return 'A token name is lowercase words joined by hyphens, such as accent or space-2.';
  if (tokenNames.has(name)) return `${bare} is already in this design system.`;
  return tokenValueProblem(kind, value);
}
