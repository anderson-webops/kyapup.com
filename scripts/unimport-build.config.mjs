import process from 'node:process'

export default {
  cwd: process.cwd(),
  entry: ['src/index.ts', 'src/unplugin.ts', 'src/addons.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  platform: 'node',
  target: 'node26',
  outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
}
