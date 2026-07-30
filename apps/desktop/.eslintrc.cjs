module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  extends: [
    'airbnb-base',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended',
  ],
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: require.resolve('@typescript-eslint/parser'),
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'import/extensions': [
      'error',
      'ignorePackages',
      {
        ts: 'never',
        vue: 'always',
      },
    ],
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: [
          '**/*.test.ts',
          'electron.vite.config.ts',
          'src/main/**/*.ts',
          'src/preload/**/*.ts',
        ],
      },
    ],
    'import/prefer-default-export': 'off',
    'no-void': [
      'error',
      {
        allowAsStatement: true,
      },
    ],
    'no-underscore-dangle': 'off',
    'vue/multi-word-component-names': 'off',
  },
  settings: {
    'import/resolver': {
      typescript: {
        project: [
          './tsconfig.node.json',
          './tsconfig.web.json',
        ],
      },
    },
  },
};
