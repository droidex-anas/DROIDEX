// Which elements a write changed, read from the source of the revision it
// replaced and the source it wrote. An element's id is minted per revision, so
// its source text is what carries over from one revision to the next.

import type { SourceElement, SourceFiles } from './protocol';

/**
 * The elements of the written revision whose source the revision before held
 * nowhere word for word, in source order. Each is the innermost such: an
 * element that holds another changed one changed with it, so it is left out.
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
  return changed.filter(
    (outer) =>
      !changed.some(
        (inner) =>
          inner !== outer &&
          inner.file === outer.file &&
          outer.start <= inner.start &&
          inner.end <= outer.end,
      ),
  );
}
