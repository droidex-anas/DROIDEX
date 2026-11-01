// A token group (spec §5, §6): its title and a data table of its tokens, each
// named bare and drawn with what it holds. Colours show both modes side by
// side; the other kinds show one value, a shadow with tiles of both modes in
// it, and a length or corner with a specimen in the previewed mode beside it.

import { memo, useRef, useState, type CSSProperties } from 'react';
import { Copy, MessageSquareText } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { cn } from '../../../components/ui/cn';
import { pushToast } from '../../../lib/toast';
import type { DocumentToken, TokenGroup, TokenKind } from '../designSystemDocumentProtocol';
import type { PreviewMode } from '../PreviewModeToggle';
import { ActionMenu, type MenuAction } from './ActionMenu';
import { AddToken } from './AddToken';
import type { DraftChange } from './documentDraft';
import { bareTokenName, tokenKey, type DraftMark } from './documentSections';
import { InlineField, type InlineFieldHandle } from './InlineField';
import { NotePopover } from './NotePopover';
import { modeValue } from './specimenStyle';
import { Specimen } from './TokenSpecimens';
import { drawsSpecimen, tokenShape, type TokenShape } from './tokenShape';
import { AddedLabel, UndoRemove, UnsavedMark } from './UnsavedMark';
import { ValueCell } from './ValueCell';

const MAX_TOKEN_NOTE_BYTES = 400;
const MAX_TITLE_LENGTH = 120;

type Specimens = Record<PreviewMode, CSSProperties>;
type TokenValues = { value: string } | { light: string; dark: string };

export function TokenTable({
  group,
  kind,
  kitId,
  mode,
  specimens,
  marks,
  baseTokens,
  tokenNames,
  actions,
  isNew,
  onChange,
}: {
  group: TokenGroup;
  kind: TokenKind;
  kitId: string;
  mode: PreviewMode;
  /** The kit's specimen tokens as custom properties, per mode. */
  specimens: Specimens;
  marks: ReadonlyMap<string, DraftMark>;
  /** The draft's base tokens by name, for what a changed row was. */
  baseTokens: ReadonlyMap<string, DocumentToken>;
  /** Every token name in the draft, which a new token may not reuse. */
  tokenNames: ReadonlySet<string>;
  /** The group's move and remove actions. */
  actions: MenuAction[];
  isNew: boolean;
  /** Null for a kit that cannot be edited. */
  onChange: ((change: DraftChange) => void) | null;
}) {
  const titleRef = useRef<InlineFieldHandle>(null);
  const isRemoved = marks.get(group.id) === 'removed';
  const isColor = kind === 'colors';
  const shapes = group.tokens.map((token) =>
    tokenShape(modeValue(token, 'light'), kind, group.title),
  );
  const hasSpecimen = !isColor && shapes.some(drawsSpecimen);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative flex min-h-control-md items-center gap-2">
        <UnsavedMark mark={marks.get(group.id)} />
        {onChange && !isRemoved ? (
          <InlineField
            ref={titleRef}
            value={group.title}
            label={`Title of the ${group.title} group`}
            check={(text) =>
              text.length > 0 && text.length <= MAX_TITLE_LENGTH
                ? null
                : 'A title is 1 to 120 characters.'
            }
            onCommit={(title) => {
              onChange({ kind: 'retitle', id: group.id, title });
            }}
            className="kit-heading-font text-body-strong text-primary"
          />
        ) : (
          <h3
            className={cn(
              'kit-heading-font truncate text-body-strong',
              isRemoved ? 'text-muted line-through' : 'text-primary',
            )}
          >
            {group.title}
          </h3>
        )}
        <AddedLabel mark={marks.get(group.id)} />
        <span className="flex-1" />
        {onChange &&
          (isRemoved ? (
            <UndoRemove label={group.title} removedKey={group.id} onChange={onChange} />
          ) : (
            <ActionMenu
              label={`${group.title} group actions`}
              actions={[{ label: 'Rename', run: () => titleRef.current?.edit() }, ...actions]}
            />
          ))}
      </div>
      {!isRemoved && (
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="text-caption text-muted">
              <th scope="col" className="w-1/3 pb-1 pt-1.5 font-normal">
                Name
              </th>
              {isColor ? (
                <>
                  <th scope="col" className="pb-1 pt-1.5 font-normal">
                    Light
                  </th>
                  <th scope="col" className="pb-1 pt-1.5 font-normal">
                    Dark
                  </th>
                </>
              ) : (
                <th scope="col" className="pb-1 pt-1.5 font-normal">
                  Value
                </th>
              )}
              {hasSpecimen && (
                <th scope="col" className="w-1/4 pb-1 pt-1.5 font-normal">
                  <span className="sr-only">Specimen</span>
                </th>
              )}
              <th scope="col" className="w-20 pb-1 pt-1.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {group.tokens.map((token, index) => (
              <TokenRow
                key={token.name}
                token={token}
                kind={kind}
                shape={shapes[index]}
                kitId={kitId}
                mode={mode}
                specimens={specimens}
                mark={marks.get(tokenKey(token.name))}
                base={baseTokens.get(token.name)}
                hasSpecimen={hasSpecimen}
                onChange={onChange}
              />
            ))}
          </tbody>
        </table>
      )}
      {onChange && !isRemoved && (
        <AddToken
          groupId={group.id}
          kind={kind}
          tokenNames={tokenNames}
          initiallyOpen={isNew}
          onChange={onChange}
        />
      )}
    </div>
  );
}

// Searching and scrolling render the whole document again; its rows need not.
const TokenRow = memo(function TokenRow({
  token,
  kind,
  shape,
  kitId,
  mode,
  specimens,
  mark,
  base,
  hasSpecimen,
  onChange,
}: {
  token: DocumentToken;
  kind: TokenKind;
  shape: TokenShape;
  kitId: string;
  mode: PreviewMode;
  specimens: Specimens;
  mark: DraftMark | undefined;
  base: DocumentToken | undefined;
  hasSpecimen: boolean;
  onChange: ((change: DraftChange) => void) | null;
}) {
  const isRemoved = mark === 'removed';
  const edit = isRemoved ? null : onChange;
  const setValue =
    edit &&
    ((mode: PreviewMode, value: string) => {
      const values = 'value' in token ? { value } : { ...valuesOf(token), [mode]: value };
      edit({ kind: 'setToken', token: tokenWith(token, values) });
    });
  const valueCell = (which: 'value' | PreviewMode) => (
    <ValueCell
      token={token}
      which={which}
      kind={kind}
      shape={shape}
      kitId={kitId}
      specimens={specimens}
      isRemoved={isRemoved}
      onSet={setValue}
    />
  );

  return (
    <tr className="group/row align-top">
      <td className="py-2 pr-3">
        <span className="relative flex min-h-control-md items-center">
          <UnsavedMark mark={mark} was={wasLabel(base, token)} />
          <Tooltip label={`var(${token.name})`} className="min-w-0">
            <span
              className={cn(
                'kit-body-font block truncate text-body-strong',
                isRemoved ? 'text-muted line-through' : 'text-primary',
              )}
            >
              {bareTokenName(token.name)}
            </span>
          </Tooltip>
        </span>
      </td>
      {kind === 'colors' ? (
        <>
          <td className="py-2 pr-3">{valueCell('light')}</td>
          <td className="py-2 pr-3">{valueCell('dark')}</td>
        </>
      ) : (
        <td className="py-2 pr-3">
          {'value' in token ? (
            valueCell('value')
          ) : (
            <span className="flex flex-col gap-1">
              {valueCell('light')}
              {valueCell('dark')}
            </span>
          )}
        </td>
      )}
      {hasSpecimen && (
        <td className="py-2 pr-3">
          {drawsSpecimen(shape) && (
            <span className="flex min-h-control-md items-center">
              <Specimen shape={shape} name={token.name} style={specimens[mode]} />
            </span>
          )}
        </td>
      )}
      <td className="py-2">
        {isRemoved ? (
          <span className="flex min-h-control-md items-center justify-end">
            {onChange && (
              <UndoRemove
                label={bareTokenName(token.name)}
                removedKey={tokenKey(token.name)}
                onChange={onChange}
              />
            )}
          </span>
        ) : (
          <TokenActions token={token} onChange={onChange} />
        )}
      </td>
    </tr>
  );
});

/** A token's usage note and, when editable, its menu. */
function TokenActions({
  token,
  onChange,
}: {
  token: DocumentToken;
  onChange: ((change: DraftChange) => void) | null;
}) {
  const noteRef = useRef<HTMLButtonElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const name = bareTokenName(token.name);
  const set = (next: DocumentToken) => {
    onChange?.({ kind: 'setToken', token: next });
  };
  const reference = `var(${token.name})`;
  const copy: MenuAction = {
    label: 'Copy reference',
    icon: Copy,
    run: () => {
      navigator.clipboard.writeText(reference).then(
        () => pushToast(`Copied ${reference}`),
        () => pushToast(`${reference} could not be copied.`, 'error'),
      );
    },
  };
  const split: MenuAction =
    'value' in token
      ? {
          label: 'Separate light and dark',
          run: () => {
            set(tokenWith(token, { light: token.value, dark: token.value }));
          },
        }
      : {
          label: 'Use one value for both',
          run: () => {
            set(tokenWith(token, { value: token.light }));
          },
        };

  return (
    <>
      <span className="flex min-h-control-md items-center justify-end gap-0.5">
        {(token.note !== undefined || onChange) && (
          <Button
            ref={noteRef}
            variant="ghost"
            size="sm"
            icon={MessageSquareText}
            aria-label={
              token.note === undefined ? `Add a usage note to ${name}` : `Usage note of ${name}`
            }
            aria-expanded={noteOpen}
            onClick={() => {
              setNoteOpen((open) => !open);
            }}
            className={cn(
              'last:-mr-1.5',
              token.note === undefined &&
                'opacity-0 focus-visible:opacity-100 group-focus-within/row:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100',
            )}
          />
        )}
        <ActionMenu
          label={`${name} actions`}
          actions={
            onChange
              ? [
                  copy,
                  split,
                  {
                    label: 'Remove',
                    danger: true,
                    run: () => {
                      onChange({ kind: 'remove', key: tokenKey(token.name) });
                    },
                  },
                ]
              : [copy]
          }
        />
      </span>
      {noteOpen && (
        <NotePopover
          anchorRef={noteRef}
          title={`Usage note · ${name}`}
          note={token.note}
          maxBytes={MAX_TOKEN_NOTE_BYTES}
          onChange={
            onChange
              ? (note) => {
                  set(tokenWith(token, valuesOf(token), note));
                }
              : undefined
          }
          onClose={() => {
            setNoteOpen(false);
          }}
        />
      )}
    </>
  );
}

function valuesOf(token: DocumentToken): TokenValues {
  return 'value' in token ? { value: token.value } : { light: token.light, dark: token.dark };
}

function tokenWith(
  token: DocumentToken,
  values: TokenValues,
  note: string | undefined = token.note,
): DocumentToken {
  return { name: token.name, ...(note === undefined ? {} : { note }), ...values };
}

function wasLabel(base: DocumentToken | undefined, token: DocumentToken): string | undefined {
  if (!base) return undefined;
  // A token moved to another group keeps its values.
  if (sameValues(valuesOf(base), valuesOf(token)))
    return base.note === token.note ? undefined : 'Usage note changed, not saved';
  if ('value' in base) return `Was ${base.value}`;
  return `Was ${base.light} in light, ${base.dark} in dark`;
}

function sameValues(a: TokenValues, b: TokenValues): boolean {
  if ('value' in a) return 'value' in b && a.value === b.value;
  return !('value' in b) && a.light === b.light && a.dark === b.dark;
}
