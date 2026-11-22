import { expect, test, type Page } from '@playwright/test';
import { sessionSummary } from '../../src/test/sessionSummary';
import { openFiles, showFiles } from './filesFixture';

const refresh = (page: Page) => page.getByRole('button', { name: 'Refresh files' }).click();

test('Refresh preserves the text scroll container and reading position', async ({ page }) => {
  await openFiles(page, { '/repo': { '': { 'notes.txt': 'file' } } });
  const disk = await page.evaluateHandle(() => {
    const disk = { text: Array.from({ length: 300 }, (_, i) => `Line ${i}`).join('\n'), reads: 0 };
    Object.assign(window.droidex, {
      filesPreview: async () => {
        disk.reads += 1;
        return {
          category: 'text',
          previewable: true,
          text: disk.text,
          totalSize: disk.text.length,
          sizeCapBytes: 250_000,
        };
      },
    });
    return disk;
  });
  const tree = await showFiles(page, 'repo-chat');
  await tree.getByRole('treeitem', { name: 'notes.txt' }).click();
  const code = page.locator('pre').filter({ hasText: 'Line 299' });
  await expect(code).toBeVisible();
  const scroller = await code.evaluateHandle((element) => element.parentElement!);
  await scroller.evaluate((element) => {
    element.scrollTop = 400;
  });
  for (const changed of [false, true]) {
    const reads = await disk.evaluate((disk, changed) => {
      if (changed) disk.text += '\nAppended line';
      return disk.reads;
    }, changed);
    await refresh(page);
    await expect.poll(() => disk.evaluate((disk) => disk.reads)).toBe(reads + 1);
    if (changed) await expect(code).toContainText('Appended line');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await scroller.evaluate((element) => ({
        connected: element.isConnected,
        top: element.scrollTop,
      })),
    ).toEqual({ connected: true, top: 400 });
  }
});

test('Refresh rereads the selected file without hiding its preview', async ({ page }) => {
  await openFiles(page, { '/repo': { '': { 'notes.txt': 'file' } } });
  const disk = await page.evaluateHandle(() => {
    const disk = { text: 'Original disk content', reads: 0, release: () => {} };
    Object.assign(window.droidex, {
      filesPreview: async () => {
        disk.reads += 1;
        const text = disk.text;
        if (text !== 'Original disk content') {
          await new Promise<void>((resolve) => {
            disk.release = resolve;
          });
        }
        return {
          category: 'text',
          previewable: true,
          text,
          totalSize: text.length,
          sizeCapBytes: 250_000,
        };
      },
    });
    return disk;
  });
  const tree = await showFiles(page, 'repo-chat');
  await tree.getByRole('treeitem', { name: 'notes.txt' }).click();
  await expect(page.getByText('Original disk content', { exact: true })).toBeVisible();
  const reads = await disk.evaluate((disk) => disk.reads);
  await disk.evaluate((disk) => {
    disk.text = 'Updated disk content';
  });
  await refresh(page);
  await expect.poll(() => disk.evaluate((disk) => disk.reads)).toBe(reads + 1);
  await expect(page.getByText('Original disk content', { exact: true })).toBeVisible();
  await disk.evaluate((disk) => disk.release());
  await expect(page.getByText('Updated disk content', { exact: true })).toBeVisible();
  expect(await disk.evaluate((disk) => disk.reads)).toBe(reads + 1);
});

test('Refresh replaces stale text with read failures and empty files', async ({ page }) => {
  await openFiles(page, { '/repo': { '': { 'notes.txt': 'file' } } });
  const disk = await page.evaluateHandle(() => {
    const disk = { text: 'Original disk content', fail: false, reads: 0 };
    Object.assign(window.droidex, {
      filesPreview: async () => {
        disk.reads += 1;
        if (disk.fail) throw new Error('File no longer readable');
        return {
          category: 'text',
          previewable: true,
          text: disk.text,
          totalSize: disk.text.length,
          sizeCapBytes: 250_000,
        };
      },
    });
    return disk;
  });
  const tree = await showFiles(page, 'repo-chat');
  await tree.getByRole('treeitem', { name: 'notes.txt' }).click();
  await expect(page.getByText('Original disk content', { exact: true })).toBeVisible();
  await disk.evaluate((disk) => {
    disk.fail = true;
  });
  await refresh(page);
  await expect(page.getByText('File no longer readable', { exact: true })).toBeVisible();
  await expect(page.getByText('Original disk content', { exact: true })).toHaveCount(0);
  const reads = await disk.evaluate((disk) => disk.reads);
  await disk.evaluate((disk) => {
    disk.fail = false;
    disk.text = '';
  });
  await refresh(page);
  await expect.poll(() => disk.evaluate((disk) => disk.reads)).toBe(reads + 1);
  await expect(page.getByText('File no longer readable', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Original disk content', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Loading preview…', { exact: true })).toHaveCount(0);
});

test('a pending preview refresh cannot replace another file or root', async ({ page }) => {
  const emit = await openFiles(page, {
    '/repo': { '': { 'notes.txt': 'file', 'other.txt': 'file' } },
    '/other': { '': { 'other.txt': 'file' } },
  });
  const disk = await page.evaluateHandle(() => {
    const disk = { hold: false, reads: 0, release: () => {} };
    Object.assign(window.droidex, {
      filesPreview: async (root: string, relative: string) => {
        disk.reads += 1;
        if (disk.hold) {
          disk.hold = false;
          await new Promise<void>((resolve) => {
            disk.release = resolve;
          });
        }
        return {
          category: 'text',
          previewable: true,
          text: `${root}/${relative}`,
          totalSize: 20,
          sizeCapBytes: 250_000,
        };
      },
    });
    return disk;
  });
  const tree = await showFiles(page, 'repo-chat');
  await tree.getByRole('treeitem', { name: 'notes.txt' }).click();
  await expect(page.getByText('/repo/notes.txt', { exact: true })).toBeVisible();
  for (const switchRoot of [false, true]) {
    const reads = await disk.evaluate((disk) => {
      disk.hold = true;
      return disk.reads;
    });
    await refresh(page);
    await expect.poll(() => disk.evaluate((disk) => disk.reads)).toBe(reads + 1);
    if (switchRoot) {
      emit({
        type: 'session.updated',
        session: sessionSummary('repo-chat', { cwd: '/other', updatedAt: 9 }),
      });
    } else {
      await tree.getByRole('treeitem', { name: 'other.txt' }).click();
    }
    const text = switchRoot ? '/other/other.txt' : '/repo/other.txt';
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await disk.evaluate((disk) => disk.release());
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByText('/repo/notes.txt', { exact: true })).toHaveCount(0);
  }
});

test('Refresh reloads expanded folders and keeps them open', async ({ page }) => {
  await openFiles(page, {
    '/repo': { '': { src: 'directory', 'README.md': 'file' }, src: { 'before.ts': 'file' } },
  });
  const tree = await showFiles(page, 'repo-chat');
  const folder = tree.getByRole('treeitem', { name: 'src' });
  await folder.click();
  await expect(tree.getByRole('treeitem', { name: 'before.ts' })).toBeVisible();

  await page.evaluate(() => {
    const repo = window.filesDisk['/repo'];
    repo[''] = { ...repo[''], 'added.md': 'file' };
    repo.src = { 'after.ts': 'file' };
  });
  await refresh(page);

  await expect(tree.getByRole('treeitem')).toHaveText(['src', 'after.ts', 'README.md', 'added.md']);
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
});

test('Refresh retries a failed first load', async ({ page }) => {
  await openFiles(page, { '/repo': { '': { 'README.md': 'file' } } });
  await page.evaluate(() => (window.filesFailing = ['authorize:/repo']));
  const tree = await showFiles(page, 'repo-chat');
  await expect(tree.getByText('authorize:/repo failed')).toBeVisible();

  await page.evaluate(() => (window.filesFailing = ['/repo:']));
  await refresh(page);
  await expect(tree.getByText('/repo: failed')).toBeVisible();

  await page.evaluate(() => (window.filesFailing = []));
  await refresh(page);
  await expect(tree.getByRole('treeitem')).toHaveText(['README.md']);
  await expect(tree.getByText('/repo: failed')).toHaveCount(0);
});

test('a refresh that settles after the workspace moves cannot replace its files', async ({
  page,
}) => {
  const emit = await openFiles(page, {
    '/repo': { '': { 'repo.md': 'file' } },
    '/other': { '': { 'other.md': 'file' } },
  });
  const tree = await showFiles(page, 'repo-chat');
  await expect(tree.getByRole('treeitem')).toHaveText(['repo.md']);

  await page.evaluate(() => {
    window.filesDisk['/repo'][''] = { 'stale.md': 'file' };
    window.filesHeld.push('/repo:');
  });
  await refresh(page);
  emit({
    type: 'session.updated',
    session: sessionSummary('repo-chat', { cwd: '/other', updatedAt: 9 }),
  });
  await expect(tree.getByRole('treeitem')).toHaveText(['other.md']);

  await page.evaluate(() => window.releaseFiles());
  await expect(tree.getByRole('treeitem')).toHaveText(['other.md']);
});
