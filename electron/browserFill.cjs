const { sensitiveFieldKind, SENSITIVE_INPUT } = require('./browserFormSafety.cjs');

// Run on the ref's own element. A value goes through the element's own
// setter and the input and change events, so frameworks that track it (React
// and others) see the change; a checkbox or radio is clicked when it needs to
// change. Nothing is read back, so a masked field stays unread.
const FILL = `function (value, startBy) {
  const refuseSensitive = () => {
    if ((${sensitiveFieldKind})(this)) throw new Error(${JSON.stringify(SENSITIVE_INPUT)});
  };
  // The page can run this late, and its focus handlers can take their time;
  // nothing changes once the caller has given up, or once a focus handler has
  // swapped the field for another.
  const inTime = () => {
    if (startBy && Date.now() >= startBy) throw new Error('The browser page did not finish in time.');
  };
  const focus = () => {
    inTime();
    this.focus();
    inTime();
    refuseSensitive();
    if (!this.isConnected) throw new Error('the field was replaced when it took the focus; read the page again');
  };
  inTime();
  refuseSensitive();
  if (!this.isConnected) throw new Error('the field is not on the page any more; read the page again');
  if (this instanceof HTMLSelectElement) {
    const wanted = String(value);
    const options = [...this.options];
    const option =
      options.find((candidate) => candidate.value === wanted) ??
      options.find((candidate) => candidate.label.trim() === wanted || candidate.text.trim() === wanted);
    if (!option) throw new Error('no option "' + wanted + '"');
    this.value = option.value;
  } else if (this instanceof HTMLInputElement && (this.type === 'checkbox' || this.type === 'radio')) {
    const checked = value === true || ['true', 'on', 'checked', 'yes'].includes(String(value).toLowerCase());
    if (this.checked !== checked) this.click();
    if (this.checked !== checked)
      throw new Error(this.type === 'radio' ? 'a radio turns off when another one is chosen' : 'the page kept it as it was');
    return;
  } else if (this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement) {
    if (this.type === 'file') throw new Error('file inputs need the user');
    const proto = this instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    focus();
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(this, String(value));
  } else if (this.isContentEditable) {
    focus();
    this.textContent = String(value);
  } else {
    throw new Error('not a field');
  }
  this.dispatchEvent(new Event('input', { bubbles: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
}`;

module.exports = { FILL };
