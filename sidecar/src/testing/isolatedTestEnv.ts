// Preloaded into every sidecar test process; see the `test` script.
//
// The sidecar resolves the user's profile and history directory from the
// environment, and from HOME when the environment says nothing. A test run
// started from a shell that carries the app's values therefore opens the user's
// live history database: one run migrated it to an unmerged schema and left the
// app refusing the profile. No test may reach real data even by accident, so
// this drops both variables and points HOME at a scratch directory before any
// test module loads. Tests that pin their own directory still do; they now pin
// it over a scratch home rather than over the user's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratchHome = mkdtempSync(join(tmpdir(), 'droidex-sidecar-test-'));

delete process.env.DROIDEX_USER_DATA_DIR;
delete process.env.DROIDEX_HISTORY_DIR;
process.env.HOME = scratchHome;

process.on('exit', () => {
  rmSync(scratchHome, { recursive: true, force: true });
});
