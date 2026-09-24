import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

assert.equal(process.version, 'v24.18.1')
const run = resolve('.ai-work/runs/20260916-shared-baseline')
if (process.argv[2] === 'child') {
  const { MemoryStore } = createRequire(resolve('back-end/package.json'))('express-rate-limit')
  const { BoundedRateStore } = await import('../back-end/dist/boundedRateStore.js')
  const candidate = process.argv[3] === 'candidate'
  const store = candidate ? new BoundedRateStore() : new MemoryStore()
  store.init({ windowMs: 60_000 })
  const sample = () => ({ ...process.memoryUsage(), peakRssKiB: process.resourceUsage().maxRSS })
  try {
    const idle = sample()
    for (let repeat = 0; repeat < 10; repeat++) {
      for (let key = 0; key < 2000; key++) {
        const result = await store.increment(`normal-${key}`)
        assert.equal(result.totalHits, repeat + 1)
      }
    }
    const warmed = sample()
    const started = performance.now()
    for (let key = 0; key < 100_000; key++) await store.increment(`churn-${key}`)
    const elapsedMs = performance.now() - started
    const churn = sample()
    assert.equal((await store.increment('normal-0')).totalHits, 11)
    const retainedIdentities = candidate ? store.counters.size : store.current.size + store.previous.size
    assert.equal(retainedIdentities, candidate ? 10_000 : 102_000)
    store.shutdown()
    console.log(JSON.stringify({ idle, warmed, churn, elapsedMs, retainedIdentities, afterShutdown: sample() }))
  }
  finally {
    store.shutdown()
  }
}
else {
  const samples = []
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const variant of ['baseline', 'candidate']) {
      const { stdout } = await promisify(execFile)(process.execPath, [resolve('scripts/measure-rate-storage.mjs'), 'child', variant], {
        env: { PATH: process.env.PATH },
        timeout: 15000,
        maxBuffer: 32768,
      })
      samples.push({ repeat, variant, ...JSON.parse(stdout) })
    }
  }
  const files = ['back-end/dist/boundedRateStore.js', 'back-end/node_modules/express-rate-limit/dist/index.cjs', 'back-end/node_modules/express-rate-limit/package.json']
  const inputs = {}
  for (const file of files) inputs[file] = createHash('sha256').update(await readFile(file)).digest('hex')
  const result = { baseline: '3011ca8663c6a551d0fd31406af7ffb13f7e2663', node: process.version, platform: `${process.platform}/${process.arch}`, scope: 'Three matched in-process store comparisons: 2000 normal identities with ten requests each, then 100000 unique synthetic identities; no HTTP/provider load, no forced GC, same locked express-rate-limit implementation', inputs, samples }
  await writeFile(`${run}/rate-storage-comparison.json`, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(samples.map(({ variant, churn, elapsedMs, retainedIdentities }) => ({ variant, peakRssMiB: churn.peakRssKiB / 1024, heapMiB: churn.heapUsed / 1048576, elapsedMs, retainedIdentities }))))
}
