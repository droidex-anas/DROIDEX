import { expect, test } from '@playwright/test';
import { openFiles, showFiles } from './filesFixture';

for (const fallback of ['ancestor', 'empty', 'error'] as const) {
  test(`keyboard preview close recovers to the ${fallback} tree`, async ({ page }) => {
    await openFiles(page, { '/repo': { '': { src: 'directory' }, src: { 'index.ts': 'file' } } });
    const tree = await showFiles(page, 'repo-chat');
    const folder = tree.getByRole('treeitem', { name: 'src', exact: true });
    await folder.click();
    await tree.getByRole('treeitem', { name: 'index.ts' }).click();
    if (fallback === 'ancestor') await folder.click();
    else {
      await page.evaluate(() => {
        window.filesDisk['/repo'][''] = {};
      });
      await page.getByRole('button', { name: 'Refresh files' }).click();
      await expect(tree.getByRole('treeitem')).toHaveCount(0);
      if (fallback === 'error') {
        await page.evaluate(() => (window.filesFailing = ['/repo:']));
        await page.getByRole('button', { name: 'Refresh files' }).click();
        await expect(tree.getByText('/repo: failed')).toBeVisible();
      }
    }
    await page.getByRole('button', { name: 'Close file', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(fallback === 'ancestor' ? folder : tree).toBeFocused();
  });
}

test('pointer preview close does not move focus into the tree', async ({ page }) => {
  await openFiles(page, { '/repo': { '': { 'first.ts': 'file' } } });
  const tree = await showFiles(page, 'repo-chat');
  await tree.getByRole('treeitem', { name: 'first.ts' }).click();
  await page.getByRole('button', { name: 'Close file', exact: true }).click();
  await expect(page.getByText('Select a file to preview.', { exact: true })).toBeVisible();
  await expect(tree.locator(':focus')).toHaveCount(0);
});

test('keyboard preview close returns to the selected row and arrow navigation continues', async ({
  page,
}) => {
  await openFiles(page, { '/repo': { '': { 'first.ts': 'file', 'second.ts': 'file' } } });
  const tree = await showFiles(page, 'repo-chat');
  const first = tree.getByRole('treeitem', { name: 'first.ts' });
  await first.click();
  await expect(page.getByText('Preview of first.ts', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close file', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(tree.getByRole('treeitem', { name: 'second.ts' })).toBeFocused();
});

test('keyboard preview close keeps a hidden tree hidden and focuses its toggle', async ({
  page,
}) => {
  await openFiles(page, { '/repo': { '': { 'first.ts': 'file' } } });
  const tree = await showFiles(page, 'repo-chat');
  await tree.getByRole('treeitem', { name: 'first.ts' }).click();
  await page.getByRole('button', { name: 'Hide file tree' }).click();
  await page.getByRole('button', { name: 'Close file', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Show file tree' })).toBeFocused();
  await expect(page.locator('#files-workspace-tree')).toHaveAttribute('inert', '');
});

test('the files tree is one Tab stop with native activation and arrow navigation', async ({
  page,
}) => {
  await openFiles(page, {
    '/repo': {
      '': { src: 'directory', 'README.md': 'file' },
      src: { nested: 'directory', 'index.ts': 'file' },
      'src/nested': { 'child.ts': 'file' },
    },
  });
  const tree = await showFiles(page, 'repo-chat');
  const folder = tree.getByRole('treeitem', { name: 'src', exact: true });
  const nested = tree.getByRole('treeitem', { name: 'nested', exact: true });
  const child = tree.getByRole('treeitem', { name: 'child.ts', exact: true });
  const readme = tree.getByRole('treeitem', { name: 'README.md' });
  await page.getByRole('button', { name: 'Refresh files' }).focus();
  await page.keyboard.press('Tab');
  await expect(folder).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(readme).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(readme).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(folder).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(nested).toBeFocused();
  await page.keyboard.press('Space');
  await expect(child).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(child).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Preview of src/nested/child.ts', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(nested).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(nested).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('End');
  await expect(readme).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(tree.getByRole('treeitem', { name: 'index.ts' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(folder).toBeFocused();
  await page.keyboard.press('Control+ArrowDown');
  await expect(folder).toBeFocused();
  await expect(tree.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close file', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(folder).toBeFocused();
  await readme.click();
  await expect(page.getByText('Preview of README.md', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide file tree' }).click();
  await expect(page.locator('#files-workspace-tree')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(tree.getByRole('treeitem')).toHaveCount(0);
  await expect(page.locator('#files-workspace-tree :focus')).toHaveCount(0);
});

test('removed focused rows recover to a visible ancestor without stealing outside focus', async ({
  page,
}) => {
  await openFiles(page, {
    '/repo': { '': { src: 'directory', 'README.md': 'file' }, src: { 'index.ts': 'file' } },
  });
  const tree = await showFiles(page, 'repo-chat');
  const folder = tree.getByRole('treeitem', { name: 'src', exact: true });
  const file = tree.getByRole('treeitem', { name: 'index.ts' });
  await folder.click();
  await page.keyboard.press('ArrowRight');
  await expect(file).toBeFocused();
  // Keep the descendant DOM-focused while a pointer collapses its ancestor.
  await folder.evaluate((row) =>
    row.addEventListener('mousedown', (event) => event.preventDefault(), { once: true }),
  );
  await folder.click();
  await expect(folder).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(file).toBeFocused();
  await page.evaluate(() => {
    window.filesHeld.push('/repo:src');
    window.filesDisk['/repo'].src = {};
  });
  await page.getByRole('button', { name: 'Refresh files' }).click();
  await page.keyboard.press('Tab');
  await expect(file).toBeFocused();
  await page.evaluate(() => window.releaseFiles());
  await expect(file).toHaveCount(0);
  await expect(folder).toBeFocused();
  await page.evaluate(() => (window.filesDisk['/repo'][''] = {}));
  await page.getByRole('button', { name: 'Refresh files' }).click();
  await expect(tree.getByRole('treeitem')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh files' })).toBeFocused();
});

test('removing a row after clicking the preview does not restore tree focus', async ({ page }) => {
  await openFiles(page, {
    '/repo': { '': { src: 'directory', 'README.md': 'file' }, src: { 'index.ts': 'file' } },
  });
  const tree = await showFiles(page, 'repo-chat');
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  const file = tree.getByRole('treeitem', { name: 'index.ts' });
  await expect(file).toBeFocused();
  await page.evaluate(() => {
    window.filesHeld.push('/repo:src');
    window.filesDisk['/repo'].src = {};
  });
  await page.getByRole('button', { name: 'Refresh files' }).click();
  await page.keyboard.press('Tab');
  await expect(file).toBeFocused();
  await page.getByText('Select a file to preview.', { exact: true }).click();
  await expect(page.locator('body')).toBeFocused();
  await page.evaluate(() => window.releaseFiles());
  await expect(file).toHaveCount(0);
  await expect(page.locator('body')).toBeFocused();
  await expect(tree.locator(':focus')).toHaveCount(0);
});
