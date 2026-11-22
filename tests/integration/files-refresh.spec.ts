import { expect, test, type Page } from '@playwright/test';
import { sessionSummary } from '../../src/test/sessionSummary';
import { openFiles, showFiles } from './filesFixture';

const refresh = (page: Page) => page.getByRole('button', { name: 'Refresh files' }).click();

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
