// Which elements a write changed, read from the source of the revision it
// replaced and the source it wrote. An element's id is minted per revision, so
// its source text is what carries over from one revision to the next.

import type { SourceElement, SourceFiles } from './protocol';

/**
 * The elements of the written revision whose source the revision before held
 * nowhere word for word, in source order, keeping only the innermost: one that
 * holds another changed element is left out even when its own markup changed
 * too, so a tour visits the smallest regions that changed. `elements` is in
 * the build's order, by file and then by start.
 */
export function changedElements(
  elements: readonly SourceElement[],
  before: SourceFiles,
  after: SourceFiles,
): SourceElement[] {
  const earlier = Object.values(before);
  const changed = elements.filter((element) => {
    const written = after[element.file].slice(element.start, element.end);
    return !earlier.some((source) => source.includes(written));
  });
  // In source order an element's descendants follow it at once, so it holds
  // a changed one exactly when the next changed element starts inside it.
  return changed.filter((element, index) => {
    const next = changed.at(index + 1);
    const holdsNext = next?.file === element.file && next.start < element.end;
    return !holdsNext;
  });
}
