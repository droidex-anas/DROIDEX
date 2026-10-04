// Prepares SVG markup from a code block for inline rendering: wraps bare inner
// markup in an <svg> root, drops fixed pixel sizes so it scales to its
// container, and makes sure the SVG namespace is declared.
export function fitSvgMarkup(content: string): string {
  let raw = content.trim();
  if (!raw.startsWith('<svg')) {
    raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="100%">${raw}</svg>`;
  }
  // Only the root's fixed size goes; child shapes keep their own geometry.
  raw = raw.replace(/<svg\b[^>]*>/i, (tag) =>
    tag.replace(/\swidth="\d+(?:px)?"/i, ' width="100%"').replace(/\sheight="\d+(?:px)?"/i, ''),
  );
  if (!raw.includes('xmlns=')) {
    raw = raw.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return raw;
}
