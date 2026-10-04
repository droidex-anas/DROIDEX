import { closesFence, openingFence, type OpenFence } from './markdownBlockScan';

export interface MarkdownAppFence {
  complete: boolean;
  // 1-based line of the opening fence, matching the positions remark reports,
  // so a renderer can tell one fence from another without counting renders.
  startLine: number;
}

export function appFencesInMarkdown(markdown: string): MarkdownAppFence[] {
  const fences: MarkdownAppFence[] = [];
  let open: { fence: OpenFence; startLine: number } | null = null;

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    if (open) {
      if (closesFence(line, open.fence)) {
        if (open.fence.info === 'app') fences.push({ complete: true, startLine: open.startLine });
        open = null;
      }
      continue;
    }
    const fence = openingFence(line);
    if (fence) open = { fence, startLine: index + 1 };
  }

  if (open?.fence.info === 'app') fences.push({ complete: false, startLine: open.startLine });
  return fences;
}

export function hasAppBlock(markdown: string): boolean {
  return appFencesInMarkdown(markdown).length > 0;
}

export function hasCompleteAppBlock(markdown: string): boolean {
  return appFencesInMarkdown(markdown).some((fence) => fence.complete);
}

export function hasIncompleteAppBlock(markdown: string): boolean {
  return appFencesInMarkdown(markdown).some((fence) => !fence.complete);
}
