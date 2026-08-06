import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * One flat config for the whole workspace.
 *
 * Deliberately narrow. The rules kept here are the ones that catch defects —
 * unhandled promises, floating async calls, unreachable code — not the ones
 * that argue about formatting. Prettier already owns layout, and a linter
 * that mostly reports style noise trains everyone to ignore it, including on
 * the run where it finally reports something that moves money.
 *
 * The money-specific rules live in the `apps/api` block below.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.expo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      'apps/api/prisma/migrations/**',
      'docs/**',
      // esbuild output for the screenshot harness — a generated bundle, not
      // source anyone edits.
      'tools/preview/mobile/bundle.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022 },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // Decorator metadata and DTO shapes make some `any` unavoidable at the
      // framework boundary; flag it rather than fail the build over it.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // ── Backend ─────────────────────────────────────────────────────────────
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The one that matters most here. A money operation whose promise is
      // never awaited commits out of order, escapes its surrounding
      // transaction, and reports success before the write has happened.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
    },
  },
  {
    // Command-line tooling: printing progress is the point.
    files: [
      'apps/api/prisma/**/*.ts',
      'tools/**/*.{ts,mjs,js}',
      'scripts/**/*.{ts,mjs,js}',
      'packages/*/scripts/**/*.{ts,mjs,js}',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // Build tooling still runs under CommonJS.
    files: ['**/*.config.js', '**/*.config.cjs', '**/jest.config.js', '**/metro.config.js'],
    languageOptions: { globals: { ...globals.node }, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['apps/api/**/*.spec.ts', 'apps/api/test/**/*.ts'],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      // Tests reach into internals and hand-roll malformed values on purpose.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ── Web apps ────────────────────────────────────────────────────────────
  {
    files: ['apps/admin/**/*.{ts,tsx}', 'apps/partner/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // ── Mobile ──────────────────────────────────────────────────────────────
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, __DEV__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // ── React hook rules, everywhere React is used ──────────────────────────
  // A stale dependency array in a balance screen shows the customer numbers
  // that are quietly out of date, which is worse than showing none.
  {
    files: [
      'apps/admin/**/*.{ts,tsx}',
      'apps/partner/**/*.{ts,tsx}',
      'apps/mobile/**/*.{ts,tsx}',
      'packages/design/**/*.{ts,tsx}',
    ],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
