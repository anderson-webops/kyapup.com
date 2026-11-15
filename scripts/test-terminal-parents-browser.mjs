import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import * as current from '@poppinss/dumper/html'
import puppeteer from 'puppeteer-core'

const root = path.resolve(import.meta.dirname, '..')
const reference = createRequire(path.join(root, 'vendor/terminal-parents/upstream/package.json'))
const original = await import(pathToFileURL(reference.resolve('@poppinss/dumper/html')))
const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(filename => filename && existsSync(filename))
assert.ok(executablePath, 'A real supported browser is required')
const parent = path.join(root, '.ai-work/runs')
await mkdir(parent, { recursive: true })
const directory = await mkdtemp(path.join(parent, 'terminal-parents-browser-'))
const nonce = 'synthetic-terminal-browser-nonce'
const pages = new Map()
for (const [name, formatter] of [
  ['original', original],
  ['current', current],
]) {
  const value = {
    label: '<img src=x onerror="globalThis.__injected=true">',
    nested: { answer: 42 },
    values: [1, 2, 3],
  }
  const content = formatter.dump(value, { depth: 4, cspNonce: nonce, expand: false })
  pages.set(`/${name}`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Isolated formatter fixture</title><link rel="icon" href="data:,"><style>${formatter.createStyleSheet()}</style><script nonce="${nonce}">${formatter.createScript()}</script></head><body>${content}<script>globalThis.__unapproved=true</script></body></html>`)
}
const server = http.createServer((request, response) => {
  const content = pages.get(request.url)
  response.writeHead(content ? 200 : 404, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'`,
  })
  response.end(content || 'Unknown synthetic fixture')
})
let browser
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(directory, 'browser'),
    args: process.platform === 'linux'
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : [],
  })
  const results = []
  for (const name of ['original', 'current']) {
    const page = await browser.newPage()
    const errors = []
    const blocked = []
    page.on('pageerror', error => errors.push(String(error)))
    page.on('console', (message) => {
      if (message.type() === 'error') {
        if (/Executing inline script violates.*Content Security Policy/.test(message.text()))
          blocked.push(message.text())
        else
          errors.push(message.text())
      }
    })
    await page.goto(`http://127.0.0.1:${server.address().port}/${name}`, { waitUntil: 'networkidle0', timeout: 15000 })
    const button = '.dumper-dump .dumper-group > .dumper-toggle'
    await page.waitForSelector(button)
    assert.equal(await page.$eval(button, element => element.getAttribute('aria-expanded')), null)
    await page.click(button)
    assert.equal(await page.$eval(button, element => element.getAttribute('aria-expanded')), 'true')
    assert.equal(await page.$eval('.dumper-group > samp', element => element.hidden), false)
    assert.match(await page.$eval('.dumper-dump', element => element.textContent), /<img src=x onerror=/)
    assert.equal(await page.$$eval('.dumper-dump img', elements => elements.length), 0)
    await page.click(button)
    assert.equal(await page.$eval(button, element => element.getAttribute('aria-expanded')), null)
    assert.equal(await page.$eval('.dumper-group > samp', element => element.hidden), true)
    assert.equal(blocked.length, 1)
    assert.deepEqual(errors, [])
    results.push(await page.evaluate(() => ({
      injected: globalThis.__injected === true,
      unapproved: globalThis.__unapproved === true,
      groups: document.querySelectorAll('.dumper-group').length,
      output: document.querySelector('.dumper-dump pre').textContent,
    })))
    await page.close()
  }
  assert.deepEqual(results[0], results[1])
  assert.equal(results[1].injected, false)
  assert.equal(results[1].unapproved, false)
  assert.ok(results[1].groups >= 3)
  console.log(JSON.stringify({
    status: 'passed',
    formatters: 2,
    checks: [
      'real-nonce-activation',
      'expand-collapse',
      'escaped-values',
      'blocked-unapproved-script',
      'original-parity',
    ],
  }))
}
finally {
  if (browser)
    await browser.close()
  server.closeAllConnections()
  await new Promise((resolve, reject) => server.close(error => error
    ? reject(error)
    : resolve()))
  await rm(directory, { recursive: true })
}
