import assert from 'node:assert/strict'
import process from 'node:process'

export default {
  srcDir: '.',
  pages: true,
  compatibilityDate: '2026-07-24',
  modulesDir: [process.env.WATCHER_MODULES_ROOT],
  devtools: {
    enabled: true,
    mcp: false,
    codeServer: { enabled: false },
  },
  experimental: {
    watcher: process.env.WATCHER_MODE,
  },
  modules: [
    async function qualifiedFixture(_options, nuxt) {
      nuxt.hook('devtools:initialized', (info) => {
        assert.equal(info.version, '4.1.0')
        console.log('WATCHER_DEVTOOLS_4_INITIALIZED')
      })
      nuxt.hook('builder:watch', (event, filename) => {
        if (filename.endsWith('.vue'))
          console.log(`WATCHER_EVENT_${event}`)
      })
      const { startSubprocess } = await import('@nuxt/devtools-kit')
      const child = startSubprocess({
        command: process.execPath,
        args: ['--version'],
        cwd: nuxt.options.rootDir,
      }, { id: 'watcher-fixture', name: 'Watcher fixture' }, nuxt)
      const result = await child.getResult()
      assert.equal(result.stdout.trim(), process.version)
      assert.equal(typeof child.getProcess().pid, 'number')
      child.terminate()
      console.log('WATCHER_KIT4_LEGACY_PROCESS_PASSED')
    },
    [
      '@nuxt/eslint',
      {
        checker: false,
        config: {
          devtools: { enabled: false },
        },
      },
    ],
  ],
}
