const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly'
      }
    },
    rules: {
      semi: ['error', 'always'],
      // avoidEscape: a string that holds FreeMarker's single quotes (the
      // theme's fixtures are FreeMarker fragments) is written with double
      // quotes — which is what Prettier formats it to.
      quotes: ['error', 'single', { avoidEscape: true }],
      // SwitchCase: 1 matches Prettier's formatting of case labels (+2 from
      // the switch). Without it, ESLint and Prettier fight over every future
      // switch statement — eslint --fix loses against prettier --write.
      indent: ['error', 2, { SwitchCase: 1 }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  },
  {
    ignores: ['node_modules/', 'reports/']
  }
];
