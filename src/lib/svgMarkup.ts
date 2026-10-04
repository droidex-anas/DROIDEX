// Prepares SVG markup from a code block for image rendering: wraps bare inner
// markup in an <svg> root, drops fixed pixel sizes so it scales to its
// container, and makes sure the SVG namespace is declared.
export function fitSvgMarkup(content: string): string {
  let raw = content.trim();
  if (!raw.startsWith('<svg')) {
    raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="100%">${raw}</svg>`;
  }
  // Only the root's fixed size goes; child shapes keep their own geometry.
  raw = raw.replace(/<svg\b[^>]*>/i, (tag) => {
    const fitted = tag
      .replace(/\swidth="\d+(?:px)?"/i, ' width="100%"')
      .replace(/\sheight="\d+(?:px)?"/i, '');
    return /\sxmlns\s*=/.test(fitted)
      ? fitted
      : fitted.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  });
  return raw;
}

// Reads authored plain-text metadata; this is not a complete XML parser.
export function svgImageAlternative(content: string): string {
  const descriptions = ['title', 'desc'].flatMap((tag) => {
    const text = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, 'i')
      .exec(content)?.[1]
      ?.replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? [text] : [];
  });
  return descriptions.join('. ') || 'SVG diagram';
}
