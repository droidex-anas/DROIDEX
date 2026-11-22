import { expect, test } from '@playwright/test';
import { openFiles, showFiles } from './filesFixture';

function pdfFixture(width = 1000): number[] {
  const stream = (width: number, height: number) =>
    `1 1 1 rg 0 0 ${width} ${height} re f\n` +
    `1 0 0 rg 0 0 60 ${height} re f\n` +
    `0 0 1 rg ${width - 60} 0 60 ${height} re f\n` +
    `0 0 0 rg BT /F1 18 Tf 5 160 Td (LEFT) Tj ET\n` +
    `BT /F1 18 Tf ${width - 58} 160 Td (RIGHT) Tj ET\n`;
  const wide = stream(width, 360);
  const portrait = stream(180, 360);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} 360] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 180 360] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${wide.length} >>\nstream\n${wide}endstream`,
    `<< /Length ${portrait.length} >>\nstream\n${portrait}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Array.from(new TextEncoder().encode(pdf));
}

test('Refresh renders updated PDF bytes on the same path', async ({ page }) => {
  await openFiles(page, { '/repo': { '': { 'edges.pdf': 'file' } } });
  const disk = await page.evaluateHandle((data) => {
    const disk = { data, reads: 0 };
    Object.assign(window.droidex, {
      filesPreview: async () => {
        disk.reads += 1;
        return {
          category: 'pdf',
          previewable: true,
          data: disk.data,
          totalSize: disk.data.length,
          sizeCapBytes: 10_000_000,
        };
      },
    });
    return disk;
  }, pdfFixture());
  const tree = await showFiles(page, 'repo-chat');
  await tree.getByRole('treeitem', { name: 'edges.pdf' }).click();
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('width', '1400');
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled();
  await disk.evaluate((disk, data) => {
    disk.data = data;
  }, pdfFixture(600));
  await page.getByRole('button', { name: 'Refresh files' }).click();
  await expect(canvas).toHaveAttribute('width', '840');
  await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeEnabled();
  await expect(page.getByText("Couldn't render this PDF", { exact: true })).toHaveCount(0);
});

test('PDF edges remain reachable and fitting pages stay centered', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-06-01T12:00:00Z'));
  await openFiles(page, { '/repo': { '': { 'edges.pdf': 'file' } } });
  await page.evaluate((data) => {
    Object.assign(window.droidex, {
      filesPreview: async () => ({
        category: 'pdf',
        previewable: true,
        data,
        totalSize: data.length,
        sizeCapBytes: 10_000_000,
        path: { root: '/repo', relative: 'edges.pdf' },
      }),
    });
  }, pdfFixture());
  const tree = await showFiles(page, 'repo-chat');
  await tree.getByRole('treeitem', { name: 'edges.pdf' }).click();
  const canvas = page.locator('canvas');
  const next = page.getByRole('button', { name: 'Next page', exact: true });
  await expect(canvas).toHaveAttribute('width', '1400');
  await expect(next).toBeEnabled();
  const measure = () =>
    canvas.evaluate((element) => {
      const scroller = element.parentElement!;
      const item = element.getBoundingClientRect();
      const pane = scroller.getBoundingClientRect();
      return {
        width: item.width,
        height: item.height,
        paneWidth: pane.width,
        left: item.left - pane.left,
        right: item.right - pane.right,
        scrollLeft: scroller.scrollLeft,
      };
    });
  await canvas.evaluate((element) => {
    element.parentElement!.scrollLeft = 0;
  });
  const left = await measure();
  expect(left.width).toBeGreaterThan(left.paneWidth);
  expect(left.left).toBeGreaterThanOrEqual(-1);
  expect(Math.abs(left.height - (left.width * 360) / 1000)).toBeLessThanOrEqual(2);
  await canvas.evaluate((element) => {
    element.parentElement!.scrollLeft = element.parentElement!.scrollWidth;
  });
  const right = await measure();
  expect(right.scrollLeft).toBeGreaterThan(0);
  expect(right.right).toBeLessThanOrEqual(1);
  await next.click();
  await expect(canvas).toHaveAttribute('width', '251');
  await expect(next).toBeDisabled();
  const fitting = await measure();
  expect(fitting.width).toBeLessThan(fitting.paneWidth);
  expect(Math.abs(fitting.left + fitting.right)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(canvas).toHaveAttribute('width', '1400');
});
