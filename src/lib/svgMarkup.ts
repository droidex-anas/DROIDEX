// Prepares SVG markup from a code block for inline rendering: wraps bare inner
// markup in an <svg> root, drops fixed pixel sizes so it scales to its
// container, and makes sure the SVG namespace is declared.
export function fitSvgMarkup(content: string): string {
  let raw = content.trim();
  if (!raw.startsWith('<svg')) {
    raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="100%">${raw}</svg>`;
  }
  raw = raw.replace(/width="\d+(?:px)?"/gi, 'width="100%"');
  raw = raw.replace(/height="\d+(?:px)?"/gi, '');
  if (!raw.includes('xmlns=')) {
    raw = raw.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return raw;
}
