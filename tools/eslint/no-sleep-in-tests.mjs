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

        const timers = new Set();
        for (const { identifier } of variable.references) {
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
            else if (parent.type === 'VariableDeclarator' && parent.parent.kind === 'const') {
              declaration = parent;
            }
            const handler = declaration?.id;
            if (handler?.type === 'Identifier') {
              const binding = context.sourceCode
                .getDeclaredVariables(declaration)
                .find((candidate) => candidate.identifiers.includes(handler));
              for (const { identifier } of binding?.references ?? []) {
                const timer = identifier.parent;
                if (isDelayedTimer(timer) && timer.arguments[0] === identifier) timers.add(timer);
              }
            }
            break;
          }
        }
        for (const timer of timers) context.report({ node: timer, messageId: 'sleep' });
      },
    };
  },
};
