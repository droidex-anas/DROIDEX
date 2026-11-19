const { app } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');

// Kept in userData (not localStorage) so the first-run tour survives a cache
// clear and only ever shows once.
const ONBOARDING_VERSION = 1;

function onboardingPath() {
  return path.join(app.getPath('userData'), 'onboarding.json');
}

async function getOnboarding() {
  try {
    const raw = await fsp.readFile(onboardingPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { completed: false, version: ONBOARDING_VERSION, ...parsed };
  } catch {
    return { completed: false, version: ONBOARDING_VERSION };
  }
}

// Serialize read-modify-write so rapid fire-and-forget patches (e.g. two quick
// Settings toggles) can't both read the same old state and clobber each other.
let onboardingWriteQueue = Promise.resolve();

function setOnboarding(patch) {
  const run = onboardingWriteQueue.then(async () => {
    const current = await getOnboarding();
    const next = { ...current, ...(patch || {}), version: ONBOARDING_VERSION };
    await fsp.mkdir(path.dirname(onboardingPath()), { recursive: true });
    await fsp.writeFile(onboardingPath(), JSON.stringify(next, null, 2));
    return next;
  });
  // Keep the queue chained even if this write rejects.
  onboardingWriteQueue = run.catch(() => {});
  return run;
}

module.exports = { getOnboarding, setOnboarding };
