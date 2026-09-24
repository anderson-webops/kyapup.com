import antfu from '@antfu/eslint-config'

export default antfu(
  {
    root: true,
    unocss: true,
    formatters: true,
    ignores: ['**/*.d.ts', '**/dist/**', '**/.nuxt/**', '**/.output/**'],
  },
  {
    files: ['back-end/**/*.{js,ts,mjs,cjs}'],
    rules: {
      'no-console': 'off',
      'node/prefer-global/process': 'off',
    },
  },
  {
    files: ['README.md'],
    rules: {
      'markdown/heading-increment': 'off',
    },
  },
)
