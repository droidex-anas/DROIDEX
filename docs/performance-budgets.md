# Performance budgets

These are the supported DROIDEX performance budgets after the phase 0–4
instrumentation and conversation virtualization work. They are hardware- and
profile-aware where the measurement allows it, and they do not claim precision
the harness cannot produce.

Two classes of number exist. Mixing them is a reporting failure.

- **A/B-measurable** — the same probe runs on `origin/main` and on this branch
  using APIs both refs have (bundle bytes, mounted rows, Markdown render,
  feed projection via `buildGroupedFeed` or the production projector,
  terminal deliveries per PTY flood).
- **Candidate-only** — requires the ordered event pipeline, replay harness,
  write-behind persistence, or virtualizer internals that `origin/main` lacks.
  Report as an absolute against a budget. Never as a delta versus main.

## How to measure

```bash
npm run perf:compare -- --baseline origin/main
npm run perf:report
npm run perf:gates
npm run quality:bundle-budgets
npm run perf:canvas -- --runs 3
```

`perf:compare` uses a git worktree of the baseline ref and this branch’s
probes against that tree’s own production modules. Baseline probe output is
cached in `sidecar/src/perf/baselines/origin-main.json` with the measured
commit and the A/B metrics it covers. A SHA or metric-set mismatch is a stale
cache, not a silent reuse.

`perf:canvas` builds the board harness (`tests/smoke/board`) for production
and streams 12 gestures at 120 Hz on a 30- and a 100-frame board in headless
Chromium: pans, wheel zooms, frame drags, a marquee, Edit hover, Alt
measurement, the Layers rows and a panel scrub. It writes
`reports/perf/canvas.{json,md}`. `perf:gates` runs it once on the 30-frame
board, and `perf:compare` once on each of the baseline and candidate trees.
Without Playwright's Chromium its gates are unmeasured. Each tree is measured
on its own: a baseline tree without the harness leaves only the baseline's
canvas values absent, so the candidate's gates are still measured and compared
with no baseline value; a candidate tree without it leaves the gates
unmeasured. Any other failure of the scenario fails the run.

Timing CPU and RSS from a shared CI runner are recorded and **warned**, never
failed. Promote a timing metric to a hard gate only after variance on
dedicated hardware is understood.

## Hard gates (deterministic)

| Invariant | Budget | Justification |
| --- | --- | --- |
| Mounted conversation rows for a 10k-row history | 80 rows | `conversationList.test.ts` keeps 3k and 10k histories under 80 mounted rows at a 900px viewport, 96px estimate, overscan 8. |
| Row visits per streamed tail token at 10k | 80 rows | Same mounted window: a tail delta must not visit retained history. |
| Visible events rebuilt per tail delta | 8 events | Incremental projection rebuilds the live tail. 8 is 4× a two-event append. |
| Renderer deliveries for 1000×64-byte PTY chunks | 16 messages | 64 KiB of PTY data at a 32 KiB MessagePort flush is a handful of posts; 16 is ~4× that plus replay. |
| Tool-marker event loss | 0 | Markers are uncoalesced. A completed replay must deliver every call/result pair. |
| Bridge sequence / order errors | 0 | The replay client rejects generation changes and sequence gaps; a finished report is zero errors. |
| Transport pending events high-water | 4096 | Product cap of the 4096-batch replay buffer. |
| Transport pending estimated bytes | 32 MiB | Product cap of the replay buffer. |
| Persistence overflow on a normal replay | 0 failures | Write-behind is capped at 50k rows / 64 MiB; overflow is explicit, not unbounded growth. |
| Live primary sessions after soak cleanup | 0 | 12 create/close cycles must release every session. |
| React commits per pan frame, 30-frame board | 0.1 commits | Pan moves the board's stage, not React; a 61-frame pan commits only as it starts and ends (0.03). |
| React commits per zoom frame, 30-frame board | 1.25 commits | Pinch and ⌘-wheel events arrive about twice a frame and the stage draws them once (0.98–1.00); 2 means each event draws. |
| React commits per frame of a frame drag or resize, 30-frame board | 0.1 commits | Moving one or five frames or resizing one draws the held frames outside React, which commits only as the hold starts and ends and as its write lands (0.05–0.08). A canvas run that measured its pan but not a drag fails this gate. |
| React commits per frame of a Shift marquee, 30-frame board | 0.1 commits | The band is drawn outside React, which commits only as the marquee starts and ends (0.06). |
| React commits per frame of an Edit hover sweep, 30-frame board | 0.6 commits | Only the outline renders, as the element under the pointer changes; the sweep leaves and re-enters the design at each row's end, and each outline shown or hidden is 2–3 commits with its tag (0.49). At one commit a frame, every hover would draw the board. |
| React commits per frame of a pointer sweep down the Layers rows, 30-frame board | 0.1 commits | A row lights its frame without React (0). Like the drag gate, these three fail when a run measured its pan but not their gesture. |
| Layout reads per pan frame, 30-frame board | 6.5 reads | Rects, offset, client and scroll geometry and computed style, 3 per pointer event at 2 events a frame today. |
| Long tasks during canvas gestures, 30-frame board | 0 | A task over 50 ms drops at least 5 frames at 120 Hz. |
| History worker third-party modules | 0 | `historyWorkerBundle.test.ts`. Both worker isolates compile this graph; a value import of the Droid SDK once cost ~83 MiB of sidecar RSS. |
| History worker bundle | 200_000 bytes | Same test, ~2× the 98 KiB the workers actually need. |
| Initial renderer JS | 1_388_000 bytes | `tools/check-bundle-budgets.mjs`, which records the measurements and budget changes. |
| Initial CSS | 103_200 bytes | Same bundle check. |
| Largest lazy JS chunk | 700_000 bytes | Same bundle check. |

## Timing (warn, not CI-fail)

The #115 contract still stands as a product target, not a shared-runner gate:

| Experience | Target | Caveat |
| --- | --- | --- |
| Composer / first interactive input | Feels ready with the shell; no workspace-engine tax on first paint | Startup phase marks in `rendererPerf` are environment-specific. |
| Event-to-paint p95, ordinary streaming | Roughly 1–3 frames (16–50 ms) | Needs a real renderer paint; sidecar replay only measures append→WS receive. |
| Ordinary live output long tasks | Avoid >50 ms | `PerformanceObserver` longtask, renderer-only. |
| Canvas pan frame, main-thread work p95 | 8.33 ms (120 Hz) | `perf:canvas` trace in headless Chromium, which draws at 60 Hz; the share of frames over 8.33 ms and the rAF gap p95 are recorded too. |
| Long-session switch | Should not scale with full history size | Sidecar `session-switch` exercises `session.loadHistory` while streams run; renderer switch latency is not this number. |
| Memory plateau | Live resource count, not session duration | Soak checks session leaks. RSS on CI is noisy. |
| Hidden / minimized CPU | Approach idle aside from work that is still running | Needs a real Electron window. Not measured headless. |

Sidecar stage calibration (still `--enforce-budgets`, not CI-hard): normalize p95 2 ms, persist p95 10 ms, durability boundary p95 25 ms, emit p95 15 ms, transport fan-out p95 5 ms, append-to-client p95 = coalesce window + 20 ms, marker provider-to-client p95 50 ms, event-loop delay p95 25 ms.

## Hardware / profile

Numbers in committed comparison artifacts were gathered on the machine named
in the report’s `environment` block (Node version, platform, CPU count). They
are comparable across PRs on the **same** class of host. Do not treat a cloud
runner RSS or CPU delta as a product regression.

Reference viewport for the mounted-row budget: 720×900 CSS pixels, the
virtualizer’s `CONVERSATION_LIST_INITIAL_RECT`. A larger window mounts more
rows linearly with viewport height plus overscan; the 80-row budget assumes
that reference, not a 4K fullscreen session.

## Skipped workloads

- **browser pane + model stream** — needs GUI. The design canvas is measured headless by `perf:canvas`.
- **hidden/minimized app with background agents** — needs a real window.
- **sidecar restart/reconnect** — owned by the concurrent supervision phase.

## Report shape

`npm run perf:report` writes a human- and machine-readable comparison to
`reports/perf/compare.md` (and `compare.json`). A/B rows have baseline,
candidate, and delta. Candidate-only rows have an absolute and no delta.
