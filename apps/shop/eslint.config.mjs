import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat ESLint config (eslint-config-next 16 ships flat configs directly, so no
 * FlatCompat shim is needed).
 */
export default [
  { ignores: ['.next/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      /*
       * react-hooks v7 flags every setState made from an effect body. The
       * patterns it points at here are the legitimate ones — reading the
       * persisted cart out of localStorage after hydration, and clearing a
       * fetched list before a new request — and the alternatives (a lazy
       * useState initialiser touching localStorage) would break SSR hydration.
       * Kept as a warning so genuinely new occurrences stay visible.
       */
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Server components legitimately read the clock while rendering; the purity
    // rule is written for client render.
    files: ['src/app/**/page.tsx', 'src/app/**/route.ts', 'src/app/**/layout.tsx'],
    rules: { 'react-hooks/purity': 'off' },
  },
];
