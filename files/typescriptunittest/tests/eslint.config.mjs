import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'no-var': 'error',
      "@typescript-eslint/typedef": [
        "error",
        {
          variableDeclaration: true,
          parameter: true,
          memberVariableDeclaration: true,
          propertyDeclaration: true,
          variableDeclarationIgnoreFunction: true,
        }
      ]
    },
  },
];

