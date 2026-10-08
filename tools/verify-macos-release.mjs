import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { extractFile, listPackage } from '@electron/asar';
import { parse as parseYaml } from 'yaml';

const releaseDirectory = resolve(process.argv[2] || 'release');
const requireSignedArtifacts = process.argv.includes('--signed');
const selfSignedIdentity = process.env.DROIDEX_SELF_SIGNED_IDENTITY;
const signingCertificateSha256 = process.env.DROIDEX_SIGNING_CERT_SHA256;
const writeChecksums = process.argv.includes('--write-checksums');
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const appName = 'DROIDEX.app';
const sparklePublicKey = 'czgsBI/YO7amJbwhZidZSO0j7LU5A4NsU0No9fDemWU=';
const packagedRuntimeStartupTimeoutMs = 120_000;

const architectures = [
  { name: 'x64', appPath: join(releaseDirectory, 'mac', appName), executableArch: 'x86_64' },
  {
    name: 'arm64',
    appPath: join(releaseDirectory, 'mac-arm64', appName),
    executableArch: 'arm64',
  },
];

const applicationAssetNames = [
  'droidex-x64.dmg',
  'droidex-x64.zip',
  'droidex-arm64.dmg',
  'droidex-arm64.zip',
];
const releaseAssetNames = requireSignedArtifacts
  ? [
      'droidex-x64.dmg',
      'droidex-x64.dmg.blockmap',
      'droidex-x64.zip',
      'droidex-x64.zip.blockmap',
      'droidex-arm64.dmg',
      'droidex-arm64.dmg.blockmap',
      'droidex-arm64.zip',
      'droidex-arm64.zip.blockmap',
      'latest-mac.yml',
    ]
  : [
      ...applicationAssetNames,
      'appcast-x64.xml',
      'appcast-arm64.xml',
      ...readdirSync(releaseDirectory).filter((name) => name.endsWith('.delta')),
    ];
const updateAssetNames = releaseAssetNames.filter((name) => /\.(?:dmg|zip)$/.test(name));

function fail(message) {
  throw new Error(`Release verification failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function runWithDiagnostics(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return `${result.stdout}${result.stderr}`;
}

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files;
}

function assertNoPrivateBuildFiles(paths, label) {
  const forbidden = paths.filter((path) =>
    /(^|\/)(\.env(?:\.|$)|\.git(?:\/|$)|\.npmrc$)|\.(?:cer|key|map|mobileprovision|pem|p8|p12)$/i.test(
      path,
    ),
  );
  assert(forbidden.length === 0, `${label} contains private build files: ${forbidden.join(', ')}`);
}

function assertNoPrivateContent(content, label) {
  const text = content.toString('utf8');
  for (const forbidden of [
    'github.com/droidex-anas/droid-maxxing',
    '/Users/anas/',
    '.codex/worktrees/',
  ]) {
    assert(!text.includes(forbidden), `${label} contains private path or repository metadata`);
  }
}

function hashFile(path, algorithm, encoding) {
  return createHash(algorithm).update(readFileSync(path)).digest(encoding);
}

function enclosureAttribute(enclosure, name) {
  return enclosure.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

function verifySparkleAppcast(architecture) {
  const appcastName = `appcast-${architecture}.xml`;
  const appcastPath = join(releaseDirectory, appcastName);
  const appcast = readFileSync(appcastPath);
  const text = appcast.toString('utf8');
  const enclosures = text.match(/<enclosure\b[^>]*>/g) ?? [];
  const enclosure = enclosures.find(
    (tag) => enclosureAttribute(tag, 'sparkle:deltaFrom') === undefined,
  );
  assert(enclosure, `${appcastName} is missing its signed enclosure`);
  const url = enclosureAttribute(enclosure, 'url');
  const declaredLength = enclosureAttribute(enclosure, 'length');
  const archiveSignature = enclosureAttribute(enclosure, 'sparkle:edSignature');
  assert(
    archiveSignature && /^\d+$/.test(declaredLength ?? ''),
    `${appcastName} is missing its signed enclosure`,
  );
  const archiveName = `droidex-${architecture}.zip`;
  const archivePath = join(releaseDirectory, archiveName);
  assert(
    url ===
      `https://github.com/droidex-anas/droidex-releases/releases/download/v${packageJson.version}/${archiveName}`,
    `${appcastName} URL is stale`,
  );
  assert(Number(declaredLength) === statSync(archivePath).size, `${appcastName} size is stale`);
  assert(
    text.includes(`<sparkle:version>${packageJson.version}</sparkle:version>`),
    `${appcastName} version is stale`,
  );

  const rawPublicKey = Buffer.from(sparklePublicKey, 'base64');
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawPublicKey]),
    format: 'der',
    type: 'spki',
  });
  assert(
    verify(null, readFileSync(archivePath), publicKey, Buffer.from(archiveSignature, 'base64')),
    `${archiveName} has an invalid EdDSA signature`,
  );

  const feedSignature = text.match(
    /sparkle-signatures:\nedSignature: ([^\n]+)\nlength: (\d+)\n/,
  );
  assert(feedSignature, `${appcastName} is missing its signed-feed signature`);
  const signedLength = Number(feedSignature[2]);
  assert(signedLength > 0 && signedLength < appcast.length, `${appcastName} signed length is invalid`);
  assert(
    verify(
      null,
      appcast.subarray(0, signedLength),
      publicKey,
      Buffer.from(feedSignature[1], 'base64'),
    ),
    `${appcastName} has an invalid signed-feed signature`,
  );

  const deltaPrefix = `https://github.com/droidex-anas/droidex-releases/releases/download/v${packageJson.version}/`;
  const deltas = enclosures.filter(
    (tag) => enclosureAttribute(tag, 'sparkle:deltaFrom') !== undefined,
  );
  assert(
    deltas.length === (text.match(/sparkle:deltaFrom=/g)?.length ?? 0),
    `${appcastName} has an unsigned or unrecognised delta enclosure`,
  );
  for (const delta of deltas) {
    const deltaFrom = enclosureAttribute(delta, 'sparkle:deltaFrom');
    const deltaUrl = enclosureAttribute(delta, 'url');
    const deltaLength = enclosureAttribute(delta, 'length');
    const deltaSignature = enclosureAttribute(delta, 'sparkle:edSignature');
    assert(
      deltaFrom && deltaUrl && deltaSignature && /^\d+$/.test(deltaLength ?? ''),
      `${appcastName} has an unsigned or unrecognised delta enclosure`,
    );
    const deltaName = deltaUrl.slice(deltaPrefix.length);
    assert(
      deltaUrl.startsWith(deltaPrefix) &&
        releaseAssetNames.includes(deltaName) &&
        deltaName.endsWith(`-${architecture}.delta`),
      `${appcastName} delta URL ${deltaUrl} is not a ${architecture} delta of this release`,
    );
    const deltaPath = join(releaseDirectory, deltaName);
    assert(Number(deltaLength) === statSync(deltaPath).size, `${deltaName} size is stale`);
    assert(
      verify(null, readFileSync(deltaPath), publicKey, Buffer.from(deltaSignature, 'base64')),
      `${deltaName} has an invalid EdDSA signature`,
    );
  }
  assertNoPrivateContent(text, appcastName);
}

function verifyDeveloperIdApp(appPath, label) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const assessment = runWithDiagnostics('/usr/sbin/spctl', [
    '--assess',
    '--type',
    'execute',
    '--verbose=2',
    appPath,
  ]);
  assert(assessment.includes('source=Notarized Developer ID'), `${label} is not notarized`);
  run('/usr/bin/xcrun', ['stapler', 'validate', appPath]);

  const expectedTeamId = process.env.APPLE_TEAM_ID;
  assert(expectedTeamId, 'APPLE_TEAM_ID is required for signed verification');
  const signature = runWithDiagnostics('/usr/bin/codesign', ['-dvv', appPath]);
  assert(signature.includes(`TeamIdentifier=${expectedTeamId}`), `${label} uses the wrong Apple team`);
  assert(
    signature.includes('Authority=Developer ID Application:'),
    `${label} is not signed for direct Developer ID distribution`,
  );
}

function verifyFreeReleaseApp(appPath, label) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  const signature = runWithDiagnostics('/usr/bin/codesign', ['-dvv', '-r-', appPath]);
  assert(signature.includes('TeamIdentifier=not set'), `${label} unexpectedly has an Apple team`);
  if (signature.includes('Signature=adhoc')) {
    assert(!selfSignedIdentity, `${label} is ad-hoc signed despite a configured stable identity`);
    assert(
      process.env.DROIDEX_ALLOW_AD_HOC_RELEASE === 'true',
      `${label} is ad-hoc signed without explicit DROIDEX_ALLOW_AD_HOC_RELEASE=true`,
    );
    return;
  }
  assert(
    signature.split('\n').includes(`Authority=${selfSignedIdentity || 'DROIDEX Self-Signed'}`),
    `${label} does not use the self-signed release identity`,
  );
  assert(
    /^[0-9a-f]{64}$/.test(signingCertificateSha256 ?? ''),
    'DROIDEX_SIGNING_CERT_SHA256 must pin the existing release certificate with 64 lowercase hex digits',
  );
  const certificateDirectory = mkdtempSync(join(tmpdir(), 'droidex-signing-'));
  try {
    const certificatePrefix = join(certificateDirectory, 'certificate-');
    // codesign takes the prefix only attached with '='; a separate argument is read as the path.
    run('/usr/bin/codesign', ['-d', `--extract-certificates=${certificatePrefix}`, appPath]);
    const leafPath = `${certificatePrefix}0`;
    assert(
      hashFile(leafPath, 'sha256', 'hex') === signingCertificateSha256,
      `${label} signing leaf does not match DROIDEX_SIGNING_CERT_SHA256; restore the pinned certificate`,
    );
    const requirement = signature.match(/^designated => (.+)$/m)?.[1];
    const requirementLeafSha1 = requirement?.match(
      /^identifier "app\.droidex" and certificate leaf = H"([0-9a-fA-F]{40})"$/,
    )?.[1];
    // macOS requirements use SHA-1; derive it only from the leaf already checked against the SHA-256 pin.
    assert(
      requirementLeafSha1?.toLowerCase() === hashFile(leafPath, 'sha1', 'hex'),
      `${label} designated requirement must bind app.droidex to the pinned signing leaf`,
    );
  } finally {
    rmSync(certificateDirectory, { recursive: true, force: true });
  }
}

function verifyDistributedApp(appPath, architecture, label) {
  const executablePath = join(appPath, 'Contents', 'MacOS', 'DROIDEX');
  const asarPath = join(appPath, 'Contents', 'Resources', 'app.asar');
  const stagedAsarPath = join(architecture.appPath, 'Contents', 'Resources', 'app.asar');

  if (requireSignedArtifacts) verifyDeveloperIdApp(appPath, label);
  else verifyFreeReleaseApp(appPath, label);
  assert(
    run('/usr/bin/file', [executablePath]).includes(architecture.executableArch),
    `${label} has the wrong executable architecture`,
  );
  assert(
    hashFile(asarPath, 'sha256', 'hex') === hashFile(stagedAsarPath, 'sha256', 'hex'),
    `${label} does not contain the verified staged application`,
  );
}

async function smokePackagedRuntime(architecture) {
  const { appPath, name } = architecture;
  const executablePath = join(appPath, 'Contents', 'MacOS', 'DROIDEX');
  const resourcesPath = join(appPath, 'Contents', 'Resources');
  const asarPath = join(resourcesPath, 'app.asar');
  const sidecarPath = join(resourcesPath, 'sidecar', 'dist', 'sidecar.mjs');
  const temporaryHome = mkdtempSync(join(tmpdir(), `droidex-${name}-runtime-`));
  const databasePath = join(temporaryHome, '.factory', 'droidex', 'session-index.sqlite');
  const bridgeToken = 'release-verifier-bridge-token';
  const child = spawn(executablePath, [sidecarPath], {
    env: {
      ...process.env,
      HOME: temporaryHome,
      DROIDEX_USER_DATA_DIR: join(temporaryHome, 'Library', 'Application Support', 'DROIDEX'),
      DROIDEX_HISTORY_DIR: join(temporaryHome, '.factory', 'droidex'),
      DROID_PATH: '/usr/bin/false',
      CLAUDE_PATH: '/usr/bin/false',
      CODEX_PATH: '/usr/bin/false',
      CLAUDE_CONFIG_DIR: join(temporaryHome, '.claude'),
      CODEX_HOME: join(temporaryHome, '.codex'),
      FACTORY_API_KEY: '',
      ELECTRON_RUN_AS_NODE: '1',
      BRIDGE_PORT: '0',
      BRIDGE_TOKEN: bridgeToken,
      BRIDGE_EXIT_ON_STDIN_CLOSE: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let bridge;

  try {
    await new Promise((resolveReady, rejectReady) => {
      let output = '';
      let errorOutput = '';
      let isReady = false;
      let didTimeout = false;
      const timeout = setTimeout(() => {
        didTimeout = true;
        child.kill('SIGKILL');
      }, packagedRuntimeStartupTimeoutMs);
      const rejectStartup = (error) => {
        clearTimeout(timeout);
        rejectReady(error);
      };

      child.stdout.on('data', (chunk) => {
        output += chunk.toString('utf8');
        const port = output.match(/(?:^|\n)SIDECAR_READY (\d+)(?:\n|$)/)?.[1];
        if (bridge || !port) return;
        bridge = new globalThis.WebSocket(
          `ws://127.0.0.1:${port}/?token=${bridgeToken}&bridgeProtocol=9`,
        );
        bridge.addEventListener('open', () => {
          bridge.send(JSON.stringify({ type: 'sessions.list' }));
        });
        bridge.addEventListener('message', ({ data }) => {
          let message;
          try {
            message = JSON.parse(data);
          } catch {
            rejectStartup(new Error(`${name} packaged bridge sent invalid JSON`));
            return;
          }
          if (message?.type === 'error') {
            rejectStartup(new Error(`${name} packaged bridge error: ${message.message}`));
            return;
          }
          if (
            isReady ||
            message?.type !== 'events.batch' ||
            !Array.isArray(message.events) ||
            !message.events.some((entry) => entry?.event?.type === 'sessions.list')
          )
            return;
          // The list is emitted only after session history boot reconciliation.
          isReady = true;
          bridge.close();
          child.stdin.end();
        });
        bridge.addEventListener('error', () => {
          rejectStartup(new Error(`${name} packaged bridge connection failed`));
        });
        bridge.addEventListener('close', () => {
          if (!isReady)
            rejectStartup(new Error(`${name} packaged bridge closed before sessions.list`));
        });
      });
      child.stderr.on('data', (chunk) => {
        errorOutput += chunk.toString('utf8');
      });
      child.once('error', rejectStartup);
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        if (didTimeout) {
          rejectReady(
            new Error(
              `${name} packaged sidecar timed out after ${String(packagedRuntimeStartupTimeoutMs)}ms: ${errorOutput}`,
            ),
          );
          return;
        }
        if (!isReady || code !== 0) {
          rejectReady(
            new Error(
              `${name} packaged sidecar exited before a clean shutdown (code=${String(code)}, signal=${String(signal)}): ${errorOutput}`,
            ),
          );
          return;
        }
        resolveReady();
      });
    });

    assert(statSync(databasePath).isFile(), `${name} sidecar did not create the canonical SQLite index`);
    const sqliteResult = run(
      executablePath,
      [
        '-e',
        `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(${JSON.stringify(databasePath)}, { readOnly: true }); const version = db.prepare('PRAGMA user_version').get().user_version; const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map((row) => row.name); console.log(JSON.stringify({ version, tables })); db.close();`,
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    ).trim();
    const sqliteState = JSON.parse(sqliteResult);
    assert(sqliteState.version === 5, `${name} SQLite schema version is not canonical`);
    assert(sqliteState.tables.includes('app_sessions'), `${name} SQLite app_sessions table is missing`);
    assert(sqliteState.tables.includes('child_sessions'), `${name} SQLite child_sessions table is missing`);

    const nativeDependencyResult = run(
      executablePath,
      [
        '-e',
        `const { createRequire } = require('node:module'); const appRequire = createRequire(${JSON.stringify(join(asarPath, 'package.json'))}); const pty = appRequire('node-pty'); const child = pty.spawn('/usr/bin/true', [], { name: 'xterm-color', cols: 80, rows: 24, cwd: '/tmp', env: { PATH: '/usr/bin:/bin' } }); const timeout = setTimeout(() => process.exit(2), 5000); child.onExit(({ exitCode }) => { clearTimeout(timeout); console.log(exitCode); });`,
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    ).trim();
    assert(nativeDependencyResult === '0', `${name} packaged node-pty failed to spawn`);
  } finally {
    bridge?.close();
    if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
    rmSync(temporaryHome, { recursive: true, force: true });
  }
}

for (const assetName of releaseAssetNames) {
  assert(statSync(join(releaseDirectory, assetName)).isFile(), `missing ${assetName}`);
}
assertNoPrivateBuildFiles(releaseAssetNames, 'release assets');
if (!requireSignedArtifacts) {
  for (const { name } of architectures) verifySparkleAppcast(name);
}

if (requireSignedArtifacts) {
  const metadataPath = join(releaseDirectory, 'latest-mac.yml');
  const metadataText = readFileSync(metadataPath, 'utf8');
  const metadata = parseYaml(metadataText);
  assert(metadata.version === packageJson.version, 'latest-mac.yml version is stale');
  assert(Array.isArray(metadata.files), 'latest-mac.yml files must be an array');
  assert(metadata.files.length === updateAssetNames.length, 'latest-mac.yml has unexpected files');
  assert(
    new Set(metadata.files.map(({ url }) => url)).size === updateAssetNames.length,
    'latest-mac.yml contains duplicate URLs',
  );
  for (const assetName of updateAssetNames) {
    const entry = metadata.files.find(({ url }) => url === assetName);
    assert(entry, `latest-mac.yml omits ${assetName}`);
    const assetPath = join(releaseDirectory, assetName);
    assert(entry.size === statSync(assetPath).size, `${assetName} size is stale`);
    assert(entry.sha512 === hashFile(assetPath, 'sha512', 'base64'), `${assetName} SHA-512 is stale`);
  }
  const primaryEntry = metadata.files.find(({ url }) => url === metadata.path);
  assert(primaryEntry && metadata.path.endsWith('.zip'), 'latest-mac.yml primary path is not a ZIP');
  assert(metadata.sha512 === primaryEntry.sha512, 'latest-mac.yml primary SHA-512 is stale');
  assertNoPrivateContent(metadataText, 'latest-mac.yml');
}

for (const architecture of architectures) {
  const { appPath, executableArch, name } = architecture;
  assert(statSync(appPath).isDirectory(), `missing ${name} app bundle`);

  const resourcesPath = join(appPath, 'Contents', 'Resources');
  const asarPath = join(resourcesPath, 'app.asar');
  const sidecarPath = join(resourcesPath, 'sidecar', 'dist', 'sidecar.mjs');
  const executablePath = join(appPath, 'Contents', 'MacOS', 'DROIDEX');
  const sparkleFrameworkPath = join(appPath, 'Contents', 'Frameworks', 'Sparkle.framework');
  const sparkleAddonPath = join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    '@droidex',
    'sparkle-updater',
    'build',
    'Release',
    'sparkle_updater.node',
  );
  const updateConfiguration = readFileSync(join(resourcesPath, 'app-update.yml'), 'utf8');
  assert(updateConfiguration.includes('owner: droidex-anas'), `${name} updater owner is wrong`);
  assert(updateConfiguration.includes('repo: droidex-releases'), `${name} updater repo is wrong`);
  assert(
    updateConfiguration.includes('updaterCacheDirName: droidex-updater'),
    `${name} updater cache identity is stale`,
  );
  assert(statSync(sidecarPath).isFile(), `${name} sidecar bundle is missing`);
  assert(statSync(sparkleFrameworkPath).isDirectory(), `${name} Sparkle framework is missing`);
  assert(statSync(sparkleAddonPath).isFile(), `${name} Sparkle native bridge is missing`);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', sparkleFrameworkPath]);

  const asarEntries = listPackage(asarPath);
  assertNoPrivateBuildFiles(asarEntries, `${name} app.asar`);
  assertNoPrivateContent(readFileSync(asarPath), `${name} app.asar`);
  assertNoPrivateContent(readFileSync(sidecarPath), `${name} sidecar`);
  const packagedMetadata = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'));
  assert(packagedMetadata.name === 'droidex', `${name} package identity is stale`);
  assert(packagedMetadata.version === packageJson.version, `${name} package version is stale`);
  assert(
    packagedMetadata.updateInstallMode === (requireSignedArtifacts ? 'automatic' : 'sparkle'),
    `${name} package has the wrong update install mode`,
  );
  if (!requireSignedArtifacts) {
    assert(
      typeof packagedMetadata.sentryDsn === 'string' && packagedMetadata.sentryDsn.length > 0,
      `${name} package is missing Sentry reporting configuration`,
    );
    const { datadog } = packagedMetadata;
    assert(
      datadog?.distributionChannel === 'release' &&
        [datadog.applicationId, datadog.clientToken, datadog.site].every(
          (value) => typeof value === 'string' && value.length > 0,
        ),
      `${name} package is missing Datadog installation counting configuration`,
    );
  }

  const executableDescription = run('/usr/bin/file', [executablePath]);
  assert(
    executableDescription.includes(executableArch),
    `${name} app has the wrong executable architecture`,
  );
  assert(
    run('/usr/bin/file', [sparkleAddonPath]).includes(executableArch),
    `${name} Sparkle bridge has the wrong architecture`,
  );

  const infoPlist = join(appPath, 'Contents', 'Info.plist');
  for (const key of [
    'NSDesktopFolderUsageDescription',
    'NSDocumentsFolderUsageDescription',
    'NSDownloadsFolderUsageDescription',
  ]) {
    assert(
      run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlist]).includes('choose'),
      `${name} is missing ${key}`,
    );
  }
  assert(
    run('/usr/libexec/PlistBuddy', ['-c', 'Print :SUPublicEDKey', infoPlist]).trim() ===
      sparklePublicKey,
    `${name} has the wrong Sparkle public key`,
  );
  if (!requireSignedArtifacts) {
    assert(
      run('/usr/libexec/PlistBuddy', ['-c', 'Print :SUFeedURL', infoPlist]).trim().endsWith(
        `/droidex-releases/releases/latest/download/appcast-${name}.xml`,
      ),
      `${name} has the wrong Sparkle feed URL`,
    );
  }
  for (const key of [
    'SUEnableAutomaticChecks',
    'SUVerifyUpdateBeforeExtraction',
    'SURequireSignedFeed',
  ]) {
    assert(
      run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlist]).trim() === 'true',
      `${name} is missing secure Sparkle setting ${key}`,
    );
  }
  for (const key of ['SUAllowsAutomaticUpdates', 'SUAutomaticallyUpdate']) {
    assert(
      run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, infoPlist]).trim() === 'false',
      `${name} must require explicit approval before installing updates`,
    );
  }

  if (requireSignedArtifacts) verifyDeveloperIdApp(appPath, `${name} staged app`);
  else verifyFreeReleaseApp(appPath, `${name} staged app`);
}

for (const architecture of architectures) await smokePackagedRuntime(architecture);

for (const architecture of architectures) {
  const dmgPath = join(releaseDirectory, `droidex-${architecture.name}.dmg`);
  run('/usr/bin/hdiutil', ['verify', dmgPath]);

  const extractionDirectory = mkdtempSync(join(tmpdir(), `droidex-${architecture.name}-`));
  const mountDirectory = mkdtempSync(join(tmpdir(), `droidex-${architecture.name}-mount-`));
  try {
    run('/usr/bin/ditto', [
      '-x',
      '-k',
      join(releaseDirectory, `droidex-${architecture.name}.zip`),
      extractionDirectory,
    ]);
    verifyDistributedApp(
      join(extractionDirectory, appName),
      architecture,
      `${architecture.name} updater ZIP app`,
    );

    run('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      mountDirectory,
      dmgPath,
    ]);
    try {
      verifyDistributedApp(
        join(mountDirectory, appName),
        architecture,
        `${architecture.name} DMG app`,
      );
      assert(
        statSync(join(mountDirectory, '.background.tiff')).isFile(),
        `${architecture.name} DMG installer background is missing`,
      );
      assert(
        run('/usr/bin/readlink', [join(mountDirectory, 'Applications')]).trim() === '/Applications',
        `${architecture.name} DMG Applications link is wrong`,
      );
      assert(
        run('/usr/bin/readlink', [join(mountDirectory, 'Open Privacy & Security')]).trim() ===
          '/System/Library/PreferencePanes/Security.prefPane',
        `${architecture.name} DMG Privacy & Security shortcut is wrong`,
      );
    } finally {
      run('/usr/bin/hdiutil', ['detach', mountDirectory]);
    }
  } finally {
    rmSync(extractionDirectory, { recursive: true, force: true });
    rmSync(mountDirectory, { recursive: true, force: true });
  }
}

if (writeChecksums) {
  const lines = releaseAssetNames.map((assetName) => {
    const digest = hashFile(join(releaseDirectory, assetName), 'sha256', 'hex');
    return `${digest}  ${assetName}`;
  });
  writeFileSync(join(releaseDirectory, 'SHA256SUMS'), `${lines.join('\n')}\n`, { mode: 0o644 });
}

const appFiles = architectures.flatMap(({ appPath }) =>
  listFiles(appPath).map((path) => relative(releaseDirectory, path)),
);
assertNoPrivateBuildFiles(appFiles, 'app bundles');

console.log(
  `Verified DROIDEX ${packageJson.version} macOS release (${requireSignedArtifacts ? 'signed' : 'local'}).`,
);
