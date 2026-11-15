import assert from 'node:assert/strict'

export async function waitForCheckerDiagnostic(page, message, source) {
  await page.waitForFunction(() => document.querySelector('vite-plugin-checker-overlay')?.shadowRoot?.querySelector('iframe'))
  const handle = await page.evaluateHandle(() => document.querySelector('vite-plugin-checker-overlay').shadowRoot.querySelector('iframe'))
  try {
    const frame = await handle.asElement().contentFrame()
    assert.ok(frame, 'The actual checker diagnostics frame must load')
    await frame.waitForFunction(expected => document.body.textContent.includes(expected), {}, message)
    await frame.waitForFunction(expected => document.body.textContent.includes(expected), {}, source)
    await page.waitForFunction(() => document.querySelector('vite-plugin-checker-overlay').shadowRoot.querySelector('.drawer')?.hidden === false)
    assert.equal(new URL(frame.url()).origin, new URL(page.url()).origin)
  }
  finally {
    await handle.dispose()
  }
}

export async function waitForCheckerRecovery(page) {
  await page.waitForFunction(() => {
    const shadow = document.querySelector('vite-plugin-checker-overlay')?.shadowRoot
    return shadow?.querySelector('.drawer')?.hidden === true
      && shadow.querySelector('.count.error')?.textContent === '0'
      && shadow.querySelector('.label')?.textContent === 'Checker: no problems'
  })
}
