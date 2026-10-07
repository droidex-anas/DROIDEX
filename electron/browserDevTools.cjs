// Developer tools for agents: running script in a page. Script can read and
// change anything the page can, including the fields the other tools keep from
// agents, so it runs only on a site the user allowed for it: that exact origin,
// asked for by name, and only until the app quits.

const MAX_RESULT_CHARS = 4_000;
const SCRIPT_MS = 5_000;

function createBrowserDevTools({ appName, showPrompt, isHostAppUrl, runWithWebContentsDebugger }) {
  const answers = new Map(); // origin -> whether the user allowed it, or the question in flight

  // Runs the script as the body of an async function in the page and gives
  // what it returns as JSON, cut to a length an agent can read. `stillWanted`
  // throws once the caller has given up or the guest has gone, either of which
  // the user's answer or the debugger's queue can outlast.
  async function evaluate(contents, script, stillWanted) {
    const origin = originOf(contents.getURL());
    if (!(await allowed(origin)))
      throw new Error(
        `The user has not allowed developer tools on ${origin}. Work with the other browser tools, or ask the user.`,
      );
    const outcome = await runWithWebContentsDebugger(contents, (dbg) => {
      stillWanted();
      return withinLimit(dbg, guarded(origin, String(script ?? '')));
    });
    // No answer at all: the guest was gone before its turn came.
    if (!outcome) throw new Error('The browser page closed.');
    const { result, exceptionDetails } = outcome;
    if (exceptionDetails) {
      // The first line says what went wrong; the rest is a stack through the wrapper.
      const [what] = String(exceptionDetails.exception?.description ?? exceptionDetails.text).split(
        '\n',
      );
      throw new Error(`The script failed: ${what}`.slice(0, 1000));
    }
    // The page hands over the start of the JSON and how long the whole was. It
    // is the page's own word, so neither is trusted to be what it should be.
    const [start, length] = Array.isArray(result.value) ? result.value : [];
    if (typeof start !== 'string') return 'undefined';
    const json = start.slice(0, MAX_RESULT_CHARS);
    return Number(length) > MAX_RESULT_CHARS
      ? `${json}… (${String(Number(length))} characters; return less)`
      : json;
  }

  // Only a web page's own origin, never the app's.
  function originOf(url) {
    const { protocol, origin } = new URL(url);
    if (!['http:', 'https:'].includes(protocol) || isHostAppUrl(url))
      throw new Error('Developer tools work only on web pages.');
    return origin;
  }

  // Asked once per origin and run of the app; a second caller waits on the
  // same question.
  function allowed(origin) {
    if (!answers.has(origin)) answers.set(origin, ask(origin));
    return answers.get(origin);
  }

  async function ask(origin) {
    const { response } = await showPrompt({
      kind: 'permission',
      buttons: ['Allow until I quit', "Don't allow"],
      defaultId: 1,
      cancelId: 1,
      title: 'Developer tools',
      message: `Let agents run JavaScript on ${origin}?`,
      detail: `A script can read and change anything this site's pages can, including what ${appName} otherwise keeps from agents, such as passwords in fields. It applies to this site only, until you quit ${appName}.`,
    });
    return response === 0;
  }

  return { evaluate };
}

// Sends the wrapped script. What it awaits is timed inside the page; a script
// that keeps the page busy past that is stopped from here.
async function withinLimit(dbg, expression) {
  const stop = setTimeout(() => {
    dbg.sendCommand('Runtime.terminateExecution').catch(() => undefined);
  }, SCRIPT_MS + 1_000);
  try {
    return await dbg.sendCommand('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: SCRIPT_MS,
    });
  } finally {
    clearTimeout(stop);
  }
}

// The wrapper around a script. The script goes in as text and is compiled
// inside it, after the origin check and in the same step, so nothing in the
// script can run in a document of another origin or change the wrapper. The
// result is turned to JSON there, as the page would, and cut there, so a huge
// one never crosses to the app. What the script awaits is raced against a
// timer so a promise that never settles ends in time. Work the script left
// behind goes on in the page, like any script of the page.
function guarded(origin, script) {
  return `(async (origin, ms, max, body) => {
  if (location.origin !== origin) throw new Error('the page changed before the script ran');
  const run = new (async () => {}).constructor(body);
  const late = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('it did not finish in ' + ms / 1000 + ' s')), ms),
  );
  const json = JSON.stringify(await Promise.race([run(), late]));
  return typeof json === 'string' ? [json.slice(0, max), json.length] : [];
})(${JSON.stringify(origin)}, ${String(SCRIPT_MS)}, ${String(MAX_RESULT_CHARS)}, ${JSON.stringify(script)})`;
}

module.exports = { createBrowserDevTools };
