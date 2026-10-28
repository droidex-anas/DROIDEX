import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

test('free releases use a stable identity and require explicit ad-hoc publication', () => {
  const env = {
    ...process.env,
    DROIDEX_RELEASE_BUILD: '',
    DROIDEX_UNSIGNED_RELEASE_BUILD: '1',
    SENTRY_DSN_FILE: '',
    SENTRY_DSN: 'https://test@o4511166732304384.ingest.de.sentry.io/4511850999185488',
    DROIDEX_DISTRIBUTION_CHANNEL: 'local',
    CSC_LINK: '',
    APPLE_SIGNING_IDENTITY: 'unrelated identity',
    APPLE_ID: 'test@example.invalid',
    APPLE_APP_SPECIFIC_PASSWORD: 'test-password',
    APPLE_TEAM_ID: 'TESTTEAM',
    DROIDEX_SELF_SIGNED_IDENTITY: 'DROIDEX Self-Signed',
  };
  const loadConfig = () =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ['-p', "JSON.stringify(require('./electron-builder.config.cjs'))"],
        { env, encoding: 'utf8' },
      ),
    );

  const stable = loadConfig();
  assert.equal(stable.mac.identity, 'DROIDEX Self-Signed');
  assert.equal(stable.forceCodeSigning, true);
  assert.equal(stable.mac.notarize, false);
  assert.equal(stable.mac.hardenedRuntime, false);
  assert.equal(stable.mac.timestamp, 'none');
  assert.equal(stable.mac.entitlements, 'assets/brand/entitlements.mac.plist');
  assert.equal(stable.mac.entitlementsInherit, 'assets/brand/entitlements.mac.plist');
  assert.equal(stable.extraMetadata.updateInstallMode, 'sparkle');

  env.DROIDEX_SELF_SIGNED_IDENTITY = '';
  const adHoc = loadConfig();
  assert.equal(adHoc.mac.identity, '-');
  assert.equal(adHoc.forceCodeSigning, false);
  assert.equal(adHoc.mac.notarize, false);

  const workflow = parseYaml(readFileSync('.github/workflows/release-macos.yml', 'utf8'));
  const signingStep = workflow.jobs.release.steps.find(
    (step: { name?: string }) => step.name === 'Import stable self-signed release certificate',
  );
  assert.ok(signingStep);
  const directory = mkdtempSync(join(tmpdir(), 'droidex-signing-gate-'));
  const summaryPath = join(directory, 'summary');
  try {
    for (const [certificate, password] of [
      ['', ''],
      ['fixture', ''],
      ['', 'fixture'],
    ]) {
      for (const allowAdHoc of ['', 'true']) {
        writeFileSync(summaryPath, '');
        const result = spawnSync('/bin/bash', ['-e', '-o', 'pipefail', '-c', signingStep.run], {
          encoding: 'utf8',
          env: {
            PATH: '/usr/bin:/bin',
            RUNNER_TEMP: directory,
            GITHUB_STEP_SUMMARY: summaryPath,
            DROIDEX_SIGNING_CERT_P12_BASE64: certificate,
            DROIDEX_SIGNING_CERT_PASSWORD: password,
            DROIDEX_ALLOW_AD_HOC_RELEASE: allowAdHoc,
          },
        });
        assert.equal(result.status, allowAdHoc === 'true' ? 0 : 1, result.stdout + result.stderr);
        assert.match(
          readFileSync(summaryPath, 'utf8'),
          allowAdHoc === 'true' ? /Ad-hoc release explicitly authorized/ : /Release blocked/,
        );
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
