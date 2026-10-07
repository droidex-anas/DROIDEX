// The page script (nativeBrowserPreload.cjs) runs in the preload's isolated
// world. Main calls its functions there, where the page's own scripts can
// neither see nor call them. Filled credentials become visible to the page
// through its form fields. A document the script has not reached yet
// fails the call rather than answer nothing.

const PAGE_SCRIPT_WORLD = 999;

function callPageScript(contents, name, ...args) {
  return contents.executeJavaScriptInIsolatedWorld(PAGE_SCRIPT_WORLD, [
    {
      code: `if (!globalThis.${name}) throw new Error('The page is still loading; try again.');
globalThis.${name}(...${JSON.stringify(args)})`,
    },
  ]);
}

module.exports = { callPageScript };
