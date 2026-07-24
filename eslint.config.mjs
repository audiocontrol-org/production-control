import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

// Base configuration for TypeScript files
const baseRules = {
  // Ban explicit any
  '@typescript-eslint/no-explicit-any': 'error',

  // Ban type assertions (as Type) - forbid all as assertions
  '@typescript-eslint/consistent-type-assertions': [
    'error',
    {
      assertionStyle: 'never',
    },
  ],

  // Ban ts-comment directives (@ts-ignore, @ts-expect-error, @ts-nocheck)
  '@typescript-eslint/ban-ts-comment': [
    'error',
    {
      'ts-expect-error': true,
      'ts-ignore': true,
      'ts-nocheck': true,
      'ts-check': false,
    },
  ],

  // Prettier integration
  'prettier/prettier': 'error',
};

export default [
  {
    ignores: [
      'dist/',
      'node_modules/',
      '**/node_modules/',
      'coverage/',
      '**/*.config.ts',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
    ignores: ['tests/fixtures/**'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      prettier,
    },
    rules: baseRules,
  },
  // Fixtures are linted but without projectService
  {
    files: ['tests/fixtures/**/*.ts', 'tests/fixtures/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowDefaultProject: true,
      },
    },
    plugins: {
      prettier,
    },
    rules: {
      ...baseRules,
      // Disable type-checked rules for fixtures since they can't access projectService
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-for-in-array': 'off',
      '@typescript-eslint/no-implied-eval': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unnecessary-type-constraint': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-unsafe-unary-minus': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-duplicate-type-constituents': 'off',
      '@typescript-eslint/no-array-delete': 'off',
      '@typescript-eslint/no-array-constructor': 'off',
      '@typescript-eslint/no-duplicate-enum-values': 'off',
      '@typescript-eslint/no-extra-non-null-assertion': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      '@typescript-eslint/no-unsafe-declaration-merging': 'off',
      '@typescript-eslint/triple-slash-reference': 'off',
      '@typescript-eslint/prefer-as-const': 'off',
      '@typescript-eslint/no-misused-new': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/prefer-namespace-keyword': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  // editorial-tooling is a separate, plain-ESM package (no tsconfig project covers its
  // .mjs files). Without this block, the global `recommendedTypeChecked` spread above
  // (which registers the TS parser and type-aware rules for every file, unscoped) would
  // apply to these files too and either crash for lack of parser services or silently
  // fail to lint. Disable the type-checked rules here while leaving `js.configs.recommended`
  // (e.g. `no-unused-vars`), which is also applied unscoped above, in force.
  {
    files: ['editorial-tooling/**/*.mjs'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      // Plain Node ESM, not covered by any tsconfig `types`/`lib` — declare the handful
      // of Node globals this package actually references so `no-undef` (from
      // `js.configs.recommended`, applied unscoped above) doesn't misfire on them.
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    rules: tseslint.configs.disableTypeChecked.rules,
  },
  prettierConfig,
];
