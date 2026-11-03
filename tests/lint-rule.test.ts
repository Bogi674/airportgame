import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from '../eslint-rules/no-hot-allocation.js';

RuleTester.describe = describe;
RuleTester.it = it;

describe('no-hot-allocation', () => {
  new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } }).run('no-hot-allocation', rule, {
    valid: [
      { code: 'function cold() { return [1, 2].map((x) => x); }' },
      { code: '// hot\nfunction hot(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }' },
      { code: 'class A {\n // hot\n m(a) { return a + 1; }\n n() { return {}; }\n}' },
    ],
    invalid: [
      { code: '// hot\nfunction f() { return { a: 1 }; }', errors: 1 },
      { code: '// hot\nfunction f(a) { return a.map((x) => x); }', errors: 2 },
      { code: 'class A {\n // hot\n m() { return [1]; }\n}', errors: 1 },
      { code: '// hot\nconst f = () => new Set();', errors: 1 },
    ],
  });
});
