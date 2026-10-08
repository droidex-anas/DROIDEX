import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('free releases use the configured stable identity and only fall back when absent', () => {
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
});
