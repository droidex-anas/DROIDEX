/**
 * TypeScript port of the reference effort slider (the user's effort-slider.js,
 * itself a recreation of a screen recording). Springs, label roll, painting,
 * and geometry are the reference's own, split across sibling modules; the
 * integration changes are deliberate and scoped:
 *
 * - Levels are per-instance (`slider.levels = [...]`): every model publishes
 *   its own reasoning efforts, so the six-stop default is only a fallback.
 * - The Ultracode treatment follows the level value 'ultra' instead of the
 *   last stop, because a model's effort list can end at any level.
 * - The pointer-feedback halo is dropped: it recreated the recording's cursor
 *   highlight, not a product behavior.
 */

import { cancelValueLabelAnimations, rollValueLabel } from './effortSliderLabel';
import {
  DEFAULT_LEVELS,
  effortIndexFromKey,
  isUltraLevel,
  parseEffortValue,
  type EffortSliderLevel,
} from './effortSliderLevels';
import { clamp, integrate, spring } from './effortSliderSpring';
import { EFFORT_SLIDER_MARKUP, EFFORT_SLIDER_STYLES } from './effortSliderStyles';
import { paintUltraField } from './effortSliderUltraField';

export type { EffortSliderLevel } from './effortSliderLevels';

export interface EffortSliderChangeDetail {
  value: string;
  index: number;
  label: string;
}

/** Structural type of the element, for the React wrapper's ref. */
export interface EffortSliderElement extends HTMLElement {
  levels: readonly EffortSliderLevel[];
  value: string;
  valueAsNumber: number;
  disabled: boolean;
  setLevels(levels: readonly EffortSliderLevel[]): void;
  setValue(value: string | number, options?: { emit?: boolean; animate?: boolean }): string;
  focusControl(): void;
  /** The heading's help button, for a host that shows its explanation. */
  readonly helpButton: HTMLElement | null;
}

if (typeof customElements !== 'undefined' && !customElements.get('effort-slider')) {
  const template = document.createElement('template');
  template.innerHTML = `<style>${EFFORT_SLIDER_STYLES}</style>${EFFORT_SLIDER_MARKUP}`;

  class EffortSlider extends HTMLElement implements EffortSliderElement {
    static get observedAttributes(): string[] {
      return ['value', 'disabled'];
    }

    private _levels: readonly EffortSliderLevel[] = DEFAULT_LEVELS;
    private readonly _control: HTMLElement;
    private readonly _rail: HTMLElement;
    private readonly _thumb: HTMLElement;
    private readonly _fill: HTMLElement;
    private readonly _base: HTMLElement;
    private readonly _slot: HTMLElement;
    private readonly _ticks: HTMLElement;
    private readonly _canvas: HTMLCanvasElement;
    private readonly _ctx: CanvasRenderingContext2D | null;
    private _index = 1;
    private readonly _position = spring(1 / (DEFAULT_LEVELS.length - 1));
    private readonly _press = spring(0);
    private readonly _ultra = spring(0);
    private _width = 0;
    private _height = 0;
    private _travel = 0;
    private _raf = 0;
    private _lastTime = 0;
    private _lastPaint = -Infinity;
    private _ultraStarted: number | null = null;
    private _pointer: { id: number; start: number; left: number; grab: number } | null = null;
    private _onscreen = true;
    private readonly _motion = matchMedia('(prefers-reduced-motion: reduce)');
    private readonly _frame = (time: number) => {
      this._tick(time);
    };
    private _events: AbortController | undefined;
    private _resizeObserver: ResizeObserver | undefined;
    private _intersection: IntersectionObserver | undefined;
    private _reflecting = false;

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.append(template.content.cloneNode(true));
      const $ = (selector: string): HTMLElement => {
        const node = root.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`effort-slider template is missing ${selector}`);
        return node;
      };
      this._control = $('.control');
      this._rail = $('.rail');
      this._thumb = $('.thumb');
      this._fill = $('.fill');
      this._base = $('.ultra-base');
      this._slot = $('.value-slot');
      this._ticks = $('.ticks');
      const canvas = root.querySelector('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error('effort-slider template is missing canvas');
      }
      this._canvas = canvas;
      this._ctx = this._canvas.getContext('2d');
      this._syncTicks();
      this._renderLabel(false);
    }

    /** The highest reachable index, never below 1 so single-level lists cannot divide by zero. */
    private get _last(): number {
      return Math.max(this._levels.length - 1, 1);
    }

    get levels(): readonly EffortSliderLevel[] {
      return this._levels;
    }

    set levels(levels: readonly EffortSliderLevel[]) {
      this.setLevels(levels);
    }

    /** Swap the stops (a model's own effort list); clamps the current value. */
    setLevels(levels: readonly EffortSliderLevel[]): void {
      const usable = levels.length > 0 ? levels : DEFAULT_LEVELS;
      if (
        usable.length === this._levels.length &&
        usable.every((level, i) => level.value === this._levels[i]?.value)
      ) {
        return;
      }
      const currentValue = this._levels[this._index]?.value;
      this._levels = usable;
      this._syncTicks();
      this._control.setAttribute('aria-valuemax', String(this._levels.length - 1));
      const kept = currentValue
        ? this._levels.findIndex((level) => level.value === currentValue)
        : -1;
      const index = kept === -1 ? Math.min(this._index, this._levels.length - 1) : kept;
      this._setIndex(index, false, false);
      this._position.target = index / this._last;
      this._position.value = this._position.target;
      this._position.velocity = 0;
      this._resize();
    }

    connectedCallback(): void {
      this._events = new AbortController();
      const { signal } = this._events;
      this._control.addEventListener(
        'pointerdown',
        (e) => {
          this._pointerDown(e);
        },
        { signal },
      );
      this._control.addEventListener(
        'pointermove',
        (e) => {
          this._pointerMove(e);
        },
        { signal },
      );
      this._control.addEventListener(
        'pointerup',
        (e) => {
          this._pointerEnd(e, false);
        },
        { signal },
      );
      this._control.addEventListener(
        'pointercancel',
        (e) => {
          this._pointerEnd(e, true);
        },
        { signal },
      );
      this._control.addEventListener(
        'lostpointercapture',
        (e) => {
          this._pointerEnd(e, false);
        },
        { signal },
      );
      this._control.addEventListener(
        'keydown',
        (e) => {
          this._keyDown(e);
        },
        { signal },
      );
      this._control.addEventListener(
        'blur',
        () => {
          this._control.classList.remove('pointer-focus');
        },
        { signal },
      );
      this._motion.addEventListener(
        'change',
        () => {
          this._lastPaint = -Infinity;
          this._wake();
        },
        { signal },
      );
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.hidden) this._sleep();
          else this._wake();
        },
        { signal },
      );
      this._resizeObserver = new ResizeObserver(() => {
        this._resize();
      });
      this._resizeObserver.observe(this._rail);
      this._intersection = new IntersectionObserver(([entry]) => {
        this._onscreen = entry.isIntersecting;
        if (this._onscreen) this._wake();
        else this._sleep();
      });
      this._intersection.observe(this);
      this._syncDisabled();
      this._resize();
    }

    disconnectedCallback(): void {
      this._events?.abort();
      this._resizeObserver?.disconnect();
      this._intersection?.disconnect();
      this._sleep();
      cancelValueLabelAnimations(this._slot);
      if (this._pointer) this._pointerEnd({ pointerId: this._pointer.id }, true);
      this._press.value = this._press.target = this._press.velocity = 0;
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
      if (oldValue === newValue || this._reflecting) return;
      if (name === 'disabled') {
        this._syncDisabled();
        return;
      }
      let index: number;
      try {
        index = parseEffortValue(this._levels, newValue ?? this._levels[0].value);
      } catch {
        return;
      }
      this._setIndex(index, this.isConnected, false);
      this._position.target = index / this._last;
      if (!this.isConnected) this._position.value = this._position.target;
      this._wake();
    }

    get value(): string {
      return this._levels[this._index]?.value ?? '';
    }
    set value(value: string) {
      this.setValue(value);
    }
    get valueAsNumber(): number {
      return this._index;
    }
    set valueAsNumber(index: number) {
      this.setValue(index);
    }
    get disabled(): boolean {
      return this.hasAttribute('disabled');
    }
    set disabled(value: boolean) {
      this.toggleAttribute('disabled', value);
    }

    focusControl(): void {
      this._control.focus();
    }

    get helpButton(): HTMLElement | null {
      return this.shadowRoot?.querySelector<HTMLElement>('.help') ?? null;
    }

    /** Set a named level or zero-based index; programmatic changes are silent by default. */
    setValue(value: string | number, { emit = false, animate = true } = {}): string {
      const index = parseEffortValue(this._levels, value);
      if (this._pointer) this._pointerEnd({ pointerId: this._pointer.id }, true);
      const changed = this._setIndex(index, animate, emit);
      this._position.target = index / this._last;
      if (!animate) {
        this._position.value = this._position.target;
        this._position.velocity = 0;
        const ultra = isUltraLevel(this._levels[index]) ? 1 : 0;
        this._ultra.value = this._ultra.target = ultra;
        this._ultra.velocity = 0;
        this._ultraStarted = ultra ? performance.now() - 8000 : null;
      }
      this._wake();
      if (changed && emit) this._emit('change');
      return this.value;
    }

    private _setIndex(index: number, animate: boolean, emit: boolean): boolean {
      if (index === this._index) return false;
      const previous = this._index;
      this._index = index;
      this._reflecting = true;
      this.setAttribute('value', this.value);
      this._reflecting = false;
      this._control.setAttribute('aria-valuenow', String(index));
      this._control.setAttribute('aria-valuetext', this._levels[index]?.label ?? '');
      this._renderLabel(animate && !this._motion.matches, index > previous ? 1 : -1);
      if (isUltraLevel(this._levels[index])) this._ultraStarted = performance.now();
      if (!isUltraLevel(this._levels[index])) this._ultra.target = 0;
      this._lastPaint = -Infinity;
      if (emit) this._emit('input');
      return true;
    }

    private _emit(type: 'input' | 'change'): void {
      const level = this._levels[this._index];
      this.dispatchEvent(
        new CustomEvent<EffortSliderChangeDetail>(type, {
          bubbles: true,
          composed: true,
          detail: { value: this.value, index: this._index, label: level.label },
        }),
      );
    }

    private _renderLabel(animate: boolean, direction: 1 | -1 = 1): void {
      rollValueLabel(this._slot, this._levels[this._index]?.label ?? '', {
        ultra: isUltraLevel(this._levels[this._index]),
        animate,
        direction,
      });
    }

    private _syncDisabled(): void {
      this._control.tabIndex = this.disabled ? -1 : 0;
      this._control.setAttribute('aria-disabled', String(this.disabled));
      const help = this.shadowRoot?.querySelector<HTMLButtonElement>('.help');
      if (help) help.disabled = this.disabled;
      if (this.disabled && this._pointer) this._pointerEnd({ pointerId: this._pointer.id }, true);
    }

    private _syncTicks(): void {
      this._ticks.replaceChildren(
        ...this._levels.map(() => {
          const tick = document.createElement('i');
          tick.className = 'tick';
          return tick;
        }),
      );
    }

    private _pointerDown(event: PointerEvent): void {
      if (this.disabled || this._pointer || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      this._resize();
      if (!this._travel) return;
      const rect = this._rail.getBoundingClientRect();
      const thumbWidth = this._height * 0.8;
      const center = rect.left + this._position.value * this._travel + thumbWidth / 2;
      const onThumb = Math.abs(event.clientX - center) <= thumbWidth / 2 + 5;
      this._pointer = {
        id: event.pointerId,
        start: this._index,
        left: rect.left,
        grab: onThumb ? event.clientX - center : 0,
      };
      this._control.setPointerCapture(event.pointerId);
      this._control.classList.add('pointer-focus');
      this._control.focus({ preventScroll: true });
      this._press.target = 1;
      this._pointerMove(event);
    }

    private _pointerMove(event: PointerEvent): void {
      if (this._pointer?.id !== event.pointerId) return;
      const raw =
        (event.clientX - this._pointer.left - this._height * 0.4 - this._pointer.grab) /
        this._travel;
      this._position.target = clamp(raw);
      this._setIndex(Math.round(this._position.target * (this._levels.length - 1)), true, true);
      this._wake();
    }

    private _pointerEnd(event: { pointerId: number }, cancelled: boolean): void {
      if (this._pointer?.id !== event.pointerId) return;
      const { start, id } = this._pointer;
      this._pointer = null;
      if (cancelled) this._setIndex(start, true, true);
      this._position.target = this._index / this._last;
      this._press.target = 0;
      if (this._control.hasPointerCapture(id)) this._control.releasePointerCapture(id);
      this._wake();
      if (!cancelled && start !== this._index) this._emit('change');
    }

    private _keyDown(event: KeyboardEvent): void {
      this._control.classList.remove('pointer-focus');
      if (this.disabled) return;
      const index = effortIndexFromKey(event.key, this._index, this._levels.length - 1);
      if (index === undefined) return;
      event.preventDefault();
      this.setValue(index, { emit: true });
    }

    private _resize(): void {
      const { width, height } = this._rail.getBoundingClientRect();
      if (!width || !height) return;
      this._width = width;
      this._height = height;
      this._travel = width - height * 0.8;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const w = Math.round(width * dpr);
      const h = Math.round(height * dpr);
      if (this._canvas.width !== w || this._canvas.height !== h) {
        this._canvas.width = w;
        this._canvas.height = h;
        this._ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      this._lastPaint = -Infinity;
      this._render(performance.now());
      this._wake();
    }

    private _wake(): void {
      if (this._raf || !this.isConnected || document.hidden || !this._onscreen) return;
      this._lastTime = performance.now();
      this._raf = requestAnimationFrame(this._frame);
    }

    private _sleep(): void {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._lastTime = 0;
    }

    private _tick(time: number): void {
      this._raf = 0;
      if (!this.isConnected || document.hidden || !this._onscreen) return;
      const dt = Math.min((time - this._lastTime) / 1000, 1 / 30);
      this._lastTime = time;
      const ultraHere = isUltraLevel(this._levels[this._index]);
      const age = this._ultraStarted === null ? 0 : time - this._ultraStarted;
      const waiting = ultraHere && age < 180;
      this._ultra.target = ultraHere && !waiting ? 1 : 0;
      let moving = false;
      if (this._motion.matches) {
        for (const s of [this._position, this._press, this._ultra]) {
          s.value = s.target;
          s.velocity = 0;
        }
        this._ultra.value = ultraHere ? 1 : 0;
      } else {
        moving = integrate(this._position, dt, 650, 42) || moving;
        moving = integrate(this._press, dt, 600, 37) || moving;
        moving = integrate(this._ultra, dt, 85, 19) || moving;
      }
      this._render(time);
      const shimmering = ultraHere && !this._motion.matches;
      if (moving || shimmering || (waiting && !this._motion.matches))
        this._raf = requestAnimationFrame(this._frame);
    }

    private _render(time: number): void {
      if (!this._width) return;
      const p = clamp(this._position.value);
      const press = clamp(this._press.value);
      const ultra = clamp(this._ultra.value);
      const stretch = this._motion.matches
        ? 0
        : Math.min(Math.abs(this._position.velocity) * 0.012, 0.022);
      this._thumb.style.transform = `translate3d(${String(p * this._travel)}px,0,0) scale(${String(1 + press * 0.055 + stretch)},${String(1 + press * 0.08 - stretch * 0.45)})`;
      this._fill.style.transform = `scaleX(${String((p * this._travel + this._height * 0.4) / this._width)})`;
      this._fill.style.opacity = String(1 - ultra);
      this._base.style.opacity = String(ultra);
      if (
        this._ctx &&
        (time - this._lastPaint >= 1000 / 30 || ultra === 0 || this._motion.matches)
      ) {
        paintUltraField({
          ctx: this._ctx,
          width: this._width,
          height: this._height,
          time,
          opacity: ultra,
          startedAt: this._ultraStarted,
          reducedMotion: this._motion.matches,
        });
        this._lastPaint = time;
      }
    }
  }

  customElements.define('effort-slider', EffortSlider);
}
