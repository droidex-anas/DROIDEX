const assert = require('node:assert/strict');
const test = require('node:test');
const { submittedCredential, fillCredentialForm } = require('./browserCredentialFields.cjs');

class Input {
  constructor(type, value, autocomplete = '') {
    Object.assign(this, { localName: 'input', type, value, autocomplete, isConnected: true });
  }
  set value(value) {
    this.entered = value;
  }
  get value() {
    return this.entered;
  }
  getBoundingClientRect() {
    return { width: 100, height: 20 };
  }
  checkVisibility() {
    return true;
  }
  focus() {
    this.onFocus?.();
  }
  dispatchEvent() {}
}
function form(...elements) {
  const form = { localName: 'form', elements };
  elements.forEach((field) => {
    field.form = form;
  });
  return form;
}

test('capture selects only the submitted form, including its associated controls', () => {
  const unrelated = new Input('password', 'unrelated');
  form(unrelated);
  const user = new Input('text', 'account', 'username');
  const password = new Input('password', 'current', 'current-password');
  const submitted = form(new Input('text', 'unrelated text'), user, password);
  assert.deepEqual(submittedCredential(submitted), { username: 'account', password: 'current' });
  assert.equal(
    submittedCredential(form(password, new Input('password', 'new', 'new-password'))),
    null,
  );
  assert.equal(submittedCredential(form(new Input('password', 'new', 'new-password'))), null);
  assert.equal(submittedCredential(form(password, new Input('password', 'ambiguous'))), null);
});

test('fill refuses ambiguous, new-password and changed-origin forms', () => {
  const current = new Input('password', '', 'current-password');
  const other = new Input('password', '', 'new-password');
  let inputs = [current, other];
  const document = {
    defaultView: {
      location: { origin: 'https://example.test' },
      HTMLInputElement: Input,
      Event: class {},
    },
    querySelectorAll: () => inputs,
  };
  const payload = {
    origin: 'https://example.test',
    username: '',
    password: 'saved',
    startBy: Date.now() + 10_000,
  };
  assert.equal(fillCredentialForm(document, payload).ok, false);
  inputs = [other];
  assert.equal(fillCredentialForm(document, payload).ok, false);
  inputs = [current];
  assert.equal(
    fillCredentialForm(document, { ...payload, origin: 'https://attacker.test' }).ok,
    false,
  );
  current.onFocus = () => {
    current.type = 'text';
  };
  assert.throws(() => fillCredentialForm(document, payload), /form changed/);
  assert.equal(current.value, '');
  assert.equal(other.value, '');
});
