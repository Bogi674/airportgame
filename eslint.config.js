import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import noHotAllocation from './eslint-rules/no-hot-allocation.js';

const domGlobals = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLCanvasElement', 'OffscreenCanvas', 'requestAnimationFrame', 'indexedDB'];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { local: { rules: { 'no-hot-allocation': noHotAllocation } } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'local/no-hot-allocation': 'error',
    },
  },
  {
    // Hard rules 1 and 2: the sim is pure and deterministic.
    files: ['src/sim/**/*.ts', 'src/shared/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...domGlobals.map((name) => ({ name, message: 'No DOM in sim or shared code.' }))],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng.' },
        { object: 'Date', property: 'now', message: 'Use the tick counter.' },
        { object: 'performance', property: 'now', message: 'Use the tick counter.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Use the tick counter.' },
      ],
    },
  },
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@render/*', '@ui/*', '**/render/*', '**/ui/*', '**/worker/*'], message: 'Sim imports only shared and data.' },
          ],
        },
      ],
    },
  },
  {
    // Trig used for state must go through shared/trig.ts.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng.' },
        { object: 'Date', property: 'now', message: 'Use the tick counter.' },
        { object: 'performance', property: 'now', message: 'Use the tick counter.' },
        { object: 'Math', property: 'sin', message: 'Use sinLut from @shared/trig.' },
        { object: 'Math', property: 'cos', message: 'Use cosLut from @shared/trig.' },
        { object: 'Math', property: 'atan2', message: 'State affecting trigonometry uses lookup tables.' },
      ],
    },
  },
  {
    files: ['src/ui/**/*.tsx', 'src/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/sim/*', '@sim/*'], message: 'UI may use protocol types only, never sim internals.', allowTypeImports: true }] }],
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.ts', 'e2e/**/*.ts'],
    rules: { 'local/no-hot-allocation': 'off' },
  },
);
