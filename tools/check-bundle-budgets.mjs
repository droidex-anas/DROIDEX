import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Post-split measurements from perf phase 7 (#123) with modest headroom.
// Raised from 1_280_000 for the context-panel redesign (#216): the shared
// popover system and section rework added ~2.3KB to the entry chunk, which
// had only ~300B of headroom left on main.
// Raised from 1_285_000 for the activity inbox (#217): status derivation,
// the transcript digest, and the flyout view menu added ~6KB to the entry.
// Raised from 680_000 for Mermaid 11.16.1's security fixes: its new optional
// Cynefin diagram chunk is ~691KB; the initial renderer remains unchanged.
// Raised from 1_295_000 for the markdown initiative: the shared renderer's GFM
// tables and code cards, the live composer editor's wiring, and the sidebar
// title presentation added ~14KB to the entry. The editor engine itself stays
// lazy (ComposerEditor chunk, ~487KB).
//
// Raised again to 1_325_000 for link presentation (site marks, GitHub labels)
// and the composer's right-click menu, ~7KB together. The headroom above the
// current ~1_312_000 is deliberate: enough for ordinary work, small enough that
// a genuinely large addition still has to be argued for here.
//
// Raised from 1_325_000 to 1_340_000 for the UI polish pass (#222): app key
// bindings (~2KB), tool-call naming and MCP source marks (~2KB), file mentions
// in prose and chips that open Review (~1.7KB), native-surface obscuring and
// the measured banner stack (~0.6KB), plus small growth across the transcript
// rows and primitives. Those are the notable additions rather than the whole
// accounting: main had also drifted up over the days between the two raises,
// and this one covers both. The new headroom is again ~10KB.
//
// Raised from 1_340_000 to 1_350_000 for the inbox follow-ups on the same
// pass: status marks that settle on click (~2KB), hover intent for the view
// menu's cascade (~1KB), and check-rollup dots on PR icons (~1.5KB). The
// sidebar paints all three at first frame, so none can move off the entry.
//
// initialCssBytes raised from 95_000 to 97_000 for the transcript polish: the
// scroll-position edge fade on wide tables and code, hover-only scrollbars, and
// the tightened typography and inline-code pill added ~0.9KB of CSS.
//
// Raised from 1_350_000 to 1_365_000 for landing the provider-neutral UI stack
// (#258-#265, #274) beside the providers work: the files pane with its tree and
// preview, the running-processes menu, the update pill, and the utility pane
// rework measure ~2.6KB on top of main's entry. Main itself stood ~3.5KB over
// the old line after the ultra-effort level and the generated-image card landed
// without a bump, so most of the raise is catching up to what already shipped.
// Headroom above the merged ~1_356_100 is ~9KB.
//
// initialCssBytes raised from 97_000 to 100_000 on the same landing: main's
// generated-image grid and ultra-effort dots already measured ~1.2KB over the
// old line, and the stack adds ~0.8KB for the files pane chrome. The merged
// ~98_980 leaves ~1KB of headroom, in line with past CSS raises.
//
// Raised from 1_365_000 to 1_375_000 for voice mode: the app owns one
// conversation above the chat view, so the provider, the WebRTC negotiation,
// the microphone hook and the conversation's state (~10KB together) are on the
// entry by construction. Everything a conversation shows stays lazy: the full
// surface, the mini bar, the composer's orb and controls, the settings sheet
// and the chimes all load with the first conversation. The merged ~1_365_300
// leaves the usual ~9KB of headroom.
//
// Raised from 1_365_000 to 1_380_000 for Projects: the sidebar has to know
// which sessions are project threads before it paints, or threads flash into
// the chat list on every load, so the snapshot reducer and its wire validation,
// the sidebar filter and nav pulse, and the Threads pane's auto-open all sit in
// the entry. That is ~8.4KB measured against the pre-Projects base (1_362_540
// at fba7e24a); the route, the threads panel, the plan table and the attention
// notifier stay lazy. Headroom above the current ~1_371_000 is ~9KB.
//
// initialCssBytes raised from 100_000 to 101_500: that same base already
// measured 100_629, over the old line before any of this work, and Projects
// lands ~0.3KB under it. The raise covers main's drift, not the feature.
//
// Raised from 1_380_000 to 1_390_000 when Projects landed on top of voice mode.
// Each fit its own line against their shared base (1_356_068 at b28af864):
// main with voice mode measured 1_369_293 and Projects 1_368_883. Both keep
// their state on the entry by design, so together they measure 1_382_099.
// Nothing moved off the entry to make room; the new headroom is ~8KB. The
// merged CSS of 100_276 is over main's 100_000 line, so Projects' 101_500
// stays.
//
// Lowered from 1_390_000 to 1_385_000 when the voice call left the entry.
// VoiceProvider keeps only the controls a chat reads; the WebRTC negotiation,
// the microphone hook and the call's view logic now load with the first
// conversation (the VoiceCall chunk, ~6KB). The entry measured 1_377_273
// against 1_382_099 before, so the headroom stays ~8KB.
//
// Main meanwhile raised its own line from 1_375_000 to 1_390_000 for the
// DroidProxy provider marks in the composer and picker, plus bridge
// validation, with the settings page lazy; main alone measured ~1_381_450.
//
// Raised to 1_398_000 when Projects landed on top of DroidProxy. Each fits its
// own line, and together the entry measures 1_389_787, 213 bytes under the
// line either side had. Nothing moved off the entry to make room; the new
// headroom is ~8KB. The merged CSS of 100_491 stays under Projects' 101_500.
//
// Raised from 1_390_000 to 1_407_000 for session forks and side chats: the
// entry gains ~17KB for the fork and side-chat store cases, `/side` and `/btw`
// in the composer, the response action row, the sidebar's Fork chat item, the
// forked-from divider, and `session.forked` validation. The side-chat panes and
// floating window stay lazy. The merged ~1_398_100 leaves ~9KB of headroom.
//
// initialCssBytes raised from 100_000 to 101_500 on the same change: side chats
// add ~0.8KB of utility classes, and the merged ~100_650 leaves ~0.85KB.
//
// Main's lines hold when Projects lands on top of session forks, side chats
// and the lazily loaded app frame: together the entry measures 1_391_821 and
// the CSS 101_012.
//
// Raised from 1_407_000 to 1_434_000 for header tabs and tiled chats. Both are
// the app frame: the tab strip paints at first frame, every chat renders
// through the tile grid, and a split tab restored at launch paints its tiles
// at once. Against main at 134581b4 (1_389_170), the tabs measure 1_406_277
// and the tiles 1_424_871; most of the tiles' ~18.6KB is the grid model, its
// stored-state validation and the store wiring. The split-only pieces (divider,
// tile chrome, drop zones) are ~3.9KB, too little to be worth a skeleton in the
// tile the user just split. The headroom is again ~9KB; the CSS of 100_623
// stays under its line.
//
// Raised from 1_434_000 to 1_443_000 for usage limits. Against main at
// b1a4f45c (1_431_240) the entry measures 1_434_484 with the usage slot (/usage,
// the limit tab, the pace warning: ~6.6KB) already loaded lazily. The ~3.2KB
// left must paint with the chat: the limit a chat is held on gates its queue,
// the model-switch divider renders in the transcript, and the composer shows
// the effort a fallback model actually runs. The headroom is again ~8.5KB.
//
// Raised from 1_443_000 to 1_459_000 for the rewritten Browser on top of tabs
// and tiles. The browser host mounts every chat's <webview> page from the app
// frame, the composer carries design marks, and the transcript draws the
// Browser card. Main at 64949712 measures 1_435_466, the rewrite alone
// 1_452_985 on main at b1a4f45c, and the two together 1_457_268, which leaves
// ~1.7KB of headroom.
//
// initialCssBytes raised from 101_500 to 103_500 for the redesigned Browser
// pane: its toolbar, omnibox, loading bar and shared compact composer add ~2.3KB
// of utility classes to the app frame (100_269 before, 102_538 after), leaving
// ~1KB of headroom as past CSS raises have. On main at 64949712 (100_614) the
// two together measure 102_602.
//
// initialCssBytes raised from 103_500 to 105_000 for the image viewers and code
// cards: the floating viewer chrome, zoom toolbar, crop controls and the
// transcript's code and diagram cards add ~1.3KB of utility classes. Tailwind
// emits them into the one stylesheet even though both viewers load lazily, so
// main at 1b21548c (102_602) measures 103_872 with them, leaving ~1.1KB. The
// entry JS stays ~1.3KB under main's.
//
// initialCssBytes raised from 105_000 to 106_000 for the Threads panel: its
// inline approvals and questions and the virtualized thread list add 171 bytes
// of utility classes. Main at f8948cd9 measures 104_889, with them 105_060,
// leaving ~0.9KB.
//
// Raised from 1_459_000 to 1_468_000 for steers and side chats. A pending
// steer paints as the user's bubble with its relative time and take-back
// button (~4.5KB), and a collapsed sidebar keeps the side chat's restore pill
// and its close path (~3KB); both render with the chat. Main measured
// 1_457_268, the steer change 1_461_815 and the side chat change 1_460_242, so
// the two together leave ~3.2KB of headroom.
const BUDGETS = {
  initialRendererJsBytes: 1_468_000,
  initialCssBytes: 106_000,
  largestLazyChunkBytes: 700_000,
  duplicatePackageMaxBytes: 120_000,
};

const WORKER_SUFFIX = '.worker.';
const PACKAGE_MARKERS = [
  ['framer-motion', 'framer-motion'],
  ['react-markdown', 'react-markdown'],
  ['@sentry/electron', '@sentry/electron'],
  ['prism-react-renderer', 'prism-react-renderer'],
  ['prismjs', 'prismjs/prism'],
];

const root = process.cwd();
const distDir = join(root, 'dist');
const assetsDir = join(distDir, 'assets');

function readEntryAssets() {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script[^>]+src="\.\/assets\/([^"]+\.js)"/);
  const cssMatch = html.match(/<link[^>]+href="\.\/assets\/([^"]+\.css)"/);
  if (!scriptMatch || !cssMatch) {
    throw new Error('Could not resolve renderer entry assets from dist/index.html.');
  }
  return {
    entryJs: join(assetsDir, scriptMatch[1]),
    entryCss: join(assetsDir, cssMatch[1]),
  };
}

function listJsChunks() {
  return readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(assetsDir, name));
}

function bytes(path) {
  return statSync(path).size;
}

function findDuplicatePackages(chunks) {
  const violations = [];
  for (const [label, marker] of PACKAGE_MARKERS) {
    const hits = chunks.filter((chunk) => readFileSync(chunk, 'utf8').includes(marker));
    if (hits.length <= 1) continue;
    const totalBytes = hits.reduce((sum, chunk) => sum + bytes(chunk), 0);
    if (totalBytes > BUDGETS.duplicatePackageMaxBytes) {
      violations.push(
        `${label} appears in ${String(hits.length)} chunks (${String(totalBytes)} bytes total, budget ${String(BUDGETS.duplicatePackageMaxBytes)})`,
      );
    }
  }
  return violations;
}

function main() {
  const { entryJs, entryCss } = readEntryAssets();
  const entryJsBytes = bytes(entryJs);
  const entryCssBytes = bytes(entryCss);

  const lazyChunks = listJsChunks().filter(
    (chunk) => chunk !== entryJs && !chunk.includes(WORKER_SUFFIX),
  );
  const largestLazy = lazyChunks.reduce(
    (max, chunk) => Math.max(max, bytes(chunk)),
    0,
  );

  const violations = [];
  if (entryJsBytes > BUDGETS.initialRendererJsBytes) {
    violations.push(
      `initial renderer JS ${String(entryJsBytes)} bytes exceeds ${String(BUDGETS.initialRendererJsBytes)} (${entryJs})`,
    );
  }
  if (entryCssBytes > BUDGETS.initialCssBytes) {
    violations.push(
      `initial CSS ${String(entryCssBytes)} bytes exceeds ${String(BUDGETS.initialCssBytes)} (${entryCss})`,
    );
  }
  if (largestLazy > BUDGETS.largestLazyChunkBytes) {
    violations.push(
      `largest lazy chunk ${String(largestLazy)} bytes exceeds ${String(BUDGETS.largestLazyChunkBytes)}`,
    );
  }
  violations.push(...findDuplicatePackages(listJsChunks()));

  if (violations.length > 0) {
    console.error('Bundle budget check failed:\n' + violations.join('\n'));
    process.exit(1);
  }

  console.log(
    [
      `Initial renderer JS: ${String(entryJsBytes)} bytes (budget ${String(BUDGETS.initialRendererJsBytes)})`,
      `Initial CSS: ${String(entryCssBytes)} bytes (budget ${String(BUDGETS.initialCssBytes)})`,
      `Largest lazy chunk: ${String(largestLazy)} bytes (budget ${String(BUDGETS.largestLazyChunkBytes)})`,
      'Duplicate dependency scan: ok',
    ].join('\n'),
  );
}

main();
