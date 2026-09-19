// Cash Out's own lint configuration. It is deliberately independent of the
// parent repository's: the day this directory becomes its own repository,
// nothing here has to change.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      'apps/api/prisma/migrations/**',
      'apps/mobile/babel.config.js',
      'apps/mobile/metro.config.js',
      '**/jest.config.js',
      'apps/admin/next.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The seeder and operational scripts talk to a terminal; that is their job.
    files: ['apps/api/prisma/seed.ts', 'scripts/**/*.{js,mjs,ts}'],
    rules: { 'no-console': 'off' },
  },
  {
    // `require` in the Metro/Babel/Jest config files is how those tools load.
    files: ['**/*.js', '**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
