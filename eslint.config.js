// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Package boundary rules (see CLAUDE.md "Dependency rules").
 * Enforced here so neither humans nor Claude can silently break the architecture.
 */
const serverOnly = [
  { group: ['@pt/db', '@pt/db/*'], message: 'Only apps/api may import @pt/db.' },
  { group: ['@pt/ai', '@pt/ai/*'], message: 'Only apps/api may import @pt/ai (API keys!).' },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      'packages/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  // Client-side code and shared packages: never reach server-only packages.
  {
    files: ['apps/web/**', 'apps/mobile/**', 'packages/{contracts,core,api-client,ui,i18n}/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: serverOnly }] },
  },
  // core is pure: only contracts allowed among internal packages, no I/O libs.
  {
    files: ['packages/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...serverOnly,
            {
              group: ['@pt/api-client', '@pt/ui', '@pt/i18n', 'react', 'react-native', 'next/*'],
              message: '@pt/core must stay pure (only @pt/contracts allowed).',
            },
            {
              group: ['drizzle-orm', 'postgres', '@supabase/*', '@anthropic-ai/*', 'stripe'],
              message: '@pt/core must not perform I/O.',
            },
          ],
        },
      ],
    },
  },
  // contracts: zod only.
  {
    files: ['packages/contracts/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@pt/*'], message: '@pt/contracts must not depend on other packages.' },
          ],
        },
      ],
    },
  },
);
