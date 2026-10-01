// Developer tools for agents: running script in a page. Script can read and
// change anything the page can, including the fields the other tools keep from
// agents, so it runs only on a site the user allowed for it: that exact origin,
// asked for by name, and only until the app quits.

const MAX_RESULT_CHARS = 4_000;
const SCRIPT_MS = 5_000;

function createBrowserDevTools({
  appName,
  dialog,
  getMainWindow,
  isHostAppUrl,
  runWithWebContentsDebugger,
}) {
  const answers = new Map(); // origin -> whether the user allowed it, or the question in flight

  // Runs the script as the body of an async function in the page and gives
  // what it returns as JSON, cut to a length an agent can read. `notLate`
  // throws once the caller has given up, which the user's answer can outlast.
  async function evaluate(contents, script, notLate) {
    const origin = originOf(contents.getURL());
    if (!(await allowed(origin)))
      throw new Error(
        `The user has not allowed developer tools on ${origin}. Work with the other browser tools, or ask the user.`,
      );
    notLate();
    const { result, exceptionDetails } = await runWithWebContentsDebugger(contents, (dbg) =>
      dbg.sendCommand('Runtime.evaluate', {
        expression: guarded(origin, String(script ?? '')),
        awaitPromise: true,
        returnByValue: true,
        timeout: SCRIPT_MS,
      }),
    );
    if (exceptionDetails) {
      // The first line says what went wrong; the rest is a stack through the wrapper.
      const [what] = String(exceptionDetails.exception?.description ?? exceptionDetails.text).split(
        '\n',
      );
      throw new Error(`The script failed: ${what}`.slice(0, 1000));
    }
    const json = JSON.stringify(result.value) ?? 'undefined';
    if (json.length <= MAX_RESULT_CHARS) return json;
    return `${json.slice(0, MAX_RESULT_CHARS)}… (${String(json.length)} characters; return less)`;
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
    const { response } = await dialog.showMessageBox(getMainWindow(), {
      type: 'question',
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

// The script wrapped so that it runs only in a document of the allowed origin,
// checked in the same step as it runs, and gives the debugger back within the
// limit even when what it awaits never settles.
function guarded(origin, script) {
  return `(async (origin, ms) => {
  if (location.origin !== origin) throw new Error('the page changed before the script ran');
  const late = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('it did not finish in ' + ms / 1000 + ' s')), ms),
  );
  return Promise.race([(async () => {\n${script}\n})(), late]);
})(${JSON.stringify(origin)}, ${String(SCRIPT_MS)})`;
}

module.exports = { createBrowserDevTools };
