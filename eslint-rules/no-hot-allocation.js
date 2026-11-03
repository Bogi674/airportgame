/**
 * Forbids allocations inside functions marked with a `// hot` comment (docs/PERFORMANCE.md section 2).
 * The marker is a line comment `// hot` directly before the function or method.
 * Flags object and array literals, closures, `new`, spread, template literals and the
 * allocating array methods map, filter, forEach, reduce, slice, concat, flatMap.
 */
const ARRAY_METHODS = new Set(['map', 'filter', 'forEach', 'reduce', 'slice', 'concat', 'flatMap']);

function isHotMarked(sourceCode, fn) {
  let node = fn;
  const parent = fn.parent;
  if (parent && (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition' || parent.type === 'Property')) {
    node = parent;
  } else if (parent && parent.type === 'VariableDeclarator') {
    node = parent.parent;
  }
  if (node.parent && (node.parent.type === 'ExportNamedDeclaration' || node.parent.type === 'ExportDefaultDeclaration')) {
    node = node.parent;
  }
  return sourceCode.getCommentsBefore(node).some((c) => c.type === 'Line' && c.value.trim() === 'hot');
}

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow allocations in functions marked // hot' },
    schema: [],
    messages: { alloc: 'Allocation in a hot function: {{what}}.' },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const hotStack = [];
    const inHot = () => hotStack.length > 0 && hotStack[hotStack.length - 1];

    const enterFn = (node) => hotStack.push(isHotMarked(sourceCode, node));
    const exitFn = () => hotStack.pop();
    const report = (node, what) => {
      if (inHot()) context.report({ node, messageId: 'alloc', data: { what } });
    };
    // A nested closure inside a hot function is itself an allocation.
    const closure = (node) => {
      if (inHot()) report(node, 'closure');
      enterFn(node);
    };

    return {
      FunctionDeclaration: enterFn,
      'FunctionDeclaration:exit': exitFn,
      FunctionExpression(node) {
        if (node.parent && node.parent.type === 'MethodDefinition') enterFn(node);
        else closure(node);
      },
      'FunctionExpression:exit': exitFn,
      ArrowFunctionExpression: closure,
      'ArrowFunctionExpression:exit': exitFn,
      ObjectExpression: (n) => report(n, 'object literal'),
      ArrayExpression: (n) => report(n, 'array literal'),
      NewExpression: (n) => report(n, 'new expression'),
      SpreadElement: (n) => report(n, 'spread'),
      TemplateLiteral: (n) => report(n, 'template literal'),
      CallExpression(n) {
        const c = n.callee;
        if (c.type === 'MemberExpression' && !c.computed && c.property.type === 'Identifier' && ARRAY_METHODS.has(c.property.name)) {
          report(n, `.${c.property.name}()`);
        }
      },
    };
  },
};
