import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const releaseDirectory = resolve(process.argv[2] || 'release');
// Each subdirectory (named by release tag) holds that release's droidex-<arch>.zip.
// Sparkle builds a binary delta from every previous archive it finds here.
const previousReleasesDirectory = process.env.SPARKLE_PREVIOUS_RELEASES_DIR
  ? resolve(process.env.SPARKLE_PREVIOUS_RELEASES_DIR)
  : undefined;
const maximumDeltas = 3;
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
const releaseTag = `v${packageVersion}`;
const account = 'droidex';
const sparkleBin = resolve('vendor/sparkle/distribution/bin');
const generatorCache = join(homedir(), 'Library/Caches/Sparkle_generate_appcast');
const privateKey = process.env.SPARKLE_PRIVATE_KEY_FILE
  ? readFileSync(process.env.SPARKLE_PRIVATE_KEY_FILE, 'utf8').trim()
  : process.env.SPARKLE_PRIVATE_KEY;
const keyArguments = privateKey ? ['--ed-key-file', '-'] : ['--account', account];

function runSparkleTool(name, args, failureMessage) {
  const result = spawnSync(join(sparkleBin, name), [...keyArguments, ...args], {
    encoding: 'utf8',
    input: privateKey ? `${privateKey}\n` : undefined,
    stdio: privateKey ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(
      `${failureMessage} (status=${String(result.status)}, signal=${String(result.signal)}): ${`${result.stdout}\n${result.stderr}`.trim()}`,
    );
  }
}

function previousArchives(architecture) {
  if (!previousReleasesDirectory || !existsSync(previousReleasesDirectory)) return [];
  return readdirSync(previousReleasesDirectory)
    .filter((tag) => tag !== releaseTag)
    .map((tag) => ({ tag, path: join(previousReleasesDirectory, tag, `droidex-${architecture}.zip`) }))
    .filter(({ path }) => existsSync(path));
}

// generate_appcast remembers a delta it judged too large as a marker named after
// the delta file (DROIDEX<new>-<old>.delta...ignore). Both architectures produce
// the same delta names, so clear DROIDEX's markers before each architecture to
// keep one architecture from suppressing the other's deltas.
function clearIgnoredDeltaMarkers() {
  if (!existsSync(generatorCache)) return;
  for (const entry of readdirSync(generatorCache)) {
    if (entry.startsWith('DROIDEX') && entry.includes('.delta') && entry.endsWith('ignore')) {
      rmSync(join(generatorCache, entry), { force: true });
    }
  }
}

rmSync(join(releaseDirectory, 'appcast.xml'), { force: true });
for (const entry of readdirSync(releaseDirectory)) {
  if (entry.endsWith('.delta')) rmSync(join(releaseDirectory, entry), { force: true });
}

for (const architecture of ['arm64', 'x64']) {
  const stagingDirectory = mkdtempSync(join(tmpdir(), `droidex-sparkle-${architecture}-`));
  const appcastPath = join(stagingDirectory, `appcast-${architecture}.xml`);
  try {
    const archiveName = `droidex-${architecture}.zip`;
    copyFileSync(join(releaseDirectory, archiveName), join(stagingDirectory, archiveName));
    const previous = previousArchives(architecture);
    for (const { tag, path } of previous) {
      copyFileSync(path, join(stagingDirectory, `droidex-${architecture}-${tag}.zip`));
    }

    clearIgnoredDeltaMarkers();
    runSparkleTool(
      'generate_appcast',
      [
        '--download-url-prefix',
        `https://github.com/droidex-anas/droidex-releases/releases/download/${releaseTag}/`,
        // Only this release gets a feed item; the previous archives are delta bases.
        '--versions',
        packageVersion,
        '--maximum-deltas',
        String(maximumDeltas),
        '--link',
        'https://github.com/droidex-anas/droidex-releases/releases/latest',
        '-o',
        appcastPath,
        stagingDirectory,
      ],
      `Sparkle ${architecture} appcast generation failed`,
    );

    // Deltas are named <App><new>-<old>.delta for every architecture, and both
    // architectures upload to one flat GitHub release. Give each an architecture
    // suffix, point the feed at the new names, then re-sign the edited feed.
    const deltaNames = readdirSync(stagingDirectory).filter((entry) => entry.endsWith('.delta'));
    let appcast = readFileSync(appcastPath, 'utf8');
    for (const deltaName of deltaNames) {
      const publishedName = deltaName.replace(/\.delta$/, `-${architecture}.delta`);
      const deltaUrl = `/${releaseTag}/${encodeURIComponent(deltaName)}"`;
      if (!appcast.includes(deltaUrl)) continue;
      appcast = appcast.replace(deltaUrl, `/${releaseTag}/${encodeURIComponent(publishedName)}"`);
      copyFileSync(join(stagingDirectory, deltaName), join(releaseDirectory, publishedName));
    }
    writeFileSync(appcastPath, appcast);
    runSparkleTool('sign_update', [appcastPath], `Sparkle ${architecture} appcast signing failed`);

    copyFileSync(appcastPath, join(releaseDirectory, `appcast-${architecture}.xml`));
    process.stdout.write(
      `${architecture}: ${String(appcast.match(/sparkle:deltaFrom=/g)?.length ?? 0)} delta(s) from ${String(previous.length)} previous archive(s).\n`,
    );
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

process.stdout.write(`Generated EdDSA-signed Sparkle appcasts for ${releaseTag}.\n`);
