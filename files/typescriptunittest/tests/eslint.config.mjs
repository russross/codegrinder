import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import noUntypedVarsExceptLoopsAndFunctions from './eslint-custom/arrow-loop-exception.mjs';

export default [
  {
    files: ['**/*.ts'],
    ignores: ["_starter/*", "tests/*"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'custom': {
        rules: {
          'no-untyped-vars-except-loops-and-functions': noUntypedVarsExceptLoopsAndFunctions
        }
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'no-var': 'error',

      '@typescript-eslint/typedef': 'off',

      'custom/no-untyped-vars-except-loops-and-functions': 'error',

      '@typescript-eslint/no-inferrable-types': 'off',
    },
  },
];
