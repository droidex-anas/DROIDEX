// Preloaded into every sidecar test process; see the `test` script.
//
// The sidecar resolves the user's profile and history directory from the
// environment, and from HOME when the environment says nothing. A test run
// started from a shell that carries the app's values therefore opens the user's
// live history database: one run migrated it to an unmerged schema and left the
// app refusing the profile. No test may reach real data even by accident, so
// this drops both variables and points the home directory (HOME, and
// USERPROFILE on Windows) at a scratch directory before any test module loads.
// Harness credential stores resolve from XDG_DATA_HOME and APPDATA before the
// home directory, so those go too. Tests that pin their own directory
// still do; they now pin it over a scratch home rather than over the user's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratchHome = mkdtempSync(join(tmpdir(), 'droidex-sidecar-test-'));

delete process.env.DROIDEX_USER_DATA_DIR;
delete process.env.DROIDEX_HISTORY_DIR;
delete process.env.DROIDEX_ALT_HOME;
delete process.env.DROIDEX_ALT2_HOME;
delete process.env.WINDSURF_API_KEY;
delete process.env.XDG_DATA_HOME;
delete process.env.APPDATA;
process.env.HOME = scratchHome;
process.env.USERPROFILE = scratchHome;

process.on('exit', () => {
  rmSync(scratchHome, { recursive: true, force: true });
});
