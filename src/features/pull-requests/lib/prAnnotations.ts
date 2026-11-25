import { diffLineAnchorKey, type DiffLineSide } from '../../../lib/unifiedDiff';
import type { PullRequest } from '../../../types/vcs';

// Review annotations are the reader's own line-anchored notes on a pull
// request diff: local drafts, never posted to GitHub. They live next to the
// diff lines they point at, and the whole set is what "Send to Droid" turns
// into a seeded chat prompt.

export interface PrLineAnnotation {
  id: string;
  path: string;
  side: DiffLineSide;
  line: number;
  // The annotated diff line's text without its +/- marker, captured at
  // annotation time so the note still reads when the diff moves on.
  code: string;
  body: string;
}

export interface PrReviewDraft {
  annotations: PrLineAnnotation[];
  viewedFiles: string[];
}

export const emptyPrReviewDraft: PrReviewDraft = { annotations: [], viewedFiles: [] };

export const ANNOTATION_LIMIT = 100;
const ANNOTATION_BODY_MAX = 4000;

export function addAnnotation(
  draft: PrReviewDraft,
  input: Omit<PrLineAnnotation, 'id'>,
): PrReviewDraft {
  const body = input.body.trim();
  if (!body || body.length > ANNOTATION_BODY_MAX) return draft;
  if (input.line < 1 || !input.path) return draft;
  if (draft.annotations.length >= ANNOTATION_LIMIT) return draft;
  // One note per line: annotating a line that already has one edits it.
  const existing = draft.annotations.find(
    (item) =>
      item.path === input.path &&
      diffLineAnchorKey(item.side, item.line) === diffLineAnchorKey(input.side, input.line),
  );
  if (existing) {
    return {
      ...draft,
      annotations: draft.annotations.map((item) =>
        item.id === existing.id ? { ...item, body } : item,
      ),
    };
  }
  const annotation: PrLineAnnotation = { ...input, body, id: crypto.randomUUID() };
  return { ...draft, annotations: [...draft.annotations, annotation] };
}

export function updateAnnotationBody(
  draft: PrReviewDraft,
  id: string,
  body: string,
): PrReviewDraft {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > ANNOTATION_BODY_MAX) return draft;
  if (!draft.annotations.some((item) => item.id === id)) return draft;
  return {
    ...draft,
    annotations: draft.annotations.map((item) =>
      item.id === id ? { ...item, body: trimmed } : item,
    ),
  };
}

export function removeAnnotation(draft: PrReviewDraft, id: string): PrReviewDraft {
  if (!draft.annotations.some((item) => item.id === id)) return draft;
  return { ...draft, annotations: draft.annotations.filter((item) => item.id !== id) };
}

export function toggleViewedFile(draft: PrReviewDraft, path: string): PrReviewDraft {
  if (!path) return draft;
  return draft.viewedFiles.includes(path)
    ? { ...draft, viewedFiles: draft.viewedFiles.filter((item) => item !== path) }
    : { ...draft, viewedFiles: [...draft.viewedFiles, path] };
}

// Annotations belong to lines of one file, in the order a reviewer meets
// them: file by file, top to bottom.
export function orderedAnnotations(annotations: readonly PrLineAnnotation[]): PrLineAnnotation[] {
  return [...annotations].sort((left, right) => {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1;
    return left.line - right.line;
  });
}

function sideLabel(annotation: PrLineAnnotation): string {
  return annotation.side === 'old' ? 'removed side' : 'new side';
}

// The prompt the review chat opens with. `path:line` is the format agents
// parse best, so new-side notes lead with it; old-side notes name the file
// and say the line is gone, since that number does not exist in the checkout.
export function formatAnnotationsForPrompt(
  pr: PullRequest,
  annotations: readonly PrLineAnnotation[],
): string {
  const title = pr.title.trim();
  const heading = title
    ? `Pull request #${String(pr.number)}: ${title}`
    : `Pull request #${String(pr.number)}`;
  const url = pr.url.trim();
  const notes = annotations
    .map((item, index) => {
      const location =
        item.side === 'new'
          ? `${item.path}:${String(item.line)}`
          : `${item.path} line ${String(item.line)} (${sideLabel(item)})`;
      const code = item.code.trimEnd();
      return [
        `${String(index + 1)}. ${location}`,
        code ? `\`${code.length > 200 ? `${code.slice(0, 200)}…` : code}\`` : null,
        item.body,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
  return [
    heading,
    url || null,
    '',
    'I read the diff and annotated lines on it. Go through each note: answer the question it asks, or make the change it describes.',
    '',
    notes,
    '',
  ]
    .filter((part) => part !== null)
    .join('\n');
}
