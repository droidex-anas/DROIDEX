// Capture only the submitted form's current password. Sign-up and password
// changes are deliberately left to the user and never replace a saved login.
function submittedCredential(form) {
  if (form?.localName !== 'form') return null;
  const fields = [...form.elements].filter((field) => field.localName === 'input');
  const passwords = fields.filter((field) => field.type === 'password');
  if (passwords.some((field) => field.autocomplete.toLowerCase().includes('new-password')))
    return null;
  if (passwords.length !== 1 || !passwords[0].value) return null;
  const usernameFields = fields.filter(
    (field) => ['text', 'email', 'tel'].includes(field.type) && field.value,
  );
  const username =
    usernameFields.find((field) => field.autocomplete.toLowerCase().includes('username')) ??
    usernameFields[0];
  return { username: username?.value || '', password: passwords[0].value };
}

function fillCredentialForm(document, payload) {
  const { location, HTMLInputElement, Event } = document.defaultView;
  if (payload.origin !== location.origin)
    return { ok: false, error: 'The page changed before the login was filled.' };
  const passwordFields = [...document.querySelectorAll('input[type="password"]')].filter(
    (field) => isVisible(field) && !field.disabled && !field.readOnly,
  );
  if (
    passwordFields.length !== 1 ||
    passwordFields[0].autocomplete.toLowerCase().includes('new-password')
  ) {
    return { ok: false, error: 'No unambiguous current-password form found.' };
  }
  const passwordField = passwordFields[0];
  const form = passwordField.form;
  const scope = passwordField.form
    ? [...passwordField.form.elements]
    : [...document.querySelectorAll('input')];
  const usernameFields = scope.filter(
    (field) =>
      field.localName === 'input' &&
      ['email', 'text', 'tel'].includes(field.type) &&
      isVisible(field) &&
      !field.disabled &&
      !field.readOnly,
  );
  const usernameField =
    usernameFields.find((field) => field.autocomplete.toLowerCase().includes('username')) ??
    usernameFields.filter((field) => scope.indexOf(field) < scope.indexOf(passwordField)).at(-1);

  function assertCurrent(field) {
    if (Date.now() >= payload.startBy) throw new Error('The browser page did not finish in time.');
    if (!field.isConnected || passwordField.form !== form || location.origin !== payload.origin)
      throw new Error('The login form changed before it was filled.');
    if (
      passwordField.type !== 'password' ||
      passwordField.autocomplete.toLowerCase().includes('new-password')
    )
      throw new Error('The login form changed before it was filled.');
  }

  function setValue(field, value) {
    assertCurrent(field);
    field.focus();
    assertCurrent(field);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (usernameField && payload.username) setValue(usernameField, payload.username);
  setValue(passwordField, payload.password);
  return { ok: true };
}

function isVisible(field) {
  const rect = field.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    field.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  );
}

module.exports = { submittedCredential, fillCredentialForm };
