/**
 * The effort slider's shadow-DOM stylesheet, verbatim from the reference file.
 * The `--effort-*` custom properties are the theming seam the host uses to
 * match the app palette; `--effort-unit` scales the whole control.
 */
export const EFFORT_SLIDER_STYLES = `
  :host {
    --u: var(--effort-unit, 1px);
    display: block;
    width: calc(218 * var(--u));
    color: var(--effort-text, #dedede);
    font: 400 calc(13 * var(--u))/1.25 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .panel {
    padding: calc(12 * var(--u)) calc(11 * var(--u)) calc(13 * var(--u));
    border: var(--u) solid var(--effort-border, #303030);
    border-radius: calc(10 * var(--u));
    background: var(--effort-surface, #1d1d1d);
    box-shadow: 0 calc(5 * var(--u)) calc(14 * var(--u)) #00000018,
                inset 0 var(--u) 0 #ffffff02;
  }
  .heading {
    display: flex; align-items: center; gap: calc(8 * var(--u));
    height: calc(16 * var(--u)); line-height: calc(16 * var(--u));
    letter-spacing: calc(-.12 * var(--u));
  }
  .caption { flex: 0 0 calc(35.5 * var(--u)); color: var(--effort-muted, #7b7b79); }
  .value-slot { position: relative; height: 100%; flex: 1; min-width: 0; }
  .value-layer { position: absolute; inset: 0 auto auto 0; white-space: nowrap; }
  .value-layer.ultra { color: var(--effort-accent, #a392e5); }
  .help {
    position: relative; display: grid; place-items: center; flex: 0 0 auto;
    width: calc(14 * var(--u)); height: calc(16 * var(--u)); padding: 0;
    color: #777875; background: none; border: 0; border-radius: 50%; cursor: help;
  }
  .help::before { content: ''; position: absolute; inset: calc(-5 * var(--u)); }
  .help svg { width: calc(13 * var(--u)); height: calc(13 * var(--u)); }
  .help:focus-visible { outline: var(--u) solid #a392e5; outline-offset: calc(3 * var(--u)); }
  .labels {
    display: flex; justify-content: space-between;
    margin-top: calc(22 * var(--u)); height: calc(16 * var(--u));
    color: var(--effort-muted, #7b7b79);
    font-size: calc(12 * var(--u)); line-height: calc(16 * var(--u));
    letter-spacing: calc(-.1 * var(--u));
  }
  .control {
    position: relative; height: calc(20 * var(--u));
    outline: none; touch-action: none; cursor: pointer;
  }
  /* A larger invisible hit target without changing the reference geometry. */
  .control::before { content: ''; position: absolute; inset: min(-10px, calc(-4 * var(--u))) 0; }
  .control:focus-visible:not(.pointer-focus) { outline: calc(1 * var(--u)) solid #a392e5; outline-offset: calc(4 * var(--u)); border-radius: calc(6 * var(--u)); }
  .rail { position: absolute; inset: 0; overflow: hidden; border-radius: calc(5.5 * var(--u)); background: #2f2f2f; }
  .ultra-base { position: absolute; inset: 0; background: #2f2f2c; opacity: 0; }
  .fill { position: absolute; inset: 0; background: var(--effort-fill, #727272); transform-origin: left center; }
  canvas { display: block; position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .ticks { position: absolute; inset: 0 5% 0 5.2%; display: flex; align-items: center; justify-content: space-between; pointer-events: none; }
  .tick { width: calc(2.8 * var(--u)); height: calc(2.8 * var(--u)); border-radius: 50%; background: #ffffff38; }
  .thumb {
    position: absolute; top: 0; left: 0; width: calc(16 * var(--u)); height: 100%;
    border-radius: calc(5.5 * var(--u)); background: #fff;
    box-shadow: 0 calc(.4 * var(--u)) calc(.7 * var(--u)) #00000016;
    transform-origin: center center; pointer-events: none;
  }
  :host([disabled]) { opacity: .48; }
  :host([disabled]) .control { cursor: not-allowed; }
  @media (prefers-reduced-motion: reduce) { .value-layer { transition: none; } }
  @media (forced-colors: active) {
    .panel { border-color: CanvasText; }
    .rail { border: 1px solid CanvasText; }
    .fill, .thumb { background: Highlight; forced-color-adjust: none; }
    .tick { background: CanvasText; }
    canvas, .ultra-base { display: none; }
  }
`;

/** The slider's markup; the ticks row is filled per instance from its levels. */
export const EFFORT_SLIDER_MARKUP = `
  <section class="panel" part="panel">
    <div class="heading">
      <span class="caption">Effort</span>
      <span class="value-slot" aria-hidden="true"></span>
      <button class="help" type="button" aria-label="About effort"
        title="Move toward Smarter to select a higher effort level.">
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.2"/>
          <path d="M6.3 6.2a1.75 1.75 0 0 1 3.45.4c0 1.25-1.75 1.35-1.75 2.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          <circle cx="8" cy="11.15" r=".65" fill="currentColor"/>
        </svg>
      </button>
    </div>
    <div class="labels" aria-hidden="true"><span>Faster</span><span>Smarter</span></div>
    <div class="control" part="control" role="slider" tabindex="0"
      aria-label="Reasoning effort" aria-orientation="horizontal"
      aria-valuemin="0" aria-valuemax="5" aria-valuenow="1" aria-valuetext="Medium">
      <div class="rail" part="track">
        <div class="ultra-base"></div><div class="fill" part="fill"></div>
        <canvas aria-hidden="true"></canvas>
        <div class="ticks"></div>
      </div>
      <div class="thumb" part="thumb"></div>
    </div>
  </section>
`;
