import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readDevinApiKey } from './devinCredentials.js';

test(
  'Devin credentials respect XDG_DATA_HOME',
  { skip: process.platform === 'win32' },
  async (t) => {
    const xdg = await mkdtemp(join(tmpdir(), 'devin-xdg-'));
    const previous = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = xdg;
    t.after(async () => {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
      await rm(xdg, { recursive: true, force: true });
    });
    await mkdir(join(xdg, 'devin'), { recursive: true });
    await writeFile(join(xdg, 'devin', 'credentials.toml'), 'windsurf_api_key = "test-key"\n');
    assert.equal(await readDevinApiKey(), 'test-key');
  },
);

test(
  'Devin credentials prefer WINDSURF_API_KEY over the stored login',
  { skip: process.platform === 'win32' },
  async (t) => {
    const xdg = await mkdtemp(join(tmpdir(), 'devin-xdg-'));
    const previousXdg = process.env.XDG_DATA_HOME;
    const previousKey = process.env.WINDSURF_API_KEY;
    process.env.XDG_DATA_HOME = xdg;
    process.env.WINDSURF_API_KEY = 'environment-key';
    t.after(async () => {
      if (previousXdg === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousXdg;
      if (previousKey === undefined) delete process.env.WINDSURF_API_KEY;
      else process.env.WINDSURF_API_KEY = previousKey;
      await rm(xdg, { recursive: true, force: true });
    });
    await mkdir(join(xdg, 'devin'), { recursive: true });
    await writeFile(join(xdg, 'devin', 'credentials.toml'), 'windsurf_api_key = "stored-key"\n');
    assert.equal(await readDevinApiKey(), 'environment-key');
  },
);
