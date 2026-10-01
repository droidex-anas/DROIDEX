// Text from the accessibility tree, as agents read it.

const vm = require('node:vm');

const REGEX_TIME_LIMIT_MS = 250;
const TEXT_ROLES = new Set(['StaticText', 'text']);

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Which lines match plain text, or a /regex/flags. An agent's pattern runs on
// the main thread, so it runs under a time limit; flags that make a regex
// stateful are dropped.
function matcher(query) {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(String(query));
  if (!regex) {
    const needle = String(query).toLowerCase();
    return (texts) => texts.map((text) => text.toLowerCase().includes(needle));
  }
  const pattern = new RegExp(regex[1], regex[2].replace(/[gy]/g, ''));
  return (texts) => {
    try {
      return vm.runInNewContext(
        'texts.map((text) => pattern.test(text))',
        { texts, pattern },
        {
          timeout: REGEX_TIME_LIMIT_MS,
        },
      );
    } catch {
      throw new Error('That /regex/ took too long; search for plain text or a simpler pattern.');
    }
  };
}

module.exports = { cleanText, matcher, TEXT_ROLES };
