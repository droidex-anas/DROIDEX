// Where activating a node would send its page: the link around it, or the form
// a submitter (or Enter in a field) would post. It runs on the hit-tested node
// in its own document, so links in frames and closed shadow roots count too.
// JavaScript and data links run without a network request, so the agent's
// input is refused before it goes out.
function navigationDestination(target, activation) {
  for (
    let element = target;
    element;
    element = element.assignedSlot ?? element.parentElement ?? element.getRootNode().host
  ) {
    if (element.matches('a[href],area[href]')) return element.href;
  }
  const button = target.closest('button,input[type="submit"],input[type="image"]');
  if (button?.form && ['submit', 'image'].includes(button.type)) {
    if ((button.getAttribute('formmethod') || button.form.method) === 'dialog') return null;
    return button.getAttribute('formaction') === null ? button.form.action : button.formAction;
  }
  const form = target.form;
  if (activation === 'enter' && form && form.method !== 'dialog') {
    const submitter = [...form.elements].find(
      (control) => !control.disabled && ['submit', 'image'].includes(control.type),
    );
    return submitter && submitter.getAttribute('formaction') !== null
      ? submitter.formAction
      : form.action;
  }
  return null;
}

module.exports = { navigationDestination };
