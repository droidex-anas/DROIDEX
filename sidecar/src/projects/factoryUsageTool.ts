import { tool } from '@factory/droid-sdk';
import { homedir } from 'node:os';
import {
  droidHome,
  droidProfileLabel,
  enabledDroidProfiles,
  type DroidProfile,
} from '../droidProfiles.js';
import { errMsg } from '../errors.js';
import { jsonResult, safeTool } from '../mcpToolUtils.js';
import { readDroidLogin } from '../providers/droid/droidLogin.js';
import {
  STANDARD_POOL,
  readFactoryAccount,
  type AfterStandard,
  type FactoryCredential,
} from '../providers/droid/factoryUsage.js';

const READ_TIMEOUT_MS = 15_000;

const AFTER_STANDARD: Record<AfterStandard, string> = {
  droid_core: 'Droid moves its threads to a Droid Core model, and back when Standard resets.',
  extra_usage: 'Its threads keep their models and spend its extra usage balance.',
  refused:
    "Its threads are refused until Standard resets. The user can choose Droid Core with /limits in that account's Droid.",
};

const STRATEGY =
  "Droid Core models (Factory's open-weight pool, such as GLM, Kimi, DeepSeek, MiniMax and Qwen) spend an account's Droid Core limits; every other model spends its Standard usage. whenStandardRunsOut says what each account does once Standard is spent. Give demanding work to accounts with Standard room, and routine work to Droid Core models. A thread stays on its account: to move work, spawn a thread on another profile and tell it what the first one did.";

type AccountProfile = 'main' | DroidProfile;

/**
 * Lets a lead see where its Droid threads have room before it picks a profile
 * for them. Each account is read with the credential its threads run on.
 */
export function factoryUsageTool(mainApiKey: () => string | undefined) {
  return tool(
    'factory_usage',
    "Read each Factory account Droid threads can run on (thread_spawn's profile): Standard and Droid Core usage per window with reset times, and what happens when Standard runs out. Read it before spreading Droid work across profiles, after a thread reports a model switch or usage limit, or when the user asks.",
    {},
    safeTool(async () => {
      const profiles: AccountProfile[] = ['main', ...enabledDroidProfiles()];
      const accounts = await Promise.all(
        profiles.map((profile) => readAccount(profile, mainApiKey())),
      );
      return jsonResult({ ok: true, now: new Date().toISOString(), accounts, note: STRATEGY });
    }),
  );
}

async function readAccount(profile: AccountProfile, apiKey: string | undefined) {
  const label = profile === 'main' ? 'Main' : droidProfileLabel(profile);
  try {
    const usage = await readFactoryAccount(
      await credential(profile, apiKey),
      AbortSignal.timeout(READ_TIMEOUT_MS),
    );
    if (usage.unavailable)
      return { profile, label, unavailable: 'Factory reports no usage windows for this account.' };
    return {
      profile,
      label,
      windows: usage.meters.map((meter) => ({
        pool: meter.model ?? STANDARD_POOL,
        window: meter.window,
        usedPercent: meter.usedPercent,
        ...(meter.resetsAt === undefined
          ? {}
          : { resetsAt: new Date(meter.resetsAt).toISOString() }),
      })),
      whenStandardRunsOut: AFTER_STANDARD[usage.afterStandard],
      ...(usage.extra?.kind === 'extra_balance'
        ? { extraUsageBalance: `$${(usage.extra.cents / 100).toFixed(2)}` }
        : {}),
    };
  } catch (error) {
    return { profile, label, unavailable: errMsg(error) };
  }
}

// Main's threads run on the API key from Settings when one is set; an Alt
// profile's always run on its own login.
async function credential(
  profile: AccountProfile,
  apiKey: string | undefined,
): Promise<FactoryCredential> {
  if (profile !== 'main') return readDroidLogin(droidHome(profile));
  return apiKey ? { apiKey } : readDroidLogin(homedir());
}
