const { browserApproval } = require('./browserApproval.cjs');

const ACTIONS = {
  signup: 'create an account',
  signin: 'submit a sign-in',
  oauth: 'start an OAuth sign-in',
  passkey: 'start a passkey flow',
  payment: 'submit a payment',
};

function validateAgentAuthenticationIntent(intent, currentUrl) {
  if (!ACTIONS[intent?.kind]) throw new Error('Unknown browser authentication action.');
  if (intent.method !== null && !['get', 'post', 'dialog'].includes(intent.method))
    throw new Error('Authentication submission method is invalid.');
  const origin = httpUrl(currentUrl).origin;
  return {
    kind: intent.kind,
    origin,
    targetUrl: intent.targetUrl ? httpUrl(intent.targetUrl).href : null,
    method: intent.method,
  };
}

async function approveAuthentication(showPrompt, contents, entry, request, intent) {
  const approval = browserApproval(contents, entry, request);
  try {
    approval.assertCurrent();
    const targetOrigin = intent.targetUrl ? new URL(intent.targetUrl).origin : intent.origin;
    const destination =
      targetOrigin === intent.origin ? intent.origin : `${intent.origin}, opening ${targetOrigin}`;
    const { response } = await showPrompt(
      {
        kind: 'credential',
        buttons: ['Approve once', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title:
          intent.kind === 'payment'
            ? 'Approve DROIDEX payment action?'
            : 'Approve DROIDEX authentication action?',
        message: `Allow DROIDEX to ${ACTIONS[intent.kind]} on ${destination}?`,
        detail:
          'This approval is single-use. Passwords and payment details remain protected, and any supported OS passkey or provider consent sheet stays under your control.',
      },
      { signal: approval.signal },
    );
    approval.assertCurrent();
    if (response !== 0)
      throw new Error(
        `Sensitive action was denied for ${intent.origin}. Hand this step to the user.`,
      );
  } finally {
    approval.dispose();
  }
}

function httpUrl(value) {
  if (typeof value !== 'string' || !URL.canParse(value))
    throw new Error('Authentication destination is invalid.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Authentication destination must use HTTP(S) without embedded credentials.');
  return url;
}

module.exports = { validateAgentAuthenticationIntent, approveAuthentication };
