// A shadow token's value (spec §5): a short line about its layers that opens
// an editor with a row for each, under tiles of the shadow as it is edited.
// Edits are kept when the editor closes, as a usage note's are.

import { useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Plus, Trash } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { Popover } from '../../../components/ui/Popover';
import type { TokenKind } from '../designSystemDocumentProtocol';
import { formatShadow, shadowSummary, type ShadowLayer } from './shadowLayers';
import { isPaintable, tokenValueProblem } from './specimenStyle';
import { ShadowTile } from './TokenSpecimens';

type LengthField = 'x' | 'y' | 'blur' | 'spread';

const LENGTH_FIELDS: { field: LengthField; label: string; name: string; min?: number }[] = [
  { field: 'x', label: 'X', name: 'X offset' },
  { field: 'y', label: 'Y', name: 'Y offset' },
  { field: 'blur', label: 'Blur', name: 'Blur', min: 0 },
  { field: 'spread', label: 'Spread', name: 'Spread' },
];

export function ShadowValue({
  value,
  layers,
  kind,
  label,
  surfaces,
  isRemoved,
  onCommit,
}: {
  value: string;
  /** `value` parsed. */
  layers: ShadowLayer[];
  kind: TokenKind;
  /** What the value is, such as "Light value of shadow-md". */
  label: string;
  /** The kit's specimen tokens in each mode the value is for, which the editor's tiles paint. */
  surfaces: CSSProperties[];
  isRemoved: boolean;
  /** Null for a value that cannot be edited. */
  onCommit: ((value: string) => void) | null;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const summary = shadowSummary(layers);

  if (isRemoved)
    return (
      <span className="kit-body-font truncate text-body tabular-nums text-muted line-through">
        {summary}
      </span>
    );
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((isOpen) => !isOpen);
        }}
        className="kit-body-font -mx-1 truncate rounded-sm px-1 text-left text-body tabular-nums text-secondary transition-colors duration-quick ease-out hover:bg-elevated"
      >
        <span className="sr-only">
          {onCommit ? 'Edit' : 'Show'} the layers of the {label}:{' '}
        </span>
        {summary}
      </button>
      {open && (
        <ShadowEditor
          anchorRef={buttonRef}
          value={value}
          layers={layers}
          kind={kind}
          label={label}
          surfaces={surfaces}
          onCommit={onCommit}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function ShadowEditor({
  anchorRef,
  value,
  layers,
  kind,
  label,
  surfaces,
  onCommit,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  value: string;
  layers: ShadowLayer[];
  kind: TokenKind;
  label: string;
  surfaces: CSSProperties[];
  onCommit: ((value: string) => void) | null;
  onClose: () => void;
}) {
  // Rows keep their fields' typing when a row above them is removed.
  const [rows, setRows] = useState(() => layers.map((layer, id) => ({ id, layer })));
  const nextId = useRef(layers.length);
  const addRef = useRef<HTMLButtonElement>(null);
  const edited = formatShadow(rows.map(({ layer }) => layer));
  const problem = edited === value ? null : tokenValueProblem(kind, edited);
  const isEditable = onCommit !== null;

  const close = () => {
    if (onCommit && problem === null && edited !== value) onCommit(edited);
    onClose();
  };
  const update = (id: number, change: Partial<ShadowLayer>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { id, layer: { ...row.layer, ...change } } : row)),
    );
  };

  return (
    <Popover
      open
      onClose={close}
      anchorRef={anchorRef}
      label={`Layers of the ${label}`}
      width={360}
      placement="bottom-start"
    >
      <div className="flex flex-col gap-3 p-3">
        <p className="truncate text-label text-muted">{label}</p>
        <div className="flex gap-2">
          {surfaces.map((style, index) => (
            <ShadowTile
              key={index}
              shadow={isPaintable('box-shadow', edited) ? edited : value}
              style={style}
              size="editor"
            />
          ))}
        </div>
        <table className="w-full table-fixed text-left">
          <thead>
            <tr className="text-caption text-muted">
              {LENGTH_FIELDS.map(({ field, label: column }) => (
                <th key={field} scope="col" className="pb-1 pr-1.5 font-normal">
                  {column}
                </th>
              ))}
              <th scope="col" className="pb-1 pr-1.5 font-normal">
                Alpha
              </th>
              {isEditable && (
                <th scope="col" className="w-8 pb-1">
                  <span className="sr-only">Remove</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, layer }, index) => {
              const layerName = `layer ${String(index + 1)}`;
              return (
                <tr key={id}>
                  {LENGTH_FIELDS.map(({ field, name, min }) => (
                    <td key={field} className="pb-1.5 pr-1.5">
                      <NumberField
                        value={layer[field].amount}
                        unit={layer[field].unit || 'px'}
                        label={`${name} of ${layerName}`}
                        min={min}
                        isReadOnly={!isEditable}
                        onChange={(amount) => {
                          update(id, { [field]: { amount, unit: layer[field].unit } });
                        }}
                      />
                    </td>
                  ))}
                  <td className="pb-1.5 pr-1.5">
                    <NumberField
                      value={Math.round(layer.alpha * 1000) / 10}
                      unit="%"
                      label={`Alpha of ${layerName}`}
                      min={0}
                      max={100}
                      isReadOnly={!isEditable}
                      onChange={(percent) => {
                        update(id, { alpha: percent / 100 });
                      }}
                    />
                  </td>
                  {isEditable && (
                    <td className="pb-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash}
                        aria-label={`Remove ${layerName}`}
                        disabled={rows.length === 1}
                        onClick={() => {
                          setRows((current) => current.filter((row) => row.id !== id));
                          addRef.current?.focus();
                        }}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {isEditable && (
          <Button
            ref={addRef}
            variant="ghost"
            size="sm"
            icon={Plus}
            onClick={() => {
              const last = rows.at(-1);
              if (!last) return;
              setRows((current) => [...current, { id: nextId.current, layer: last.layer }]);
              nextId.current += 1;
            }}
            className="-ml-2.5 self-start"
          >
            Add layer
          </Button>
        )}
        {problem !== null && (
          <p className="text-caption text-danger">{problem} It is not kept until it is fixed.</p>
        )}
      </div>
    </Popover>
  );
}

/** A number typed in place; only a number in range reaches `onChange`, so a half-typed one keeps the last. */
function NumberField({
  value,
  unit,
  label,
  min,
  max,
  isReadOnly,
  onChange,
}: {
  value: number;
  unit: string;
  label: string;
  min?: number;
  max?: number;
  isReadOnly: boolean;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const accepts = (typed: string) => {
    const amount = Number(typed);
    return (
      typed.trim() !== '' &&
      Number.isFinite(amount) &&
      (min === undefined || amount >= min) &&
      (max === undefined || amount <= max)
    );
  };
  return (
    <Input
      variant="compact"
      inputMode="decimal"
      spellCheck={false}
      aria-label={`${label}, in ${unit}`}
      value={text}
      readOnly={isReadOnly}
      invalid={!accepts(text)}
      trailing={unit}
      onChange={(event) => {
        const typed = event.target.value;
        setText(typed);
        if (accepts(typed)) onChange(Number(typed));
      }}
      className="tabular-nums"
    />
  );
}
