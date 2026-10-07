const { send } = require('./browserFrames.cjs');
const { exactHttpOrigin } = require('./browserSettingsSchema.cjs');

// JavaScript and data links can execute without a network navigation event.
// Refuse them before input, including links activated with Enter or Space.
async function refuseAgentScheme(dbg, sessionId, point) {
  const { result } = await send(dbg, sessionId, 'Runtime.evaluate', {
    expression: `(${destinationAt})(${JSON.stringify(point ?? null)})`,
    returnByValue: true,
  });
  if (result?.value) exactHttpOrigin(result.value);
}

/* global document */
function destinationAt(point) {
  let element = point ? document.elementFromPoint(point.x, point.y) : document.activeElement;
  while (element?.shadowRoot) {
    const inner = point
      ? element.shadowRoot.elementFromPoint(point.x, point.y)
      : element.shadowRoot.activeElement;
    if (!inner || inner === element) break;
    element = inner;
  }
  const link = element?.closest('a[href],area[href]');
  if (link) return link.href;
  const button = element?.closest('button,input[type="submit"],input[type="image"]');
  if (button?.form && ['submit', 'image'].includes(button.type)) {
    if ((button.getAttribute('formmethod') || button.form.method) === 'dialog') return null;
    return button.hasAttribute('formaction') ? button.formAction : button.form.action;
  }
  const form = element?.form;
  if (!point && form && form.method !== 'dialog') {
    const submitter = [...form.elements].find(
      (control) => !control.disabled && ['submit', 'image'].includes(control.type),
    );
    return submitter?.hasAttribute('formaction') ? submitter.formAction : form.action;
  }
  return null;
}

module.exports = { refuseAgentScheme };
