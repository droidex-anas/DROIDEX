import { repoPathInProse } from './prosePaths';

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

const SPACES_ONLY = /^[ \t]+$/;

function isInlineCode(node: MarkdownNode | undefined): node is MarkdownNode & { value: string } {
  return node?.type === 'inlineCode' && typeof node.value === 'string';
}

function joinRuns(parent: MarkdownNode): void {
  const children = parent.children;
  if (!children) return;
  for (const child of children) joinRuns(child);
  let index = 0;
  while (index < children.length - 2) {
    const first = children[index];
    const gap = children[index + 1];
    const next = children[index + 2];
    const joins =
      isInlineCode(first) &&
      gap.type === 'text' &&
      SPACES_ONLY.test(gap.value ?? '') &&
      isInlineCode(next) &&
      repoPathInProse(first.value) === null &&
      repoPathInProse(next.value) === null;
    if (!joins) {
      index += 1;
      continue;
    }
    first.value = `${first.value} ${next.value}`;
    children.splice(index + 1, 2);
  }
}

/**
 * Joins inline code spans separated only by spaces (`git` `fetch` `origin`)
 * into one span. A model often backticks each word of one command, and drawn
 * as separate chips the run reads as a single bar broken at every space. File
 * mentions keep their own chip, since each one opens in Review.
 */
export function remarkInlineCodeRuns() {
  return joinRuns;
}
