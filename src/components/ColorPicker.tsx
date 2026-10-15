import { useEffect, useRef, useState, type RefObject } from 'react';
import { Pipette } from 'lucide-react';
import { Input } from './ui/Field';
import { Popover } from './ui/Popover';

/* ── color math ── */
interface HSV {
  h: number;
  s: number;
  v: number;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeHex(hex: string): string | null {
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h))
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return `#${h.toLowerCase()}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex) ?? '#000000';
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex: string): HSV {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

const HUE_GRADIENT =
  'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)';

/* ── the picker surface ── */
const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const { h, s, v } = hexToHsv(value);
  const satRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const [hexDraft, setHexDraft] = useState(value);

  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  const commitHex = (raw: string) => {
    setHexDraft(raw);
    const norm = normalizeHex(raw);
    if (norm) onChange(norm);
  };

  const pickFromScreen = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await new (window as any).EyeDropper().open();
      if (result?.sRGBHex) onChange(result.sRGBHex);
    } catch {
      /* user cancelled */
    }
  };

  const updateSat = (clientX: number, clientY: number) => {
    const r = satRef.current?.getBoundingClientRect();
    if (!r) return;
    const ns = clamp((clientX - r.left) / r.width, 0, 1);
    const nv = 1 - clamp((clientY - r.top) / r.height, 0, 1);
    onChange(hsvToHex(h, ns, nv));
  };
  const updateHue = (clientX: number) => {
    const r = hueRef.current?.getBoundingClientRect();
    if (!r) return;
    const nh = clamp((clientX - r.left) / r.width, 0, 1) * 360;
    onChange(hsvToHex(nh, s === 0 ? 1 : s, v === 0 ? 1 : v));
  };

  const drag = (move: (x: number, y: number) => void) => (e: React.PointerEvent) => {
    e.preventDefault();
    move(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => {
      move(ev.clientX, ev.clientY);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="select-none touch-none">
      <div
        ref={satRef}
        onPointerDown={drag((x, y) => {
          updateSat(x, y);
        })}
        className="relative h-40 rounded-md cursor-crosshair overflow-hidden"
        style={{ background: `hsl(${h}, 100%, 50%)` }}
      >
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to right, #fff, rgba(255,255,255,0))' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to top, #000, rgba(0,0,0,0))' }}
        />
        <span
          className="absolute size-icon-sm -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white pointer-events-none"
          style={{
            left: `${s * 100}%`,
            top: `${(1 - v) * 100}%`,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          }}
        />
      </div>
      <div
        ref={hueRef}
        onPointerDown={drag((x) => {
          updateHue(x);
        })}
        className="relative h-3.5 mt-3 rounded-full cursor-pointer"
        style={{ background: HUE_GRADIENT }}
      >
        <span
          className="absolute top-1/2 size-icon-md -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white pointer-events-none"
          style={{ left: `${(h / 360) * 100}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.5)' }}
        />
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <span
          className="size-control-sm shrink-0 rounded-sm"
          // The chips the picker edits are any colour, so the swatch carries
          // its own hairline the way the theme editor's pills do.
          style={{
            backgroundColor: value,
            boxShadow: 'inset 0 0 0 1px rgba(128, 128, 128, 0.3)',
          }}
        />
        <input
          value={hexDraft}
          onChange={(e) => {
            commitHex(e.target.value);
          }}
          spellCheck={false}
          className="h-control-sm min-w-0 flex-1 rounded-sm bg-field px-2 font-mono text-code-sm text-primary"
        />
        {hasEyeDropper && (
          <button
            onClick={pickFromScreen}
            title="Pick color from screen"
            className="flex size-control-sm shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-active hover:text-primary"
          >
            <Pipette className="size-icon-sm" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ── the picker, floating against the swatch that opened it ── */
export function ColorPopover({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={anchorRef}
      label="Pick a color"
      placement="bottom-end"
      width={260}
      // Portaled to <body>, so modal hosts (the theme editor's Tab trap)
      // recognize focus inside it via this attribute instead of containment.
      data-color-popover=""
    >
      <div className="p-3">{children}</div>
    </Popover>
  );
}

/* ── full settings row: swatch + hex + picker popover ── */
export function ColorField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const swatchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (raw: string) => {
    setDraft(raw);
    const norm = normalizeHex(raw);
    if (norm) onChange(norm);
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-label text-primary">{label}</div>
        {description && <div className="text-caption text-muted">{description}</div>}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          ref={swatchRef}
          onClick={() => {
            setOpen((o) => !o);
          }}
          className="w-8 h-8 rounded-md border border-divider cursor-pointer hover:border-divider-strong transition-colors"
          style={{ backgroundColor: value }}
          title="Pick color"
        />
        <Input
          variant="compact"
          value={draft}
          onChange={(e) => {
            commit(e.target.value);
          }}
          spellCheck={false}
          aria-label={`${label} hex value`}
          className="w-24 font-mono text-code-sm"
        />
        {open && (
          <ColorPopover
            anchorRef={swatchRef}
            onClose={() => {
              setOpen(false);
            }}
          >
            <ColorPicker value={value} onChange={onChange} />
          </ColorPopover>
        )}
      </div>
    </div>
  );
}
