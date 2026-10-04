const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
]);

function isDelayedTimer(node) {
  if (node?.type !== 'CallExpression' || node.arguments.length < 2) return false;
  if (node.arguments[1].type === 'Literal' && node.arguments[1].value === 0) return false;

  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name === 'setTimeout';
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.property.name === 'setTimeout' &&
    callee.object.type === 'Identifier' &&
    ['globalThis', 'global', 'window'].includes(callee.object.name)
  );
}

function stableBindingReferences(declaration, initializer, sourceCode) {
  const identifier = declaration?.id;
  if (identifier?.type !== 'Identifier') return [];
  const binding = sourceCode
    .getDeclaredVariables(declaration)
    .find((candidate) => candidate.identifiers.includes(identifier));
  // The declaration's own initializer is its only allowed write.
  if (
    binding?.references.some(
      (reference) =>
        reference.isWrite() && (!reference.init || reference.writeExpr !== initializer),
    )
  )
    return [];
  return binding?.references ?? [];
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: { sleep: 'No sleeps in tests. Use controlled promises or mocked timers.' },
  },
  create(context) {
    return {
      "NewExpression[callee.name='Promise']"(node) {
        const executor = node.arguments[0];
        if (!FUNCTION_TYPES.has(executor?.type)) return;
        const resolve = executor.params[0];
        if (resolve?.type !== 'Identifier') return;

        const variable = context.sourceCode
          .getScope(executor)
          .variables.find((candidate) => candidate.identifiers.includes(resolve));
        if (!variable) return;

        const references = [...variable.references];
        // Follow one directly declared resolver alias, with no reassignment.
        for (const { identifier } of variable.references) {
          const declaration = identifier.parent;
          if (declaration.type === 'VariableDeclarator' && declaration.init === identifier) {
            references.push(
              ...stableBindingReferences(declaration, identifier, context.sourceCode),
            );
          }
        }

        const timers = new Set();
        for (const { identifier } of references) {
          const call = identifier.parent;
          if (isDelayedTimer(call) && call.arguments[0] === identifier) {
            timers.add(call);
            continue;
          }
          if (call.type !== 'CallExpression' || call.callee !== identifier) continue;

          // Follow only the resolver's immediate callback, including a directly
          // declared handler passed to a timer; nested calls stay unrelated.
          for (let callback = call.parent; callback; callback = callback.parent) {
            if (!FUNCTION_TYPES.has(callback.type)) continue;
            const parent = callback.parent;
            if (isDelayedTimer(parent) && parent.arguments[0] === callback) timers.add(parent);

            let declaration;
            if (callback.type === 'FunctionDeclaration') declaration = callback;
            else if (parent.type === 'VariableDeclarator') declaration = parent;
            for (const { identifier } of stableBindingReferences(
              declaration,
              callback,
              context.sourceCode,
            )) {
              const timer = identifier.parent;
              if (isDelayedTimer(timer) && timer.arguments[0] === identifier) timers.add(timer);
            }
            break;
          }
        }
        for (const timer of timers) context.report({ node: timer, messageId: 'sleep' });
      },
    };
  },
};
