import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { hasCliLogin } from './Environment.js';

export const DROID_PROFILE_SCOPE_PREFIX = 'session.droid-profile:';

export function altDroidHome(): string | undefined {
  const home = process.env.DROIDEX_ALT_HOME;
  if (!home) return undefined;
  if (!isAbsolute(home)) throw new Error('DROIDEX_ALT_HOME must be an absolute path.');
  return home;
}

export function droidHome(profile?: 'alt'): string {
  if (profile === undefined) return homedir();
  const home = altDroidHome();
  if (!home)
    throw new Error('Alt threads are disabled. Set DROIDEX_ALT_HOME locally to enable them.');
  const factory = join(home, '.factory');
  const mainFactory = join(homedir(), '.factory');
  if (!existsSync(home) || !hasCliLogin(factory))
    throw new Error('Alt login is missing. Sign in through your isolated droid-alt command first.');
  if (
    realpathSync(home) === realpathSync(homedir()) ||
    (existsSync(mainFactory) && realpathSync(factory) === realpathSync(mainFactory))
  )
    throw new Error('DROIDEX_ALT_HOME must use a separate Factory login directory.');
  for (const marker of ['auth.v2.key', 'auth.v2.loginkeychain']) {
    const alt = join(factory, marker);
    const main = join(mainFactory, marker);
    if (existsSync(alt) && existsSync(main) && realpathSync(alt) === realpathSync(main))
      throw new Error('The Alt profile must not share Main’s authentication files.');
  }
  return home;
}
