import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeDevinTestCredentials } from './devinAcpCli.js';

test('Devin test credentials refuse an unisolated home', async (t) => {
  const names = [
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'XDG_DATA_HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
  ] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const parent = await mkdtemp(join(tmpdir(), 'devin-credential-guard-'));
  const outsideHome = join(parent, 'home');
  const approvedTemp = join(parent, 'tmp');
  await mkdir(outsideHome);
  await mkdir(approvedTemp);
  t.after(() => rm(parent, { recursive: true, force: true }));
  process.env.HOME = outsideHome;
  process.env.USERPROFILE = outsideHome;
  process.env.TMPDIR = approvedTemp;
  process.env.TEMP = approvedTemp;
  process.env.TMP = approvedTemp;
  delete process.env.APPDATA;
  delete process.env.XDG_DATA_HOME;
  t.after(() => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  await assert.rejects(writeDevinTestCredentials(), /outside the isolated test home/);
});
