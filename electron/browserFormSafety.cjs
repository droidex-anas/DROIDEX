const SENSITIVE_INPUT =
  'Agent typing into passwords, one-time codes, payment details or other secret fields is blocked. Hand this step to the user, or use browser_fill_login for a saved login.';

// Ported from #215's sensitiveFields and authIntent preload helpers. These
// functions run on the actual CDP target, including fields inside child frames.
function sensitiveFieldKind(element, classify) {
  for (let field = element; field; field = field.parentElement || field.getRootNode?.().host) {
    if (!['input', 'textarea', 'select'].includes(field.localName) && !field.isContentEditable)
      continue;
    const attribute = (name) => field.getAttribute(name) || '';
    const labels = [...(field.labels || [])].map((label) => label.textContent);
    for (const id of attribute('aria-labelledby').split(/\s+/).filter(Boolean))
      labels.push(field.ownerDocument.getElementById(id)?.textContent || '');
    const description = [...['name', 'id', 'aria-label', 'placeholder'].map(attribute), ...labels]
      .join(' ')
      .toLowerCase();
    const kind = classify([attribute('type'), attribute('autocomplete'), description].join(' '));
    if (kind) return kind;
  }
  return null;
}

// Shared by DOM input checks and CDP field masking, including accessible names.
function sensitiveFieldDescription(description) {
  if (/password|passwd/i.test(description)) return 'password';
  if (/one[\s_-]?time|otp|verif|passcode|2fa|mfa|auth.?code/i.test(description))
    return 'one-time code';
  if (/card|cvv|cvc|csc|cc[-_]|cc.?num|security.?code/i.test(description)) return 'payment card';
  if (
    /pass|token|secret|credential|auth(?!or)|authori[sz]|api.?key|access.?key|private.?key|\bkey\b|\bpin\b|ssn|iban/i.test(
      description,
    )
  )
    return 'secret';
  return null;
}

function inspectAuthenticationIntent(target, activation, sensitiveKind) {
  if (!target)
    throw new Error('The input target could not be inspected. Hand this step to the user.');
  if (['iframe', 'frame'].includes(target.localName))
    throw new Error(
      'This frame could not be inspected. Use a field ref or hand this step to the user.',
    );
  const selector =
    'button,a,input[type="submit"],input[type="button"],input[type="image"],[role="button"],[role="link"]';
  const candidate = target.closest(selector) || target.closest('label') || target;
  const control = candidate.localName === 'label' ? candidate.control || candidate : candidate;
  const form = control.form || control.closest('form');
  if (activation !== 'enter' && !control.matches(selector)) return null;
  const label = [
    control.getAttribute('aria-label'),
    control.getAttribute('title'),
    control.matches('input[type="submit"],input[type="button"]') ? control.value : '',
    control.textContent,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 500)
    .toLowerCase();
  const context = `${label} ${form?.textContent?.slice(0, 1000) || ''}`.toLowerCase();
  const fields = form ? [...form.elements] : [];
  const kinds = fields.map(sensitiveKind);
  if (activation === 'enter') kinds.push(sensitiveKind(target));
  let kind;
  if (
    kinds.includes('payment card') ||
    /\bpay\b|payment|place order|buy now|purchase|complete order|checkout/.test(context)
  )
    kind = 'payment';
  else if (/passkey|security key|touch id|webauthn/.test(context)) kind = 'passkey';
  else if (
    /(continue|sign in|log in|sign up).{0,24}(google|apple|microsoft|github|facebook|oauth)/.test(
      context,
    )
  )
    kind = 'oauth';
  else if (
    /sign up|register|create (?:an )?account|join now/.test(context) ||
    fields.some((field) => field.autocomplete?.toLowerCase().includes('new-password'))
  )
    kind = 'signup';
  else if (kinds.some(Boolean) || /sign[ -]?in|log[ -]?in/.test(context)) kind = 'signin';
  if (!kind) return null;
  let targetUrl = form?.action;
  if (control.localName === 'a') targetUrl = control.href;
  else if (control.getAttribute('formaction')) targetUrl = control.formAction;
  return { kind, targetUrl: targetUrl || null };
}

module.exports = {
  sensitiveFieldKind,
  sensitiveFieldDescription,
  inspectAuthenticationIntent,
  SENSITIVE_INPUT,
};
