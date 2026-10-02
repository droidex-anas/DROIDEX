---
name: test-audit
description: Use whenever writing, changing, reviewing, or sweeping tests in DROIDEX. Gates new tests at write time and audits existing suites for duplicate, implementation-coupled, or low-value tests.
---

# Test Audit

Adapted from OpenClaw's `test-audit` skill (MIT,
https://github.com/openclaw/openclaw/tree/main/.agents/skills/test-audit) for
DROIDEX's `node:test` suites. Read the "Verification and tests" section of
`AGENTS.md` first; this skill is the procedure behind it.

Two modes, one value bar. **Authoring** gates every new or changed test.
**Audit** prunes an existing surface (one module, or one area such as the
sidecar session suites). Optimise for confidence, not deletion count.

## Authoring gate

Before adding a test, answer all four. A missing answer means do not add it.

1. What observable behaviour, invariant, or cross-process contract does it
   protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch it? Each contract has one
   owner suite at the narrowest entry point that owns the behaviour. A second
   layer (for example `SessionManager` over `SessionLifecycle`) needs its own
   distinct risk: wiring, session targeting, or a race the owner cannot reach.
   Prefer a new row in an existing table or fixture over a near-duplicate test.
4. Does it need a production seam (export, flag, injection hook) that no
   production caller needs? Then test at the real boundary instead.

Then check it against the junk patterns below. A test that breaks under a
behaviour-preserving refactor asserts implementation; rewrite it at the owner.

A bug fix adds one regression test at the owner boundary. It must fail on the
pre-fix code for the intended reason. Do not replay the scenario at every layer.

## Junk patterns

- assertion-free coverage probes, self-comparisons, identity copies;
- copied fixtures, inventories, or export lists; exact source or import greps;
- private helper or call-shape tests duplicated at a real boundary;
- the same contract invoked twice, or a facade suite replaying a module suite;
- assertions on the exact call sequence of a fake when the outcome is asserted;
- expected values produced by the helper under test;
- fakes that implement the asserted behaviour;
- negative tests that pass for an unrelated reason (a different guard rejects);
- names that promise more than the assertions check;
- sleeps, wall-clock thresholds, or file-permission tricks that only fail when
  not running as root (inject the failure through a fake instead);
- dead production code whose only callers are tests.

## Retention bar

Keep a test that independently guards data integrity, history persistence,
session targeting, ordering, cancellation, cleanup, a security boundary, or a
sidecar/renderer/electron contract. Keep observable call ordering and real
regressions. Static or slow alone is not a reason to delete. A retained test
that fails on the baseline is a possible product bug: reproduce it, do not
delete it.

## Audit procedure

1. **Baseline.** Record test and support line counts, test counts, and
   `test:ci` coverage (`npm --prefix sidecar run test:ci`, `npm run test:ci`)
   at a pinned `origin/main` SHA. Keep baseline failures in their own list.
2. **Lanes.** Split the surface along production owners, not file prefixes.
   One owner per file at a time when several agents work in parallel.
3. **Ledger.** Read every test in full, with its production owner and
   callers. Mark each declaration:
   - `R` retain, naming the contract and the bug it catches;
   - `F` keep the contract, fix a vacuous assertion;
   - `C` consolidate, naming the keeper that absorbs it;
   - `D` delete, naming the proof that remains.
   Judge by assertions, not names.
4. **Layer plan.** From the ledger, name one keeper suite per contract and
   retire the redundant layer, not just single tests. Delete helpers in
   `testing/` and test-only production seams that become unused.
5. **Cutover.** Edit lane by lane. Do not edit while a test run is using the
   checkout.
6. **Preservation check.** Compare per-file coverage of production modules
   against the baseline. For a contract whose proof moved, mutate the
   production owner once and confirm the keeper goes red, then restore it.

## Validation

1. `npm --prefix sidecar run typecheck` / `npm run typecheck`.
2. The owner suites: `node --import tsx --import ./src/testing/isolatedTestEnv.ts --test <files>` from `sidecar/`,
   or `node --import tsx --test <files>` for the renderer.
3. `test:ci` for each touched package; stay above its coverage floors.
4. `npm run lint`, `npm run format:check`, `git diff --check`.
5. `git diff --numstat`, reporting production and test lines separately.

## Handoff

Report the removed categories, production simplifications, retained false
positives and why, proof actually run, test vs production LOC before and
after, coverage before and after, and named follow-ups.
